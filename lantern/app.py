#!/usr/bin/env python3

"""
app.py

Defines a FastAPI application to answer requests from React frontend (which provides
user parameters), and calls the simulation code with them.

Includes:
- CORS middleware configuration to allow requests from a React frontend running at http://localhost:5173.
- API endpoint (`/api/simulate`) that accepts POST requests with simulation parameters.

Responses are returned as JSON, and errors are handled with appropriate HTTP status codes.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .models import SimulationParams
from .main import run_simulation
from pydantic import BaseModel

app = FastAPI()

# Add CORS middleware to allow frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # React dev server URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SimulationParams(BaseModel):
    community_size: int
    season: str
    pv_percentage: int
    sd_percentage: int
    with_battery: bool

@app.post("/api/simulate")
async def simulate(params: SimulationParams):
    # Log the incoming parameters
    print(f"Simulation request received with parameters: {params}")
    
    try:
        result = run_simulation(
            community_size=params.community_size,
            season=params.season,
            pv_percentage=params.pv_percentage,
            sd_percentage=params.sd_percentage,
            with_battery=params.with_battery,
        )

        # Convert Pydantic model to dict and return as JSON
        return JSONResponse(content=result.model_dump())
    except Exception as e:
        print("Error:", str(e))  # For debugging
        raise HTTPException(status_code=400, detail=str(e))
