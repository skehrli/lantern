from pydantic import BaseModel, Field
from enum import Enum
from typing import Optional, List, Dict, Any

class SimulationParams(BaseModel):
    community_size: int = Field(..., ge=5, le=100)
    season: str = Field(..., pattern="^(sum|win|aut|spr)$")
    pv_percentage: int = Field(..., ge=0, le=100)
    sd_percentage: int = Field(..., ge=0, le=100)
    with_battery: bool 

class MetricType(Enum):
    ENERGY = "energy"
    COST = "cost"
    ENVIRONMENTAL = "environmental"

class EnergyMetrics(BaseModel):
    total_production: float
    total_consumption: float

class CostMetrics(BaseModel):
    total_cost_with_lec: float
    total_cost_without_lec: float

class Plot(BaseModel):
    type: str  # 'image' or 'plotly'
    data: Any
    title: str
    description: Optional[str] = None

class SimulationResult(BaseModel):
    energy_metrics: EnergyMetrics
    cost_metrics: CostMetrics
    plots: Optional[Dict[str, Plot]] = None
    warnings: List[str] = []
    errors: List[str] = []
