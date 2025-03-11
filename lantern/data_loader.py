#!/usr/bin/env python3

"""
data_loader.py

This module prepares the dataset for the simulation. It reads csv files from LOAD_DATA_DIR and
GEN_DATA_DIR respectively into a locally stored database, resolving things like timezones, and
averaging measurements per hour.

Unifies the datasets into one table with {ID, TIMESTAMP, LOAD, GEN} as columns. It samples
from this table (of about 1400 smart meters) NUM_IDS_SAMPLED smart meters and loads it into
a pandas DataFrame, which then has NUM_IDS_SAMPLED * 8760 (# hours per year) entries.
The dataframe is pivoted into two dataframes (columns are timestamps, ID is index), one for load
and one for pv, and compressed into a pickle file each.

The module provides an API for the simulation driver main.py to fetch the pickle files.
"""

import json
import uuid
import time
import os
import random
import requests
import pandas as pd
from io import StringIO
import os
import duckdb
import pickle
import pandas as pd
from pandas._libs import NaTType
from .constants import APT_BLOCK_SIZE, PKL_LOAD_FILE, PKL_PV_FILE, PKL_DIR, PV_CAPACITY

NUM_IDS_SAMPLED: int = 100
MAX_LOAD: float = 4  # clip data points higher than this
MIN_LOAD: float = 0.1  # clip data points lower than this
DB_NAME: str = "data.db"
LOAD_TABLE_NAME: str = "load_data"
GEN_TABLE_NAME: str = "gen_data"
TIMEZONE: str = "Europe/Zurich"
YEAR: int = 2024
YEAR_START: pd.Timestamp | NaTType = pd.Timestamp(YEAR, 1, 1).tz_localize(TIMEZONE)

# input csv col names
LOAD_TIMESTAMP_CSV_COL_NAME: str = "zeitpunkt"
GEN_TIMESTAMP_CSV_COL_NAME: str = "time"
LOAD_CSV_COL_NAME: str = "bruttolastgang_kwh"
GEN_CSV_COL_NAME: str = "electricity"

# dataframe col names
LOAD_DF_COL_NAME: str = "load"
GEN_DF_COL_NAME: str = "gen"
ID_DF_COL_NAME: str = "id"
TIMESTAMP_DF_COL_NAME: str = "timestamp"

# directory names
LOAD_DATA_DIR: str = "data/load"
GEN_DATA_DIR: str = "data/gen"

# PV data generation
API_TOKEN: str = "d2e5dba37d3147892282e6c96530543c798f5954"
API_BASE: str = "https://www.renewables.ninja/api/"


