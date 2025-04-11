#!/usr/bin/env python3

"""
ec_dataset.py

This module contains the ECDataset class, which is used to manage and manipulate
datasets for energy communities.
"""

from .models import SimulationResult, EnergyMetrics, IndividualMetrics, CostMetrics, TradingNetwork, Profiles
from .battery import Battery
from .constants import BATTERY_SIZE, P2P_PRICE, GRID_BUY_PRICE, GRID_SELL_PRICE, NetworkAlloc, APT_BLOCK_SIZE, RANDOM_SEED
from .market_solution import MarketSolution
from scipy.signal import find_peaks
import pandas as pd
import numpy as np
import networkx as nx
import numpy.typing as npt
from typing import List, Optional, Self


def get_daily_profile(data: pd.DataFrame) -> List[float]:
    data.index = pd.to_datetime(data.index)
    return data.groupby(data.index.hour).mean().mean(axis=1).tolist()

def adjust_for_smart_devices(smart_device_percentage: int, load: pd.DataFrame, pv: pd.DataFrame) -> pd.DataFrame:
    """
    Attempts to reduce peak loads by shifting loads for a subset of users while increasing PV consumption,
    and ensuring that loads are not shifted outside 8 AM - 10 PM.
    """
    if smart_device_percentage == 0:
        return load

    load_shifted = load.copy()
    users = load_shifted.columns
    shiftable_users = np.random.choice(
        users, size=int(len(users) * smart_device_percentage / 100), replace=False
    )

    shift_daily = 0.64  # kWh
    shift_3day = 0.5  # kWh

    # convert timestamps to date for grouping
    load_shifted["date"] = load_shifted.index.date
    pv_copy = pv.copy()
    pv_copy["date"] = pv_copy.index.date
    grouped_load = load_shifted.groupby("date")
    grouped_generation = pv_copy.groupby("date")

    for day, data in grouped_load:

        # find peak hours of each day in allowed time range
        N_peaks = 3
        total_demand = data.drop(columns=["date"], errors="ignore").sum(axis=1)

        valid_hours = total_demand.between_time("08:00", "22:00")

        peak_indices, _ = find_peaks(valid_hours, prominence=0.2, distance=N_peaks)
        peak_hours = (
            valid_hours.iloc[peak_indices].nlargest(3).index
            if len(peak_indices) > 0
            else valid_hours.nlargest(3).index
        )

        valley_hours = valid_hours.nsmallest(N_peaks).index

        # Get PV generation for the same day
        pv_data = grouped_generation.get_group(day).drop(
            columns=["date"], errors="ignore"
        )
        pv_generation = pv_data.sum(axis=1)
        # all 3 highest pv hours are probably from same "pv peak"
        high_pv_hours = pv_generation.nlargest(
            3
        ).index  # assuming these are in the valid range of hours.

        # shift daily load (dishwasher)
        if len(peak_hours) > 0:
            peak_hour = peak_hours[0]  # take the highest peak
            for user in shiftable_users:
                if (
                    load_shifted.loc[peak_hour, user] >= shift_daily
                ):  # user has enough load to shift
                    # try to shift to high PV generation hours
                    shift_target = (
                        np.random.choice(high_pv_hours)
                        if not high_pv_hours.empty
                        else np.random.choice(valley_hours)
                    )
                    # shift the load
                    load_shifted.loc[peak_hour, user] -= shift_daily
                    load_shifted.loc[shift_target, user] += shift_daily

        # shift every 3 days (washing machine)
        if day.day % 3 == 0 and len(peak_hours) > 0:
            peak_hour = (
                peak_hours[1] if len(peak_hours) > 1 else peak_hours[0]
            )  # try to use 2nd highest peak
            for user in shiftable_users:
                if load_shifted.loc[peak_hour, user] >= shift_3day:
                    shift_target = (
                        np.random.choice(high_pv_hours)
                        if not high_pv_hours.empty
                        else np.random.choice(valley_hours)
                    )
                    load_shifted.loc[peak_hour, user] -= shift_3day
                    load_shifted.loc[shift_target, user] += shift_3day

    return load_shifted.drop(columns="date")

