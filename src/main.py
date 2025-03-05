#!/usr/bin/env python3

"""
main.py

This module is the driver of the simulation. It loads the prepared dataframes and
calls into the simulation code.
"""

import os
import random
from src.constants import PKL_DIR, PKL_LOAD_FILE, PKL_PV_FILE
from .ec_dataset import ECDataset
from .data_loader import load_pkls
from .models import SimulationResult
from enum import Enum
from typing import Callable
import pandas as pd
import numpy as np
import pickle
import matplotlib.pyplot as plt


def fetch_pkl(filename: str) -> pd.DataFrame:
    is_cached: bool = os.path.exists(os.path.join(PKL_DIR, PKL_LOAD_FILE))
    if not is_cached:
        load_pkls()
    assert os.path.exists(os.path.join(PKL_DIR, PKL_LOAD_FILE))
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
    Season.SPRING: {3, 4, 5},   # March - May
    Season.SUMMER: {6, 7, 8},   # June - August
    Season.FALL: {9, 10, 11},   # September - November
}

in_season: Callable[[Season, pd.Timestamp], bool] = (
    lambda season, timestamp: timestamp.month in SEASON_MONTHS[season]
)


def run_simulation(
    community_size: int,
    season: str,
    pv_percentage: int,
    sd_percentage: int,
    with_battery: bool
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
    # load dataframes
    pv_data: pd.DataFrame = fetch_pkl(os.path.join(PKL_DIR, PKL_PV_FILE))
    load_data: pd.DataFrame = fetch_pkl(os.path.join(PKL_DIR, PKL_LOAD_FILE))

    # Convert season string to enum
    if season not in SEASON_MAP:
        raise ValueError(f"Invalid season: {season}. Must be one of: sum, win, aut, spr")
    season_enum: Season = SEASON_MAP[season]

    # Validate inputs
    if not (5 <= community_size <= 100):
        raise ValueError("Community size must be between 5 and 100")
    if not (0 <= pv_percentage <= 100):
        raise ValueError("PV percentage must be between 0 and 100")
    if not (0 <= sd_percentage <= 100):
        raise ValueError("Smart Device percentage must be between 0 and 100")

    # only keep community_size rows
    num_rows: int = pv_data.shape[0]
    sampled_rows: list[int] = random.sample(range(num_rows), community_size)
    pv_data = pv_data.iloc[sampled_rows]
    load_data = load_data.iloc[sampled_rows]

    # only keep datapoints in specified season
    pv_data = pv_data.loc[:, [in_season(season_enum, col) for col in pv_data.columns]]
    load_data = load_data.loc[:, [in_season(season_enum, col) for col in load_data.columns]]
    pv_data = pv_data.reset_index(drop=True)
    load_data = load_data.reset_index(drop=True)

    # set pv datapoints to zero for members without pv
    num_members_without_pv: int = community_size - int(pv_percentage * community_size / 100)
    members_without_pv: list[int] = random.sample(range(community_size), num_members_without_pv)
    pv_data.loc[members_without_pv, :] = 0

    return ECDataset(pv_data.T, load_data.T, 1, sd_percentage, with_battery).simulate()

def get_valid_season() -> Season:
    """Continuously prompts the user until they enter a valid season."""
    while True:
        value: str = input("Season (sum/win/aut/spr)? ").strip().lower()
        if value in SEASON_MAP:
            return SEASON_MAP[value]
        else:
            print(f"Please enter a season of (sum/win/aut/spr).")


def get_valid_int(prompt: str, min_value: int, max_value: int) -> int:
    """Continuously prompts the user until they enter a valid integer within a range."""
    while True:
        try:
            value: int = int(input(prompt).strip())  # Get input and convert to integer
            if min_value <= value <= max_value:
                return value
            else:
                print(f"Please enter a number between {min_value} and {max_value}.")
        except ValueError:
            print("Invalid input! Please enter a valid number.")


def get_valid_bool(prompt: str) -> bool:
    """Continuously prompts the user until they enter a valid bool."""
    while True:
        value = input(prompt).strip().lower()
        if value == "y":
            return True
        elif value == "n":
            return False
        else:
            print(f"Please enter y or n.")

def main() -> None:
    community_size: int = get_valid_int("Size of LEC (5-100)? ", 5, 100)
    season: Season = get_valid_season()
    pv_percentage: int = get_valid_int("Percentage of buildings with PV (0-100)? ", 0, 100)
    sd_percentage: int = get_valid_int("Percentage of buildings with Smart Devices (0-100)? ", 0, 100)
    with_battery: bool = get_valid_bool("With battery (y/n)? ")

    ecData = run_simulation(
        community_size=community_size,
        season=season.value,
        pv_percentage=pv_percentage,
        sd_percentage=sd_percentage,
        with_battery=with_battery
    )


if __name__ == "__main__":
    main()