class DataLoader:
    # We have a database with two tables. prod and gen.
    # _conn: duckdb.DuckDBPyConnection
    # _sample: pd.DataFrame

    def __init__(self) -> None:
        self._conn = self._create_database()
        self._sample_load, self._sample_pv = self._sample_from_db(self._conn)

    def _get_randomized_args(self) -> dict[str, float | str | int]:
        lat_noise: float = random.uniform(-0.02, 0.02)
        lon_noise: float = random.uniform(-0.04, 0.04)
        tlt_noise: float = random.uniform(-20, 20)
        azm_noise: float = random.uniform(-20, 20)

        return {
            "lat": 47.5 + lat_noise,
            "lon": 8.73 + lon_noise,
            "date_from": "2024-01-01",
            "date_to": "2024-12-31",
            "dataset": "merra2",
            "capacity": PV_CAPACITY,
            "system_loss": 0.1,
            "tracking": 0,
            "tilt": 50 + tlt_noise,
            "azim": 180 + azm_noise,
            "format": "json",
        }

    def _generate_pv_data(self) -> None:
        s: requests.Session = requests.session()
        s.headers = {"Authorization": "Token " + API_TOKEN}
        url: str = API_BASE + "data/pv"

        # at most 50 requests per hour
        for i in range(50):
            args: dict[str, float | str | int] = self._get_randomized_args()
            time.sleep(1)
            r = s.get(url, params=args)
            if r.status_code != 200:
                print(f"Error: Received status code {r.status_code} for request {i}")
                return

            # Parse JSON to get a pandas.DataFrame of data and dict of metadata
            parsed_response = json.loads(r.text)

            data = pd.read_json(
                StringIO(json.dumps(parsed_response["data"])), orient="index"
            )
            # timestamp used as index. reset to add it back as a column.
            data = data.reset_index().rename(columns={"index": "time"})
            unique_filename: str = f"synthetic_gen_profile_{uuid.uuid4().hex}.csv"

            data.to_csv(os.path.join(GEN_DATA_DIR, unique_filename), index=False)

    def _extract_timestamp_features(self, df: pd.DataFrame) -> None:
        df[TIMESTAMP_DF_COL_NAME] = pd.to_datetime(df[TIMESTAMP_DF_COL_NAME])

        # localize to swiss time
        df[TIMESTAMP_DF_COL_NAME] = df[TIMESTAMP_DF_COL_NAME].dt.tz_localize(
            TIMEZONE, ambiguous=False
        )

        df["hour_of_day"] = df[TIMESTAMP_DF_COL_NAME].dt.hour
        df["hour_of_day"] = df["hour_of_day"].round().astype(int)

        df["day_of_year"] = (df[TIMESTAMP_DF_COL_NAME] - YEAR_START).dt.days
        df["hour_in_year"] = 24 * df["day_of_year"] + df["hour_of_day"]
        df["hour_in_year"] = df["hour_in_year"].round().astype(int)
        df.drop(columns=["hour_of_day", "day_of_year"], inplace=True)

    def _create_database(self) -> duckdb.DuckDBPyConnection:
        """Creates Database with all csv files in the data directory if it doesn't already exist."""

        conn: duckdb.DuckDBPyConnection = duckdb.connect(DB_NAME)

        # ask for loading database fresh from csv files. Only works if csv files exist (which they don't on the github version)
        isProduction: bool = not (
            os.path.exists(GEN_DATA_DIR) and os.path.exists(LOAD_DATA_DIR)
        )
        if not isProduction:
            user_input: str
            user_input = (
                input(
                    "Create the load table fresh (due to new data files or new query) (y/n)? "
                )
                .strip()
                .lower()
            )
            if user_input == "y":
                conn.execute(
                    f"""
                    DROP TABLE IF EXISTS {LOAD_TABLE_NAME};
                """
                )
            user_input = input("Generate additional pv data (y/N)?").strip().lower()
            if user_input == "y":
                print("Generating pv_data...")
                self._generate_pv_data()
                print("Finished generating pv_data.")

            user_input = (
                input(
                    "Create the generation table fresh (due to new data files or new query) (y/n)? "
                )
                .strip()
                .lower()
            )
            if user_input == "y":
                conn.execute(
                    f"""
                    DROP TABLE IF EXISTS {GEN_TABLE_NAME};
                """
                )

        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {LOAD_TABLE_NAME} (
                {TIMESTAMP_DF_COL_NAME} TIMESTAMP,
                {LOAD_DF_COL_NAME} FLOAT,
                {ID_DF_COL_NAME} INTEGER
            );
        """
        )

        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {GEN_TABLE_NAME} (
                {TIMESTAMP_DF_COL_NAME} TIMESTAMP,
                {GEN_DF_COL_NAME} FLOAT,
                {ID_DF_COL_NAME} INTEGER
            );
        """
        )

        # Check if data already exists before inserting by counting rows in table
        load_row_count: int
        gen_row_count: int

        load_row_query = conn.execute(
            f"SELECT COUNT(*) FROM {LOAD_TABLE_NAME};"
        ).fetchone()
        if load_row_query is not None:
            load_row_count = load_row_query[0]
        else:
            load_row_count = 0
        gen_row_query = conn.execute(
            f"SELECT COUNT(*) FROM {GEN_TABLE_NAME};"
        ).fetchone()
        if gen_row_query is not None:
            gen_row_count = gen_row_query[0]
        else:
            gen_row_count = 0

        if load_row_count == 0:  # Load data only if table is empty
            print("Loading load data into DuckDB...")

            conn.execute(
                """
                DROP TABLE IF EXISTS individual_household_load_table;
            """
            )
            conn.execute(
                f"""
                DROP TABLE IF EXISTS joined_data;
            """
            )
            for idx, file in enumerate(os.listdir(LOAD_DATA_DIR)):
                if file.endswith(".csv"):
                    file_path = os.path.join(LOAD_DATA_DIR, file)
                    print(f"Loading Load CSV file: {idx}")
                    conn.execute(
                        f"""
                        INSERT INTO {LOAD_TABLE_NAME}
                        SELECT
                            DATE_TRUNC('hour', {LOAD_TIMESTAMP_CSV_COL_NAME} AT TIME ZONE '{TIMEZONE}') AS {TIMESTAMP_DF_COL_NAME},
                            SUM({LOAD_CSV_COL_NAME}) AS {LOAD_DF_COL_NAME},
                            {idx} AS {ID_DF_COL_NAME}
                        FROM read_csv_auto('{file_path}')
                        WHERE EXTRACT(YEAR FROM {LOAD_TIMESTAMP_CSV_COL_NAME}) = {YEAR}
                        GROUP BY {TIMESTAMP_DF_COL_NAME}
                        ORDER BY {TIMESTAMP_DF_COL_NAME};
                     """
                    )
            print("Finished loading data into DuckDB.")
        else:
            print("Load table in DB already exists, skipping reload.")

        if gen_row_count == 0:  # Load data only if table is empty
            print("Loading PV data into DuckDB...")

            # Process each file separately
            for idx, file in enumerate(os.listdir(GEN_DATA_DIR)):
                if file.endswith(".csv"):
                    file_path = os.path.join(GEN_DATA_DIR, file)
                    print(f"Loading PV CSV file: {idx}")
                    conn.execute(
                        f"""
                        INSERT INTO {GEN_TABLE_NAME}
                        SELECT
                            timezone('{TIMEZONE}', {GEN_TIMESTAMP_CSV_COL_NAME}) AS new_timestamp,
                            {GEN_CSV_COL_NAME}, {idx} AS file_id
                        FROM
                            read_csv_auto('{file_path}')
                        WHERE
                            EXTRACT(YEAR FROM {GEN_TIMESTAMP_CSV_COL_NAME}) = 2024;
                    """
                    )

            print("Finished loading PV data into DuckDB.")
        else:
            print("PV table in DB already exists, skipping reload.")

        return conn

    def _sample_ids(self, conn: duckdb.DuckDBPyConnection) -> tuple[pd.DataFrame, pd.DataFrame]:
        """
        Samples NUM_IDS_SAMPLED IDs from all IDs in the database and returns a DataFrame containing
        all measurements of these IDs.
        """

        sampled_ids_load = conn.execute(
            f"""
            SELECT DISTINCT ID
            FROM {LOAD_TABLE_NAME}
            ORDER BY RANDOM()
            LIMIT {NUM_IDS_SAMPLED * APT_BLOCK_SIZE};
        """
        ).fetchall()

        sampled_ids_gen = conn.execute(
            f"""
            SELECT DISTINCT ID
            FROM {GEN_TABLE_NAME}
            ORDER BY RANDOM()
            LIMIT {NUM_IDS_SAMPLED};
        """
        ).fetchall()

        # Convert to a list of IDs for querying later
        sampled_ids_list_load = [row[0] for row in sampled_ids_load]
        sampled_ids_list_gen = [row[0] for row in sampled_ids_gen]

        # Step 2: Extract all measurements for those sampled IDs
        # Construct SQL query to select all measurements for the sampled IDs
        ids_load = ", ".join([f"'{id}'" for id in sampled_ids_list_load])
        ids_gen = ", ".join([f"'{id}'" for id in sampled_ids_list_gen])

        load_query = f"""
            SELECT *
            FROM {LOAD_TABLE_NAME}
            WHERE ID IN ({ids_load})
        """

        pv_query = f"""
            SELECT *
            FROM {GEN_TABLE_NAME}
            WHERE ID IN ({ids_gen})
        """

        return conn.execute(load_query).fetchdf(), conn.execute(pv_query).fetchdf()

    def _sample_from_db(self, conn: duckdb.DuckDBPyConnection) -> tuple[pd.DataFrame, pd.DataFrame]:
        print("Sampling measurements...")
        dfs: tuple[pd.DataFrame, pd.DataFrame] = self._sample_ids(conn)
        self._extract_timestamp_features(dfs[0])
        self._extract_timestamp_features(dfs[1])
        print("Finished sampling measurements.")
        return dfs[0], dfs[1].drop_duplicates(subset=[ID_DF_COL_NAME, TIMESTAMP_DF_COL_NAME])

    def save_to_pickle(self, df: pd.DataFrame, filename: str) -> None:
        with open(filename, "wb") as f:
            pickle.dump(df, f)

    def get_pv_data(self) -> pd.DataFrame:
        return self._sample_pv.pivot(
            index=ID_DF_COL_NAME, columns=TIMESTAMP_DF_COL_NAME, values=GEN_DF_COL_NAME
        )

    def get_load_data(self) -> pd.DataFrame:
        return self._sample_load.pivot(
            index=ID_DF_COL_NAME, columns=TIMESTAMP_DF_COL_NAME, values=LOAD_DF_COL_NAME
        )


def load_pkls() -> None:
    data_loader: DataLoader = DataLoader()

    pv_data: pd.DataFrame = data_loader.get_pv_data()
    load_data: pd.DataFrame = data_loader.get_load_data()

    os.makedirs(PKL_DIR, exist_ok=True)

    data_loader.save_to_pickle(pv_data, os.path.join(PKL_DIR, PKL_PV_FILE))
    data_loader.save_to_pickle(load_data, os.path.join(PKL_DIR, PKL_LOAD_FILE))


if __name__ == "__main__":
    load_pkls()
