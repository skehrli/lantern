from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
import plotly.express as px
from .models import SimulationParams, SimulationResult
from .main import run_simulation
import pandas as pd
import json

app = FastAPI()

# Add CORS middleware to allow frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # replace with frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="lantern/static"), name="static")


@app.post("/simulate")
async def simulate(params: SimulationParams) -> SimulationResult:
    try:
        return run_simulation(
            community_size=params.community_size,
            season=params.season,
            pv_percentage=params.pv_percentage,
            sd_percentage=params.sd_percentage,
            with_battery=params.with_battery,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/")
async def root():
    return HTMLResponse(
        """
        <!DOCTYPE html>
        <html>
            <head>
                <title>Energy Community Simulator</title>
                <link rel="stylesheet" href="/static/css/styles.css">
            </head>
            <body>
                <div id="app"></div>
                <script src="/static/js/app.js"></script>
            </body> </html>
    """
    )
