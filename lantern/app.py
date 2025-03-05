from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .models import SimulationParams, SimulationResult
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
async def simulate(params: SimulationParams, request: Request):
    # Log the incoming request data
    print("Received request data:", await request.json())
    
    try:
        result = run_simulation(
            community_size=params.community_size,
            season=params.season,
            pv_percentage=params.pv_percentage,
            sd_percentage=params.sd_percentage,
            with_battery=params.with_battery,
        )
        # Add proper Python logging instead
        print("Response data:", result)  # For debugging
        
        # Convert Pydantic model to dict and return as JSON
        return JSONResponse(content=result.model_dump())
    except Exception as e:
        print("Error:", str(e))  # For debugging
        raise HTTPException(status_code=400, detail=str(e))
