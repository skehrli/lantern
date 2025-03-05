#!/usr/bin/env python3

"""
constants.py

Holds constants used in the entire project, which are "meta-parameters" for the developer.
"""

from typing import TypeAlias
import seaborn as sns

NetworkAlloc: TypeAlias = dict[str, dict[str, float]]

# number of apartments per residential building
APT_BLOCK_SIZE: int = 6
# peak PV production in kwh per residential building
PV_CAPACITY: float = 20.0
# battery capacity in kwh per residential building
BATTERY_SIZE: int = 10

# prices
GRID_BUY_PRICE: float = 21.12
# GRID_BUY_PRICE: Callable[[pd.Timestamp], float] = lambda time: 12.0 if (time.hour < 6 or time.hour >= 22) else 15.0
GRID_SELL_PRICE: float = 4.6
P2P_PRICE: float = 12.86

# battery retention rate per hour
RETENTION_RATE: float = 0.999
# conversion loss for every battery transaction
CONVERSION_LOSS: float = 0.05
# (dis)charging rate - must take at least 1/C_RATE hours to (dis)charge battery
C_RATE: float = 0.5
# minimum allowed charging level
DISCHARGE_THRESHOLD = 0.15
# maximum allowed charging level
CHARGE_THRESHOLD = 1 - DISCHARGE_THRESHOLD

# flow network
SOURCE: str = "s"
BATTERY: str = "b"
TARGET: str = "t"
UNBOUNDED: float = float("inf")

# numerical error margin
EPS: float = 1e-7

# decimal points to round to
DECIMAL_POINTS: int = 2

# number of bins for bar charts
N_BINS: int = 100

# seaborn color palette used for plots
COLOR_PALETTE: str = "deep"

# subdirectories
OUT_DIR: str = "out"
PKL_DIR: str = "cache"
PKL_LOAD_FILE: str = "load.pkl"
PKL_PV_FILE: str = "pv.pkl"


class Constants:
    @staticmethod
    def getColorPalette(numColors: int):
        return sns.color_palette(COLOR_PALETTE, numColors)