def adjust_for_batteries(supply: pd.DataFrame, demand: pd.DataFrame, timestepDuration: float) -> tuple[np.ndarray, np.ndarray]:
    # assume everyone has pv (and battery), since ones without pv just have 0 in pv_data
    numTimesteps: int; numParticipants: int
    numTimesteps, numParticipants = supply.shape
    batteries = np.array(
        [
            Battery(BATTERY_SIZE, timestepDuration)
            for _ in range(numParticipants)
        ]
    )
    charge_volume_per_member = np.zeros(numParticipants)
    discharge_volume_per_member = np.zeros(numParticipants)
    for t in range(numTimesteps):
        for i in range(numParticipants):
            if supply.iloc[t, i] > 0:
                chargeAmount: float = batteries[i].charge(supply.iloc[t, i])
                charge_volume_per_member[i] += chargeAmount
                supply.iloc[t, i] -= chargeAmount
            elif demand.iloc[t, i] > 0:
                dischargeAmount: float = batteries[i].discharge(
                    demand.iloc[t, i]
                )
                discharge_volume_per_member[i] += dischargeAmount
                demand.iloc[t, i] -= dischargeAmount

    return charge_volume_per_member, discharge_volume_per_member

def getTradingNetwork(gridPurchaseVol: float, gridFeedInVol: float) -> nx.DiGraph:
    network: NetworkAlloc = MarketSolution.overall_trading_network

    G: nx.DiGraph = nx.DiGraph()

    # Add edges to the graph from the dictionary
    for u, neighbors in network.items():
        for v, weight in neighbors.items():
            G.add_edge(u, v, weight=weight)

    return G

def aggregate_into_buildings(load: pd.DataFrame) -> pd.DataFrame:
    load = load.T
    if len(load) % APT_BLOCK_SIZE != 0:
        print(len(load))
        raise ValueError(f"The number of rows must be divisible by {APT_BLOCK_SIZE} for aggregation.")

    shuffled_load = load.sample(frac=1, random_state=RANDOM_SEED).reset_index(drop=True)

    num_buildings = len(shuffled_load) // 6
    shuffled_load['Building_ID'] = np.repeat(np.arange(num_buildings), APT_BLOCK_SIZE)
    return pd.DataFrame(shuffled_load.groupby('Building_ID').sum()).T

