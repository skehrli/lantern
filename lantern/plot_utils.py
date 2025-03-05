#!/usr/bin/env python3

"""
plot_utils.py

Provides collection of plotting and visualization methods.
"""

import os
import seaborn as sns
import matplotlib.pyplot as plt
from typing import List, Any
import pandas as pd
import numpy as np
import networkx as nx
from numpy import floating
from numpy.typing import NDArray
from .constants import OUT_DIR, N_BINS, Constants, NetworkAlloc


class PlotUtils:
    @staticmethod
    def visualizeEnergyConsumptionBreakdown(
        selfConsumptionVolume: float,
        tradingVolume: float,
        dischargeVolume: float,
        gridPurchaseVolume: float,
    ) -> None:
        """
        Plots where the consumed energy comes from (self-production, market, battery, grid).
        """
        # Retrieve energy breakdown for consumption
        consumption_values = [
            selfConsumptionVolume,  # Energy consumed from self-production
            tradingVolume,  # Energy consumed from the market
            dischargeVolume,  # Energy consumed from battery discharge
            gridPurchaseVolume,  # Energy consumed from the grid
        ]

        PlotUtils.createEnergyBreakdownDonutChart(
            "Energy Consumption by Source", consumption_values
        )
        plt.show()

    @staticmethod
    def visualizeEnergyProductionBreakdown(
        selfConsumptionVolume: float,
        tradingVolume: float,
        chargeVolume: float,
        gridFeedInVolume: float,
    ) -> None:
        """
        Plots where the produced energy goes to (self-consumption, market, battery, grid).
        """
        # Retrieve energy breakdown for production
        production_values = [
            selfConsumptionVolume,  # Energy used in self-consumption
            tradingVolume,  # Energy sold to the market
            chargeVolume,  # Energy stored in the battery
            gridFeedInVolume,  # Energy fed back into the grid
        ]

        PlotUtils.createEnergyBreakdownDonutChart(
            "Energy Production by Destination", production_values
        )
        plt.show()

    @staticmethod
    def visualizeSupplyDemandCurves(supply: pd.DataFrame, demand: pd.DataFrame) -> None:
        """
        Plots the supply and demand curves over the dataset period.
        """
        supplyCurve: pd.Series = supply.sum(axis=1)
        demandCurve: pd.Series = demand.sum(axis=1)

        palette = Constants.getColorPalette(6)
        plt.figure(figsize=(12, 6))

        plt.plot(
            supplyCurve.index,
            supplyCurve,
            label="Supply Curve",
            color=palette[1],
        )
        plt.plot(
            demandCurve.index,
            demandCurve,
            label="Demand Curve",
            color=palette[2],
        )
        plt.title("Supply and Demand Curves")
        plt.xlabel("Time Interval")
        plt.ylabel("kw/h")
        plt.legend()
        plt.grid(True)
        plt.show()

    @staticmethod
    def visualizeSellRatioDistribution(
        sellVolumePerMember: pd.Series, supplyPerMember: pd.Series
    ) -> None:
        """
        Make a bar chart visualizing the distribution of the ratio of sold supply.
        """
        sellRatioVec: pd.Series = (sellVolumePerMember) / supplyPerMember
        sellRatioVec = sellRatioVec.replace([np.inf], 0)

        hist: pd.Series
        edges: NDArray[floating[Any]]
        hist, edges = PlotUtils.getHistForRatioValues(sellRatioVec)

        # Create the bar chart
        plt.figure(figsize=(12, 6))
        plt.bar(
            edges[:-1],
            hist,
            width=np.diff(edges),
            color=Constants.getColorPalette(1),
            edgecolor="black",
        )
        plt.xlabel("Ratio Sold")
        plt.ylabel("Number of Community Members")
        plt.title("Ratio of Sold Supply per Member")
        plt.grid(True)
        plt.show()

    @staticmethod
    def visualizeBuyRatioDistribution(
        buyVolumePerMember: pd.Series, demandPerMember: pd.Series
    ) -> None:
        """
        Make a bar chart visualizing the distribution of the ratio of purchased demand.
        """
        buyRatioVec: pd.Series = (buyVolumePerMember) / demandPerMember
        buyRatioVec = buyRatioVec.replace([np.inf], 0)

        hist: pd.Series
        edges: NDArray[floating[Any]]
        hist, edges = PlotUtils.getHistForRatioValues(buyRatioVec)

        # Create the bar chart
        plt.figure(figsize=(12, 6))
        plt.bar(
            edges[:-1],
            hist,
            width=np.diff(edges),
            color=Constants.getColorPalette(1),
            edgecolor="black",
        )
        plt.xlabel("Ratio Purchased")
        plt.ylabel("Number of Community Members")
        plt.title("Ratio of Purchase Volume / Demand Volume per Member")
        plt.grid(True)
        plt.show()

    @staticmethod
    def visualizeDischargeRatioDistribution(
        dischargeVolumePerMember: pd.Series, demandPerMember: pd.Series
    ) -> None:
        """
        Make a bar chart visualizing the distribution of the ratio of purchased demand.
        """
        dischargeRatioVec: pd.Series = dischargeVolumePerMember / demandPerMember
        dischargeRatioVec = dischargeRatioVec.replace([np.inf], 0)

        hist: pd.Series
        edges: NDArray[floating[Any]]
        hist, edges = PlotUtils.getHistForRatioValues(dischargeRatioVec)

        # Create the bar chart
        plt.figure(figsize=(12, 6))
        plt.bar(
            edges[:-1],
            hist,
            width=np.diff(edges),
            color=Constants.getColorPalette(1),
            edgecolor="black",
        )
        plt.xlabel("Ratio Discharged")
        plt.ylabel("Number of Community Members")
        plt.title("Ratio of Discharge Volume / Demand Volume per Member")
        plt.grid(True)
        plt.show()

    @staticmethod
    def visualizeTradingNetwork(
        network: NetworkAlloc, gridPurchaseVolume: float, gridFeedInVolume: float
    ):
        G = nx.DiGraph()

        # Add edges to the graph from the dictionary
        for u, neighbors in network.items():
            for v, weight in neighbors.items():
                G.add_edge(u, v, weight=weight)

        # Layout for positioning nodes: If graph is planar, lay out accordingly.
        # Else, do arf, which works well for large graphs.
        try:
            pos = nx.planar_layout(G)
        except nx.NetworkXException:
            pos = nx.arf_layout(G)

        # Add "grid" to network
        G.add_node("grid_in", node_color="lightgreen", node_size=3000)
        G.add_node("grid_out", node_color="lightgreen", node_size=3000)

        leftmost_node: int = min(pos, key=lambda x: pos[x][0])
        rightmost_node: int = max(pos, key=lambda x: pos[x][0])

        G.add_edge("grid_in", leftmost_node, weight=gridPurchaseVolume)
        G.add_edge(rightmost_node, "grid_out", weight=gridFeedInVolume)

        # Get the coordinates of the leftmost and rightmost nodes
        leftmost_x, leftmost_y = pos[leftmost_node]
        rightmost_x, rightmost_y = pos[rightmost_node]

        # Define some horizontal distance to shift the grid nodes
        grid_spacing = 2  # Distance to shift grid nodes left and right

        # Reposition the grid nodes:
        # grid_in should be to the left of the leftmost node
        pos["grid_in"] = (leftmost_x - grid_spacing, leftmost_y)

        # grid_out should be to the right of the rightmost node
        pos["grid_out"] = (rightmost_x + grid_spacing, rightmost_y)

        # Normalize edge weights for visualization and scale inversely with # vertices for visibility
        weights: list[float] = [w["weight"] for _, _, w in G.edges(data=True)]
        max_weight: float = max(weights) if weights else 1  # Avoid div by 0
        scaled_widths: list[float] = [
            (np.log(w + 1) / np.log(max_weight + 1)) * 100 / len(G) for w in weights
        ]

        edge_colors: list[tuple[float, float, float, float]]
        edge_colors = [(0.5, 0.5, 0.5, 0.7) for _ in G.edges()]

        # Draw graph with variable edge widths
        plt.figure(figsize=(8, 6))
        nx.draw(
            G,
            pos,
            with_labels=True,
            node_color="skyblue",
            edge_color=edge_colors,
            node_size=2000,
            font_size=12,
            font_weight="bold",
            width=scaled_widths,
            arrows=False,
        )

        plt.title("Trading Network")
        plt.show()

    @staticmethod
    def visualizeChargeRatioDistribution(
        chargeVolumePerMember: pd.Series, supplyPerMember: pd.Series
    ) -> None:
        """
        Make a bar chart visualizing the distribution of the ratio of purchased demand.
        """
        chargeRatioVec: pd.Series = chargeVolumePerMember / supplyPerMember
        chargeRatioVec = chargeRatioVec.replace([np.inf], 0)

        hist: pd.Series
        edges: NDArray[floating[Any]]
        hist, edges = PlotUtils.getHistForRatioValues(chargeRatioVec)

        # Create the bar chart
        plt.figure(figsize=(12, 6))
        plt.bar(
            edges[:-1],
            hist,
            width=np.diff(edges),
            color=Constants.getColorPalette(1),
            edgecolor="black",
        )
        plt.xlabel("Ratio Charged")
        plt.ylabel("Number of Community Members")
        plt.title("Ratio of Charged Volume / Supply Volume per Member")
        plt.grid(True)
        plt.show()

    @staticmethod
    def scatter_plot_exploration(data: pd.DataFrame) -> None:
        x = data["hour_in_year"]
        y = data["load"]

        plt.figure(figsize=(10, 5))
        plt.scatter(x, y, alpha=0.1, s=4, color="blue")
        plt.yscale("log")
        plt.xlabel("Hour in Year")
        plt.ylabel("Load Value (kWh)")
        plt.title("Load Value vs. Hour in Year")
        plt.grid(True, linestyle="--", alpha=0.7)
        plt.show()

    @staticmethod
    def plot_load_profile(distributions: dict[int, tuple[float, float]]) -> None:
        sns.set_theme(style="whitegrid")

        intervals = sorted(distributions.keys())  # Sorted intervals (x-axis)
        means = [distributions[i][0] for i in intervals]  # Mean values (y-axis)
        std_devs = [distributions[i][1] for i in intervals]  # Standard deviations

        # Compute upper and lower bounds
        upper_bound = np.array(means) + np.array(std_devs)
        lower_bound = np.array(means) - np.array(std_devs)

        # Plot
        plt.figure(figsize=(12, 6))
        plt.plot(intervals, means, label="Mean Load", color="blue", linewidth=2)
        plt.fill_between(
            intervals,
            lower_bound,
            upper_bound,
            color="blue",
            alpha=0.2,
            label="±1 Std Dev",
        )

        # Labels & Formatting
        plt.xlabel("Hour in Season", fontsize=14)
        plt.ylabel("Average Load (kW)", fontsize=14)
        plt.title(f"Load Profile with Gaussian Fit", fontsize=16, fontweight="bold")

        plt.legend(fontsize=12)
        plt.grid(True, linestyle="--", alpha=0.6)
        sns.despine()  # Remove top & right border for a clean look

        # Save and Show
        plt.savefig(
            os.path.join(OUT_DIR, f"load_profile.png"), dpi=300, bbox_inches="tight"
        )
        plt.show()

    @staticmethod
    def createEnergyBreakdownDonutChart(title: str, values: List[float]) -> None:
        # Normalize the values so that the total height equals 1
        total = sum(values)
        if total == 0:
            return
        ratios = [value / total for value in values]  # Get ratios

        # Define labels for each component
        labels = ["Self-Consumption", "Market", "Battery", "Grid"]

        # Define colors for each component
        colors = Constants.getColorPalette(len(labels))
        # Create the donut chart
        fig, ax = plt.subplots()

        # Create a pie chart and remove the center to create a donut chart
        ax.pie(
            ratios,
            labels=labels,
            colors=colors,
            autopct="%1.1f%%",
            startangle=90,
            wedgeprops={"width": 0.4},
        )
        # Add a circle in the middle to create the donut hole
        center_circle = plt.Circle((0, 0), 0.70, fc="white")
        ax.add_artist(center_circle)

        ax.set_aspect("equal")
        plt.title(title)
        plt.tight_layout()

    @staticmethod
    def getHistForRatioValues(
        valueVec,
    ) -> tuple[pd.Series, NDArray[floating[Any]]]:
        """
        Expects a pd.Series of ratio values (between 0 and 1) and plots a histogram of them,
        putting the values in 100 baskets (corresponding to each percentage point).
        Returns the histogram series to plot.
        """
        # Define bin edges to cover the range from 0 to 1
        bin_edges = np.linspace(0, 1, N_BINS + 1)

        # Discretize the data into bins
        binned_data = pd.cut(valueVec, bins=bin_edges)

        # Create an IntervalIndex from bin edges
        interval_index = pd.IntervalIndex.from_breaks(bin_edges)

        # Compute histogram counts and reindex to include all bins
        hist: pd.Series = binned_data.value_counts(sort=False).reindex(
            interval_index, fill_value=0
        )
        return hist, bin_edges
