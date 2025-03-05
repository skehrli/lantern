#!/usr/bin/env python3

"""
market_solution.py

This module holds the MarketSolution class, which models the LEC market in a single
timestep.

It constructs a graph, given the load and PV amount of all members for a
timestep, and computes an optimal market allocation (who sells how much to whom).

It provides the methods `getQtySoldForMember` and `getQtyPurchasedForMember` to access
the result of the allocation, as well as `plotFlowGraph` to visualize the per-timestep
network.

The network that we're interested in in the end is however an overlay of ALL timesteps.
It is accumulated in the static field `overall_trading_network`.
"""

from .constants import SOURCE, NetworkAlloc, TARGET, UNBOUNDED
import pandas as pd
import networkx as nx
from typing import List, Self
import matplotlib.pyplot as plt


class MarketSolution:
    # Static field documenting the accumulated trading network over all timesteps
    overall_trading_network: NetworkAlloc = {}

    def __init__(self: Self, supply: pd.Series, demand: pd.Series) -> None:
        self.tradingVolume: float
        self.supplyVolume: float = sum(sorted(supply))
        self.sellMap: NetworkAlloc
        self.N_fair: nx.DiGraph

        self.N_fair = self._construct_fair_network(supply, demand)
        self.tradingVolume, self.sellMap = nx.maximum_flow(self.N_fair, SOURCE, TARGET)
        self.tradingVolume = min(self.tradingVolume, self.supplyVolume)
        self._add_flow_to_total_network(self.sellMap)

    def getQtySoldForMember(self: Self, member: int) -> float:
        node: str = self._get_node(member)
        return self.sellMap[SOURCE].get(node, 0)

    def getQtyPurchasedForMember(self: Self, member: int) -> float:
        node: str = self._get_node(member)
        return self.sellMap[node].get(TARGET, 0)

    def plot_flow_graph(self: Self) -> None:
        """
        Plots the flow graph in layers based on the self.sellMap and the maximum flow value.

        The graph is plotted such that SOURCE is on the left, TARGET is on the right,
        and other nodes are layered according to their connections.

        Returns:
        None
        """
        flow_graph: nx.DiGraph = nx.DiGraph()

        # Add edges with flow > 0 to the flow graph
        for u in self.sellMap:
            for v, flow in self.sellMap[u].items():
                if flow > 0:
                    flow_graph.add_edge(u, v, weight=flow)

        # Assign layer/subset to each node
        for node in flow_graph.nodes:
            flow_graph.nodes[node]["layer"] = self._get_layer(node, flow_graph)

        # Create a layered layout (hierarchical layout from left to right)
        pos = nx.multipartite_layout(flow_graph, subset_key="layer")

        plt.figure(figsize=(10, 6))

        # Draw nodes
        nx.draw_networkx_nodes(flow_graph, pos, node_size=700)

        # Draw edges with widths proportional to the flow value
        edge_weights = [flow_graph[u][v]["weight"] for u, v in flow_graph.edges()]
        nx.draw_networkx_edges(flow_graph, pos, width=edge_weights)

        # Draw node labels
        nx.draw_networkx_labels(flow_graph, pos, font_size=14)

        # Draw edge labels (flow values rounded to two decimal points)
        edge_labels = {
            (u, v): f'{flow_graph[u][v]["weight"]:.2f}' for u, v in flow_graph.edges()
        }
        nx.draw_networkx_edge_labels(flow_graph, pos, edge_labels=edge_labels)

        # Show the plot
        plt.title(f"Flow Network with Maximum Flow Value: {self.tradingVolume}")
        plt.axis("off")
        plt.show()

    def _add_flow_to_total_network(self: Self, sellMap: NetworkAlloc) -> None:
        """Overlay the edges from the sellMap (max flow) into the overall_trading_network."""
        u: str
        v: str
        flow: float
        v_dict: dict[str, float]

        for u, v_dict in sellMap.items():
            if u == SOURCE or u == TARGET:
                continue
            for v, flow in v_dict.items():
                if v == SOURCE or v == TARGET:
                    continue
                if flow > 0:
                    if u not in MarketSolution.overall_trading_network:
                        MarketSolution.overall_trading_network[u] = {}
                    if v not in MarketSolution.overall_trading_network[u]:
                        MarketSolution.overall_trading_network[u][v] = flow
                    else:
                        MarketSolution.overall_trading_network[u][v] += flow

    def _construct_fair_network(
        self: Self, supply: pd.Series, demand: pd.Series
    ) -> nx.DiGraph:
        """
        Constructs a directed graph (`nx.DiGraph`) to run a maximum flow algorithm from SOURCE to TARGET.

        The network is built based on the following rules:
        - A non-negative value `v` in `vals` is modeled as a "producer" vertex with
        an edge from SOURCE to the producer node (itself) with capacity `v`.
        - A negative value `v` in `vals` is modeled as a "consumer" vertex with
        an edge from the consumer node (itself) to TARGET with capacity `-v`.
        - An edge with unbounded capacity is added from every producer vertex to every consumer vertex.
        - If the sum of producing capacities 'p' is larger than the sum of consuming capacities 'c',
        the edge capacities from SOURCE to producers are multiplied with 'p'/'c' and if 'c' > 'p'
        the analogous modification is done for edges from consumers to TARGET.
        This modification ensures fairness of the resulting flow.

        Parameters:
        vals (pd.Series): A pandas Series containing float values where each index represents a node.

        Returns:
        nx.DiGraph: A directed graph where the nodes and edges are constructed based on `vals`,
                    ready to run a max-flow algorithm from SOURCE to TARGET.

        Example:
        >>> vals = pd.Series([10, -5, 15, -8])
        >>> network = construct_fair_network(vals)
        >>> tradingVolume, flow_dict = nx.maximum_flow(network, SOURCE, TARGET)
        """
        total_supply: float = sum(sorted(supply))
        total_demand: float = sum(sorted(demand))

        # scale supply/demand s.t. both market sides have equal quantity
        supply_ratio: float = 1
        demand_ratio: float = 1
        if total_supply > total_demand:
            supply_ratio = total_demand / total_supply
        elif total_demand != 0:
            demand_ratio = total_supply / total_demand

        network: nx.DiGraph = nx.DiGraph()
        network.add_node(SOURCE)
        network.add_node(TARGET)
        producers: List[int] = []
        consumers: List[int] = []
        for i, (dem, sup) in enumerate(zip(demand, supply)):
            node = self._get_node(i)
            network.add_node(node)
            if sup > 0:
                producers.append(i)
                network.add_edge(SOURCE, node, capacity=sup * supply_ratio)
            elif dem > 0:
                consumers.append(i)
                network.add_edge(node, TARGET, capacity=dem * demand_ratio)
        network.add_edges_from(
            (
                self._get_node(supplier),
                self._get_node(consumer),
                {"capacity": UNBOUNDED},
            )
            for supplier in producers
            for consumer in consumers
        )
        return network

    def _get_node(self: Self, n: int) -> str:
        """
        Defines mapping from index in list to node name. Currently just casts to string.
        Checks the invariant that no node has the same name as SOURCE or TARGET

        Parameters:
        n (int): An index in list

        Returns:
        str: The corresponding node name. Currently just the string representation of that integer.

        Raises:
        AssertionError: If the converted string is equal to SOURCE or TARGET.
        """
        node = str(n)
        assert node != SOURCE and node != TARGET
        return node

    def _get_layer(self: Self, node: str, graph: nx.DiGraph) -> int:
        """
        Assigns a layer to each node:
        - 0 for the SOURCE node
        - 1 for nodes directly connected to SOURCE
        - 2 for nodes connected to layer 1 nodes
        - and so on, with TARGET being the highest layer.

        Parameters:
        node (str): The node to get the layer for.
        graph (nx.DiGraph): The flow graph.

        Returns:
        int: The layer number of the node.
        """
        if node == SOURCE:
            return 0
        elif node == TARGET:
            return 3
        else:
            # Use the shortest path length from source to determine the layer
            try:
                return nx.shortest_path_length(graph, source=SOURCE, target=node)
            except nx.NetworkXNoPath:
                return 2  # If no path, assign it to the second layer
