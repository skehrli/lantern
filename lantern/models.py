#!/usr/bin/env python3

"""
models.py

Defines pydantic classes to hold parameters and results of the simulation.
Converts NetworkX graph into serializable datastructures.
"""


from pydantic import BaseModel, Field, ConfigDict
from enum import Enum
from typing import List, Any, Optional, Dict, Tuple, Union
import networkx as nx
import numpy as np


class SimulationParams(BaseModel):
    community_size: int = Field(..., ge=5, le=100)
    season: str = Field(..., pattern="^(sum|win|aut|spr)$")
    pv_percentage: int = Field(..., ge=0, le=100)
    sd_percentage: int = Field(..., ge=0, le=100)
    with_battery: bool


class MetricType(Enum):
    ENERGY = "energy"
    COST = "cost"
    MARKET = "market"


class EnergyMetrics(BaseModel):
    total_consumption: float
    total_grid_import: float
    self_consumption_volume: float
    trading_volume: float
    total_discharging_volume: float
    total_production: float
    total_grid_export: float
    total_charging_volume: float


class MarketMetrics(BaseModel):
    ratio_fulfilled_demand: float
    ratio_sold_supply: float


class CostMetrics(BaseModel):
    cost_with_lec: float
    cost_without_lec: float


class Profiles(BaseModel):
    load_profile: List[float]
    gen_profile: List[float]


class TradingNetwork(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    
    # Store graph as edge list for serialization
    edges: List[Tuple[Union[int, str], Union[int, str], float]]  # (from_node, to_node, weight)
    nodes: List[Union[int, str]]

    @classmethod
    def from_networkx(cls, G: nx.DiGraph):
        edges = [(u, v, float(d.get('weight', 1.0)))
                for u, v, d in G.edges(data=True)]
        nodes = list(G.nodes())
        return cls(edges=edges, nodes=nodes)

    def to_networkx(self) -> nx.DiGraph:
        G = nx.DiGraph()
        G.add_nodes_from(self.nodes)
        G.add_weighted_edges_from(self.edges)
        return G


class SimulationResult(BaseModel):
    energy_metrics: EnergyMetrics
    cost_metrics: CostMetrics
    market_metrics: MarketMetrics
    profiles: Profiles
    trading_network: Optional[TradingNetwork] = None
    warnings: List[str] = []
    errors: List[str] = []