def average_per_month(consumption: pd.DataFrame, production: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    consumption = consumption.T; production = production.T
    pv_data_monthly = pd.DataFrame()
    load_data_monthly = pd.DataFrame()
    months = sorted(set(col.month for col in production.columns))
    for month in months:
        pv_month_cols = [col for col in production.columns if col.month == month]
        load_month_cols = [col for col in consumption.columns if col.month == month]
        # Group by hour of day and average
        for hour in range(24):
            # Get columns for this hour in this month
            pv_hour_cols = [col for col in pv_month_cols if col.hour == hour]
            load_hour_cols = [col for col in load_month_cols if col.hour == hour]

            if pv_hour_cols and load_hour_cols:
                timestamp = pd.Timestamp(2024, month, 15, hour)
                pv_data_monthly[timestamp] = production[pv_hour_cols].mean(axis=1)
                load_data_monthly[timestamp] = consumption[load_hour_cols].mean(axis=1)
    return load_data_monthly.T, pv_data_monthly.T

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

        np.random.seed(RANDOM_SEED)

        assert (
            production.shape[0] == consumption.shape[0] and production.shape[1] * APT_BLOCK_SIZE == consumption.shape[1]
        ), f"production and consumption have unexpected shapes {production.shape} and {consumption.shape}. Column difference {set(production.columns) - set(consumption.columns)}"
        self._smart_device_percentage: int = smart_device_percentage
        self._with_battery: bool = with_battery
        self.timestepDuration = timestepDuration
        self.numTimesteps, self.numParticipants = production.shape
        self._charge_volume_per_member = np.zeros(self.numParticipants)
        self._discharge_volume_per_member = np.zeros(self.numParticipants)

        # ensure columns are 0,1,..,numParticipants-1
        production.columns = range(self.numParticipants)
        consumption.columns = range(self.numParticipants * APT_BLOCK_SIZE)
        self.production = production
        self.consumption = consumption

    def simulate(self: Self) -> SimulationResult:
        # reset the static field for the trading network to avoid overlapping with other simulations
        MarketSolution.overall_trading_network = {}

        # compute the number of days the simulation timeframe covers
        numDaysInSim: float = self.numTimesteps * self.timestepDuration / 24

        load: pd.DataFrame = self.consumption
        pv: pd.DataFrame = self.production

        load = adjust_for_smart_devices(self._smart_device_percentage, load, pv)

        # aggregate households into buildings and average to monthly load profiles
        # requires reassigning numParticipants and numTimesteps (both are reduced)
        load = aggregate_into_buildings(load)

        # compute daily average load/gen profiles before averaging
        daily_load_profile: List[float] = get_daily_profile(load)
        daily_gen_profile: List[float] = get_daily_profile(pv)

        load, pv = average_per_month(load, pv)

        self.numTimesteps, self.numParticipants = load.shape
        supply: pd.DataFrame = (pv - load).clip(lower=0)
        demand: pd.DataFrame = (load - pv).clip(lower=0)

        charge_volume_per_member: np.ndarray = np.zeros(self.numParticipants)
        discharge_volume_per_member: np.ndarray = np.zeros(self.numParticipants)

        if self._with_battery:
            charge_volume_per_member, discharge_volume_per_member = adjust_for_batteries(supply, demand, self.timestepDuration)

        # compute the market
        for t in range(self.numTimesteps):
            self.marketSolutions.append(
                MarketSolution(supply.iloc[t], demand.iloc[t])
            )

        # assign all fields for evaluation
        self.consumption = load
        self.production = pv
        self.supply = supply
        self.demand = demand
        self._charge_volume_per_member = charge_volume_per_member
        self._discharge_volume_per_member = discharge_volume_per_member
        self._total_charge_volume = sum(charge_volume_per_member)
        self._total_discharge_volume = sum(discharge_volume_per_member)


        # compute the number of days which are actually computed (due to averaging its less than
        # the number of days the input dataset covers)
        numDaysComputed: float = self.numTimesteps * self.timestepDuration / 24

        G = getTradingNetwork(self.getGridPurchaseVolume(), self.getGridFeedInVolume())
        return SimulationResult(
            energy_metrics=EnergyMetrics(
                total_consumption=float(self.getConsumptionVolume()),
                total_grid_import=float(self.getGridPurchaseVolume()),
                self_consumption_volume=float(self.getSelfConsumptionVolume()),
                trading_volume=float(self.getTradingVolume()),
                total_discharging_volume=float(self.getDischargeVolume()),
                total_production=float(self.getProductionVolume()),
                total_grid_export=float(self.getGridFeedInVolume()),
                total_charging_volume=float(self.getChargeVolume()),
            ),
            individual_metrics=IndividualMetrics(
                individual_selfconsumption_volume=self.getSelfConsumptionVolumePerMember(),
                individual_grid_import=self.getGridPurchaseVolumePerMember(),
                individual_market_purchase_volume=self.getBuyVolumePerMember(),
                individual_discharging_volume=self.getDischargeVolumePerMember(),
                individual_grid_export=self.getGridFeedInVolumePerMember(),
                individual_market_sell_volue=self.getSellVolumePerMember(),
                individual_charging_volume=self.getChargeVolumePerMember(),
            ),
            cost_metrics=CostMetrics(
                cost_with_lec=float(sum(self.computePricePerMember(True)) * numDaysInSim / numDaysComputed / (100.0 * self.numParticipants * APT_BLOCK_SIZE)),
                cost_without_lec=float(
                    sum(self.computePricePerMember(False)) * numDaysInSim / numDaysComputed / (100.0 * self.numParticipants * APT_BLOCK_SIZE)
                ),
            ),
            profiles=Profiles(
                load_profile=daily_load_profile,
                gen_profile=daily_gen_profile,
            ),
            trading_network=TradingNetwork.from_networkx(G),
        )


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
            self.getProductionVolume()
            - self.getSelfConsumptionVolume()
            - self.getTradingVolume()
            - self.getChargeVolume(),
        )

    def getGridPurchaseVolume(self: Self) -> float:
        """
        Returns the overall energy purchased from the grid over the timeframe of the dataset.
        """
        return max(
            0,
            self.getConsumptionVolume()
            - self.getSelfConsumptionVolume()
            - self.getTradingVolume()
            - self.getDischargeVolume(),
        )

    def getGridFeedInVolumePerMember(self: Self) -> np.ndarray:
        """
        Returns the per-member energy fed into the grid over the timeframe of the dataset.
        """
        return self.production.sum() - self.getSelfConsumptionVolumePerMember() - self.getSellVolumePerMember() - self.getChargeVolumePerMember()

    def getGridPurchaseVolumePerMember(self: Self) -> np.ndarray:
        """
        Returns the per-member energy purchased from the grid over the timeframe of the dataset.
        """
        return self.consumption.sum() - self.getSelfConsumptionVolumePerMember() - self.getBuyVolumePerMember() - self.getDischargeVolumePerMember()

    def compareProductionWithConsumption(self: Self) -> tuple[int, int]:
        return (self.supply > 0).sum().sum(), (self.demand > 0).sum().sum()

    def getSelfConsumptionVolume(self: Self) -> float:
        """
        Returns the volume of self-consumed energy over the timeframe of the dataset.
        """
        return self.production.sum().sum() - self.supply.sum().sum()

    def getSelfConsumptionVolumePerMember(self: Self) -> float:
        """
        Returns the volume of self-consumed energy per member over the timeframe of the dataset.
        """
        return self.production.sum() - self.supply.sum()

    def getTradingVolume(self: Self) -> float:
        """
        Returns the overall trading volume over the timeframe of the dataset.
        """
        return sum(sol.tradingVolume for sol in self.marketSolutions)

    def getDemandVolume(self: Self) -> float:
        """
        Returns the overall demand on the market over the timeframe of the dataset.
        """
        return self.demand.sum().sum()

    def getSupplyVolumeImprecise(self: Self) -> float:
        """
        Returns the overall supply as summed by each timestep. It differs slightly
        due to floating point imprecision, but is a better measure to determine the ratio
        of sold supply on the market (since the supply sold on market uses this number).
        """
        return sum(sol.supplyVolume for sol in self.marketSolutions)

    def getSupplyVolume(self: Self) -> float:
        """
        Returns the overall supply on the market over the timeframe of the dataset.
        """
        return self.supply.sum().sum()

    def getConsumptionVolume(self: Self) -> float:
        """
        Returns the overall consumption of all participants over the timeframe of the dataset.
        """
        return self.consumption.sum().sum()

    def getProductionVolume(self: Self) -> float:
        """
        Returns the overall production of all participants over the timeframe of the dataset.
        """
        return self.production.sum().sum()

    def getDemandPerMember(self: Self) -> pd.Series:
        """
        Returns a map from participant to its overall demand.
        """
        return self.demand.sum()

    def getSupplyPerMember(self: Self) -> pd.Series:
        """
        Returns a map from participant to its overall supply.
        """
        return self.supply.sum()

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
