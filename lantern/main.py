#!/usr/bin/env python3

"""
main.py

This module is the driver of the simulation for both web app and commandline entry points.
Loads the prepared dataframes from cached DataFrame, prepares the data according to the
user-specified parameters, and finally calls the simulation.
"""

import os
import random

from .constants import APT_BLOCK_SIZE, PKL_DIR, PKL_LOAD_FILE, PKL_PV_FILE, RANDOM_SEED
from .ec_dataset import ECDataset
from .models import SimulationResult
from enum import Enum
from typing import Callable
import pandas as pd
import pickle
import click


def fetch_pkl(filename: str) -> pd.DataFrame:
    is_cached: bool = os.path.exists(os.path.join(PKL_DIR, PKL_LOAD_FILE))
    if not is_cached:
        raise FileNotFoundError(
            f"Input DataFrame '{filename}' not found in directory '{PKL_DIR}'.")
    with open(filename, "rb") as f:
        return pickle.load(f)


class Season(Enum):
    SUMMER = "sum"
    WINTER = "win"
    FALL = "aut"
    SPRING = "spr"


SEASON_MAP: dict[str, Season] = {season.value: season for season in Season}

SEASON_MONTHS: dict[Season, set[int]] = {
    Season.WINTER: {12, 1, 2},  # December - February
    Season.SPRING: {3, 4, 5},  # March - May
    Season.SUMMER: {6, 7, 8},  # June - August
    Season.FALL: {9, 10, 11},  # September - November
}

in_season: Callable[[Season, pd.Timestamp], bool] = (
    lambda season, timestamp: timestamp.month in SEASON_MONTHS[season]
)


def run_simulation(
    community_size: int,
    season: str,
    pv_percentage: int,
    sd_percentage: int,
    with_battery: bool,
) -> SimulationResult:
    """
    Runs simulation with given parameters.

    Args:
        community_size: Number of buildings in the community (5-100)
        season: Season string ('sum', 'win', 'aut', 'spr')
        pv_percentage: Percentage of buildings with PV (0-100)
        sd_percentage: Percentage of buildings with Smart Devices (0-100)
        with_battery: Whether to include battery storage

    Returns:
        ECDataset: The resulting dataset from the simulation
    """
    # ensure pseudo-random choices deterministic
    random.seed(RANDOM_SEED)

    # load dataframes
    pv_data: pd.DataFrame = fetch_pkl(os.path.join(PKL_DIR, PKL_PV_FILE))
    load_data: pd.DataFrame = fetch_pkl(os.path.join(PKL_DIR, PKL_LOAD_FILE))

    # Convert season string to enum
    if season not in SEASON_MAP:
        raise ValueError(
            f"Invalid season: {season}. Must be one of: sum, win, aut, spr"
        )
    season_enum: Season = SEASON_MAP[season]

    # Validate inputs
    if not (5 <= community_size <= 100):
        raise ValueError("Community size must be between 5 and 100")
    if not (0 <= pv_percentage <= 100):
        raise ValueError("PV percentage must be between 0 and 100")
    if not (0 <= sd_percentage <= 100):
        raise ValueError("Smart Device percentage must be between 0 and 100")

    # treat december as month 0 to create continuity for winter
    pv_data = pd.DataFrame(
        pv_data[sorted(pv_data.columns, key=lambda x: (x.month % 12, x.day, x.hour))])
    load_data = pd.DataFrame(load_data[sorted(
        load_data.columns, key=lambda x: (x.month % 12, x.day, x.hour))])

    # only keep community_size rows
    num_rows: int = pv_data.shape[0]
    sampled_rows_load: list[int] = random.sample(
        range(num_rows * APT_BLOCK_SIZE), community_size * APT_BLOCK_SIZE)
    sampled_rows_pv: list[int] = random.sample(range(num_rows), community_size)
    load_data = load_data.iloc[sampled_rows_load]
    pv_data = pv_data.iloc[sampled_rows_pv]

    # only keep datapoints in specified season
    pv_data = pv_data.loc[:, [
        in_season(season_enum, col) for col in pv_data.columns]]
    load_data = load_data.loc[
        :, [in_season(season_enum, col) for col in load_data.columns]
    ]
    pv_data = pv_data.reset_index(drop=True)
    load_data = load_data.reset_index(drop=True)

    # set pv datapoints to zero for members without pv
    num_members_without_pv: int = community_size - int(
        pv_percentage * community_size / 100
    )
    members_without_pv: list[int] = random.sample(
        range(community_size), num_members_without_pv
    )
    pv_data.loc[members_without_pv, :] = 0

    common_cols = load_data.columns.intersection(pv_data.columns)
    pv_data = pd.DataFrame(pv_data[common_cols])
    load_data = pd.DataFrame(load_data[common_cols])

    return ECDataset(pv_data.T, load_data.T, 1, sd_percentage, with_battery).simulate()


@click.command()
@click.argument('size', type=click.IntRange(5, 100))
@click.argument('season', type=click.Choice([s.value for s in Season]))
@click.argument('pv', type=click.IntRange(0, 100))
@click.argument('sd', type=click.IntRange(0, 100))
@click.argument('with_battery', type=click.BOOL)
def main(size: int, season: str, pv: int, sd: int, with_battery: bool) -> None:
    """
    Entry point for simulation from commandline.
    """

    run_simulation(
        community_size=size,
        season=season,
        pv_percentage=pv,
        sd_percentage=sd,
        with_battery=with_battery,
    )


if __name__ == "__main__":
    main()
