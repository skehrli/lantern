#!/usr/bin/env python3

import os
from ec_data_analysis import ECDataset
from typing import Optional
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

def main() -> None:
    data: pd.DataFrame = pd.read_excel("../ec-data-analysis/data/EC_EV_dataset.xlsx", sheet_name=None)
    production: pd.DataFrame = getSheet("PV", data)
    consumption: pd.DataFrame = getSheet("Load", data)

    # TODO: average the values over an hour timespan
    ecData: ECDataset = ECDataset(production, consumption, 1)
    ecData.createReport()

    # pnet_data: pd.DataFrame | None = csv_to_df("../maxflowcode/Pnet.csv")
    # match pnet_data:
    #     case pd.DataFrame():
    #         cons: pd.DataFrame = pnet_data.clip(lower=0)
    #         prod: pd.DataFrame = (-pnet_data).clip(lower=0)
    #
    #         print((prod > 0.1).sum(axis=0))
    #         print(prod.shape[0])
            # print((cons > 0).sum(axis=0))
            # ec_pnet: ECDataset = ECDataset(prod, cons, 0.5)
            # ec_pnet.createReport()

    # Example usage
    # demand_dist = fit_lognormal_distribution(market_demand)
    # supply_dist = fit_lognormal_distribution(market_supply)

    # Example usage:
    # plot_distributions(demand_dist, supply_dist)
    # plot_lognormal_comparison(demand_dist, supply_dist)


if __name__ == "__main__":
    main()
