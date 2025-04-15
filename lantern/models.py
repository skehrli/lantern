#!/usr/bin/env python3

"""
models.py

Defines pydantic classes to hold parameters and results of the simulation.
Converts NetworkX graph into serializable datastructures.
"""


from pydantic import BaseModel, Field
from enum import Enum
from typing import List, Union
import networkx as nx


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

    
class IndividualMetrics(BaseModel):
    individual_selfconsumption_volume: List[float]
    individual_grid_import: List[float]
    individual_market_purchase_volume: List[float]
    individual_discharging_volume: List[float]
    individual_grid_export: List[float]
    individual_market_sell_volume: List[float]
    individual_charging_volume: List[float]
    has_pv: List[bool]


class CostMetrics(BaseModel):
    cost_with_lec: float
    cost_without_lec: float


class Profiles(BaseModel):
    load_profile: List[float]
    gen_profile: List[float]

class NodeObject(BaseModel):
    """Represents a single node object for frontend consumption."""
    id: Union[int, str]


class EdgeObject(BaseModel):
    """Represents a single edge object for frontend consumption."""
    source: Union[int, str]
    target: Union[int, str]
    value: float


class TradingNetwork(BaseModel):
    """Structure holding nodes and edges lists suitable for frontend graph libraries."""
    nodes: List[NodeObject]
    edges: List[EdgeObject]

    @classmethod
    def from_networkx(cls, G: nx.DiGraph):
        """
        Creates the frontend-compatible structure from a NetworkX graph.
        Extracts node IDs and edge source/target/weight.
        """
        nodes_list = []
        for node_id, node_data in G.nodes(data=True):
            node_attrs = {"id": node_id}
            nodes_list.append(NodeObject(**node_attrs))

        edges_list = []
        for u, v, edge_data in G.edges(data=True):
            edge_attrs = {
                "source": u,
                "target": v,
                "value": float(edge_data.get('weight', 1.0)) # Use 'value', get 'weight' from data
            }
            # Example: Add 'type' if it exists in edge_data and EdgeObject has 'type'
            # if 'type' in edge_data:
            #     edge_attrs['type'] = edge_data['type']
            edges_list.append(EdgeObject(**edge_attrs)) # Create EdgeObject instance

        return cls(nodes=nodes_list, edges=edges_list)

    def to_networkx(self) -> nx.DiGraph:
        """
        Reconstructs a NetworkX graph from the frontend-compatible structure.
        Maps 'value' back to the 'weight' attribute.
        """
        G = nx.DiGraph()

        # Add nodes, including any extra attributes defined in NodeObject
        for node_obj in self.nodes:
            # Use model_dump (Pydantic v2) or dict() (Pydantic v1)
            # Exclude 'id' because it's the first argument to add_node
            try:
                node_attrs = node_obj.model_dump(exclude={'id'}, exclude_none=True)
            except AttributeError: # Fallback for Pydantic v1
                node_attrs = node_obj.dict(exclude={'id'}, exclude_none=True)
            G.add_node(node_obj.id, **node_attrs)

        # Add edges, mapping 'value' back to 'weight' attribute
        for edge_obj in self.edges:
            # Use model_dump (Pydantic v2) or dict() (Pydantic v1)
            # Exclude source/target/value as they are handled separately or mapped
            try:
                edge_attrs = edge_obj.model_dump(exclude={'source', 'target', 'value'}, exclude_none=True)
            except AttributeError: # Fallback for Pydantic v1
                edge_attrs = edge_obj.dict(exclude={'source', 'target', 'value'}, exclude_none=True)

            # Map 'value' back to 'weight' for NetworkX convention
            edge_attrs['weight'] = edge_obj.value

            G.add_edge(edge_obj.source, edge_obj.target, **edge_attrs)

        return G


class SimulationResult(BaseModel):
    energy_metrics: EnergyMetrics
    individual_metrics: IndividualMetrics
    cost_metrics: CostMetrics
    profiles: Profiles
    trading_network: TradingNetwork = None
    warnings: List[str] = []
    errors: List[str] = []
