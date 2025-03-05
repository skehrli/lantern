#!/usr/bin/env python3

"""
ec_dataset.py

This module contains the ECDataset class, which is used to manage and manipulate
datasets for energy communities.
"""

from .models import SimulationResult, EnergyMetrics, CostMetrics
from .battery import Battery
from .constants import BATTERY_SIZE, P2P_PRICE, GRID_BUY_PRICE, GRID_SELL_PRICE
from .market_solution import MarketSolution
from .plot_utils import PlotUtils
from scipy.signal import find_peaks
import pandas as pd
import numpy as np
import numpy.typing as npt
from typing import List, Optional, Self
from functools import cached_property


class ECDataset:
    def __init__(
        self: Self,
        production: pd.DataFrame,
        consumption: pd.DataFrame,
        timestepDuration: float,
        smart_device_percentage: int = 0,
        with_battery: bool = False,
    ) -> None:
        """
        Initialize the data class with production and consumption DataFrames.

        :param production: DataFrame containing production data. production[i][j] is the production in w/h of member j in time interval i.
        :param consumption: DataFrame containing consumption data. consumption[i][j] is the usage in w/h of member j in time interval i.

        :ivar production: DataFrame with production[i][j] being the production in w/h of member j in time interval i.
        :ivar consumption: DataFrame with consumption[i][j] being the usage in w/h of member j in time interval i.
        :ivar supply: DataFrame with supply[i][j] being the amount member j is selling in interval i.
        :ivar demand: DataFrame with demand[i][j] being the amount member j is buying in interval i.
        """

        # The 4 core DataFrames
        self.production: pd.DataFrame
        self.consumption: pd.DataFrame
        self.supply: pd.DataFrame
        self.demand: pd.DataFrame

        # Dimensions of the above DataFrames: rows/columns
        self.numParticipants: int
        self.numTimesteps: int

        # duration of one timestep as a fraction/multiple of an hour
        self.timestepDuration: float

        # solutions to the flow problem per time interval
        self.marketSolutions: List[MarketSolution] = []

        self._total_charge_volume: float = 0.0
        self._total_discharge_volume: float = 0.0
        self._charge_volume_per_member: np.ndarray
        self._discharge_volume_per_member: np.ndarray

        assert (
            production.shape == consumption.shape
        ), f"production and consumption have unequal shapes {production.shape} and {consumption.shape}"
        self._smart_device_percentage: int = smart_device_percentage
        self._with_battery: bool = with_battery
        self.timestepDuration = timestepDuration
        self.numTimesteps, self.numParticipants = production.shape
        self._charge_volume_per_member = np.zeros(self.numParticipants)
        self._discharge_volume_per_member = np.zeros(self.numParticipants)

        # ensure columns are 0,1,..,numParticipants-1
        production.columns = range(self.numParticipants)
        consumption.columns = range(self.numParticipants)
        self.production = production
        self.consumption = consumption
        self.supply = (production - consumption).clip(lower=0)
        self.demand = (consumption - production).clip(lower=0)

    def simulate(self: Self) -> SimulationResult:
        if self._with_battery:
            self._adjust_for_batteries()

        self._adjust_for_smart_devices(self._smart_device_percentage)

        for t in range(self.numTimesteps):
            self.marketSolutions.append(
                MarketSolution(self.supply.iloc[t], self.demand.iloc[t])
            )
        return self._evaluate()

    def _evaluate(self: Self) -> SimulationResult:
        PlotUtils.visualizeTradingNetwork(
            MarketSolution.overall_trading_network,
            self.getGridPurchaseVolume(),
            self.getGridFeedInVolume(),
        )
        return SimulationResult(
            energy_metrics=EnergyMetrics(
                total_production=float(self.getProductionVolume),
                total_consumption=float(self.getConsumptionVolume),
            ),
            cost_metrics=CostMetrics(
                total_cost_with_lec=float(sum(self.computePricePerMember(True)) / 100),
                total_cost_without_lec=float(
                    sum(self.computePricePerMember(False)) / 100
                ),
            ),
        )
        # self.printKeyStats()
        # PlotUtils.visualizeEnergyConsumptionBreakdown(
        #     self.getSelfConsumptionVolume,
        #     self.getTradingVolume,
        #     self.getDischargeVolume(),
        #     self.getGridPurchaseVolume(),
        # )
        # PlotUtils.visualizeEnergyProductionBreakdown(
        #     self.getSelfConsumptionVolume,
        #     self.getTradingVolume,
        #     self.getChargeVolume(),
        #     self.getGridFeedInVolume(),
        # )
        # PlotUtils.visualizeSellRatioDistribution(
        #     self.getSellVolumePerMember, self.getSupplyPerMember
        # )
        # PlotUtils.visualizeBuyRatioDistribution(
        #     self.getBuyVolumePerMember, self.getDemandPerMember
        # )
        # PlotUtils.visualizeSupplyDemandCurves(self.supply, self.demand)

    def computePricePerMember(self: Self, with_lec: bool) -> npt.NDArray[np.float64]:
        costPerMember: npt.NDArray[np.float64] = np.zeros(
            self.numParticipants, dtype=np.float64
        )
        for i in range(self.numParticipants):
            for t in range(self.numTimesteps):
                amountRequired: float = self.demand.iloc[t, i]
                amountFromMarket: float = (
                    self.marketSolutions[t].getQtyPurchasedForMember(i)
                    if with_lec
                    else 0
                )
                costTrading: float = amountFromMarket * P2P_PRICE
                amountFromGrid: float = amountRequired - amountFromMarket
                costGrid: float = amountFromGrid * GRID_BUY_PRICE

                amountSelling: float = self.supply.iloc[t, i]
                amountToMarket: float = (
                    self.marketSolutions[t].getQtySoldForMember(i) if with_lec else 0
                )
                profitTrading: float = amountToMarket * P2P_PRICE
                amountToGrid: float = amountSelling - amountToMarket
                profitGrid: float = amountToGrid * GRID_SELL_PRICE

                costPerMember[i] += costGrid + costTrading - profitGrid - profitTrading

        return costPerMember

    def printKeyStats(self: Self) -> None:
        print(
            "Overall consumption (kw/h)",
            self.getConsumptionVolume,
        )
        print(
            "Overall production (kw/h)",
            self.getProductionVolume,
        )
        print(
            "Overall trading volume (kw/h)",
            self.getTradingVolume,
        )
        print(
            "Nr of overproduction vs overconsumption datapoints",
            self.compareProductionWithConsumption,
        )
        if self.getDemandVolume != 0:
            print(
                "Ratio of market demand fulfilled",
                self.getTradingVolume / self.getDemandVolume,
            )
        if self.getSupplyVolumeImprecise != 0:
            print(
                "Ratio of market supply sold",
                self.getTradingVolume / self.getSupplyVolumeImprecise,
            )

    def _adjust_for_batteries(self: Self) -> None:
        # assume everyone has pv (and battery), since ones without pv just have 0 in pv_data
        batteries = np.array(
            [
                Battery(BATTERY_SIZE, self.timestepDuration)
                for _ in range(self.numParticipants)
            ]
        )
        charge_volume_per_member = np.zeros(self.numParticipants)
        discharge_volume_per_member = np.zeros(self.numParticipants)
        for t in range(self.numTimesteps):
            for i in range(self.numParticipants):
                if self.supply.iloc[t, i] > 0:
                    chargeAmount: float = batteries[i].charge(self.supply.iloc[t, i])
                    charge_volume_per_member[i] += chargeAmount
                    self.supply.iloc[t, i] -= chargeAmount
                elif self.demand.iloc[t, i] > 0:
                    dischargeAmount: float = batteries[i].discharge(
                        self.demand.iloc[t, i]
                    )
                    discharge_volume_per_member[i] += dischargeAmount
                    self.demand.iloc[t, i] -= dischargeAmount
        self._total_charge_volume = sum(charge_volume_per_member)
        self._total_discharge_volume = sum(discharge_volume_per_member)
        self._charge_volume_per_member = charge_volume_per_member
        self._discharge_volume_per_member = discharge_volume_per_member

    def _adjust_for_smart_devices(self: Self, smart_device_percentage: int) -> None:
        """
        Attempts to reduce peak loads by shifting loads for a subset of users while increasing PV consumption,
        and ensuring that loads are not shifted outside 8 AM - 10 PM.
        """
        df_shifted = self.consumption
        users = self.consumption.columns
        shiftable_users = np.random.choice(
            users, size=int(len(users) * smart_device_percentage / 100), replace=False
        )

        # Dishwasher and washing machine shifting amounts (daily and every 3 days)
        shift_daily = 0.64  # kWh
        shift_3day = 0.5  # kWh

        # convert timestamps to date for grouping
        self.consumption["date"] = self.consumption.index.date
        self.production["date"] = self.production.index.date
        grouped_load = self.consumption.groupby("date")
        grouped_generation = self.production.groupby("date")

        for day, data in grouped_load:

            # find peak hours of each day in allowed time range
            N_peaks = 3  # number of peaks
            total_demand = data.drop(columns=["date"], errors="ignore").sum(axis=1)

            valid_hours = total_demand.between_time("08:00", "22:00")

            peak_indices, _ = find_peaks(valid_hours, prominence=0.2, distance=N_peaks)
            peak_hours = (
                valid_hours.iloc[peak_indices].nlargest(3).index
                if len(peak_indices) > 0
                else valid_hours.nlargest(3).index
            )
            # print("peak hours: ", peak_hours)

            # find valley hours in allowed time range
            valley_hours = valid_hours.nsmallest(N_peaks).index  # lowest 3 hours
            # print("valley hours: ", valley_hours)

            # Get PV generation for the same day
            pv_data = grouped_generation.get_group(day).drop(
                columns=["date"], errors="ignore"
            )
            pv_generation = pv_data.sum(axis=1)
            # all 3 highest pv hours are probably from same "pv peak"
            high_pv_hours = pv_generation.nlargest(
                3
            ).index  # assuming these are in the valid range of hours.
            # print("high pv hours:", high_pv_hours)

            # shift daily load (dishwasher)
            if len(peak_hours) > 0:
                peak_hour = peak_hours[0]  # take the highest peak
                for user in shiftable_users:
                    if (
                        df_shifted.loc[peak_hour, user] >= shift_daily
                    ):  # user has enough load to shift
                        # try to shift to high PV generation hours
                        shift_target = (
                            np.random.choice(high_pv_hours)
                            if not high_pv_hours.empty
                            else np.random.choice(valley_hours)
                        )
                        # shift the load
                        df_shifted.loc[peak_hour, user] -= shift_daily
                        df_shifted.loc[shift_target, user] += shift_daily

            # shift every 3 days (washing machine)
            if day.day % 3 == 0 and len(peak_hours) > 0:
                peak_hour = (
                    peak_hours[1] if len(peak_hours) > 1 else peak_hours[0]
                )  # try to use 2nd highest peak
                for user in shiftable_users:
                    if df_shifted.loc[peak_hour, user] >= shift_3day:
                        shift_target = (
                            np.random.choice(high_pv_hours)
                            if not high_pv_hours.empty
                            else np.random.choice(valley_hours)
                        )
                        df_shifted.loc[peak_hour, user] -= shift_3day
                        df_shifted.loc[shift_target, user] += shift_3day

        self.production.drop(columns=["date"], inplace=True, errors="ignore")
        self.consumption.drop(columns=["date"], inplace=True, errors="ignore")

        self.consumption = df_shifted

    def getDischargeVolumePerMember(self: Self) -> Optional[np.ndarray]:
        return self._discharge_volume_per_member

    def getChargeVolumePerMember(self: Self) -> Optional[np.ndarray]:
        return self._charge_volume_per_member

    def getDischargeVolume(self: Self) -> float:
        return self._total_discharge_volume

    def getChargeVolume(self: Self) -> float:
        return self._total_charge_volume

    def getGridFeedInVolume(self: Self) -> float:
        """
        Returns the overall energy fed into the grid over the timeframe of the dataset.
        """
        return max(
            0,
            self.getProductionVolume
            - self.getSelfConsumptionVolume
            - self.getTradingVolume
            - self.getChargeVolume(),
        )

    def getGridPurchaseVolume(self: Self) -> float:
        """
        Returns the overall energy purchased from the grid over the timeframe of the dataset.
        """
        return max(
            0,
            self.getConsumptionVolume
            - self.getSelfConsumptionVolume
            - self.getTradingVolume
            - self.getDischargeVolume(),
        )

    @cached_property
    def compareProductionWithConsumption(self: Self) -> tuple[int, int]:
        return (self.supply > 0).sum().sum(), (self.demand > 0).sum().sum()

    @cached_property
    def getSelfConsumptionVolume(self: Self) -> float:
        """
        Returns the volume of self-consumed energy over the timeframe of the dataset.
        """
        selfConsumption: pd.DataFrame = self.production - self.supply
        return selfConsumption.sum().sum()

    @cached_property
    def getTradingVolume(self: Self) -> float:
        """
        Returns the overall trading volume over the timeframe of the dataset.
        """
        return sum(sol.tradingVolume for sol in self.marketSolutions)

    @cached_property
    def getDemandVolume(self: Self) -> float:
        """
        Returns the overall demand on the market over the timeframe of the dataset.
        """
        return self.demand.sum().sum()

    @cached_property
    def getSupplyVolumeImprecise(self: Self) -> float:
        """
        Returns the overall supply as summed by each timestep. It differs slightly
        due to floating point imprecision, but is a better measure to determine the ratio
        of sold supply on the market (since the supply sold on market uses this number).
        """
        return sum(sol.supplyVolume for sol in self.marketSolutions)

    @cached_property
    def getSupplyVolume(self: Self) -> float:
        """
        Returns the overall supply on the market over the timeframe of the dataset.
        """
        return self.supply.sum().sum()

    @cached_property
    def getConsumptionVolume(self: Self) -> float:
        """
        Returns the overall consumption of all participants over the timeframe of the dataset.
        """
        return self.consumption.sum().sum()

    @cached_property
    def getProductionVolume(self: Self) -> float:
        """
        Returns the overall production of all participants over the timeframe of the dataset.
        """
        return self.production.sum().sum()

    @cached_property
    def getDemandPerMember(self: Self) -> pd.Series:
        """
        Returns a map from participant to its overall demand.
        """
        return self.demand.sum()

    @cached_property
    def getSupplyPerMember(self: Self) -> pd.Series:
        """
        Returns a map from participant to its overall supply.
        """
        return self.supply.sum()

    @cached_property
    def getSellVolumePerMember(self: Self) -> pd.Series:
        """
        Returns a map from participant to its overall sell volume.
        """
        return pd.Series(
            {
                i: sum(sol.getQtySoldForMember(i) for sol in self.marketSolutions)
                for i in range(self.numParticipants)
            }
        )

    @cached_property
    def getBuyVolumePerMember(self: Self) -> pd.Series:
        """
        Returns a map from participant to its overall buy volume.
        """
        return pd.Series(
            {
                i: sum(sol.getQtyPurchasedForMember(i) for sol in self.marketSolutions)
                for i in range(self.numParticipants)
            }
        )
