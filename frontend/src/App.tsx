import { useState } from 'react';
import './App.css';

interface SimulationParams {
  community_size: number;
  season: string;
  pv_percentage: number;
  sd_percentage: number;
  with_battery: boolean;
}

interface SimulationResult {
  energy_metrics: {
    total_production: number;
    total_consumption: number;
    total_grid_import: number;
    total_grid_export: number;
  };
  cost_metrics: {
    cost_with_lec: number;
    cost_without_lec: number;
  };
  market_metrics: {
    trading_volume: number;
    ratio_fulfilled_demand: number;
    ratio_sold_supply: number;
  };
  warnings: string[];
  errors: string[];
}

function App() {
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useState<SimulationParams>({
    community_size: 10,
    season: 'sum',
    pv_percentage: 50,
    sd_percentage: 25,
    with_battery: false,
  });

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setParams((prev) => ({ ...prev, [name]: Number(value) }));
  };

  const handleButtonClick = (name: string, value: any) => {
    setParams((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    console.log('Form submitted');

    const formData = new FormData(e.currentTarget);
    
    const submissionParams: SimulationParams = {
      community_size: Number(formData.get('community_size')),
      season: params.season,
      pv_percentage: Number(formData.get('pv_percentage')),
      sd_percentage: Number(formData.get('sd_percentage')),
      with_battery: formData.get('with_battery') === 'on'
    };

    console.log('Sending params:', submissionParams);

    try {
      const response = await fetch('http://localhost:8000/api/simulate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(submissionParams)
      });

      const responseText = await response.text();
      console.log('Raw response:', responseText);

      if (!response.ok) {
        const errorMessage = responseText ? JSON.parse(responseText).detail : 'Simulation failed';
        throw new Error(errorMessage);
      }

      try {
        const data = JSON.parse(responseText);
        console.log('Parsed response:', data);
        if (!data.cost_metrics || !data.energy_metrics || !data.market_metrics) {
          throw new Error('Invalid response format');
        }
        setResult(data);
      } catch (parseError) {
        console.error('Parse error:', parseError);
        setError('Failed to parse server response');
      }
    } catch (error) {
      console.error('Error:', error);
      setError(error instanceof Error ? error.message : 'An error occurred');
    }
  };

  return (
    <div className="container">
      <h1>Energy Community Simulator</h1>
      
      {error && (
        <div className="error">
          Error: {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Size</label>
          <input
            type="range"
            name="community_size"
            min="5"
            max="100"
            value={params.community_size}
            onChange={handleSliderChange}
          />
          <span>{params.community_size}</span>
        </div>

        <div className="form-group">
          <label>Season</label>
          <div className="season-buttons">
            {['sum', 'win', 'aut', 'spr'].map((season) => (
              <button
                type="button"
                key={season}
                className={params.season === season ? 'active' : ''}
                onClick={() => handleButtonClick('season', season)}
              >
                {season}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label>Smart Devices</label>
          <div className="circle">
            <div className="circle-fill" style={{ height: `${params.sd_percentage}%` }}></div>
            <span>{params.sd_percentage}%</span>
          </div>
          <input
            type="range"
            name="sd_percentage"
            min="0"
            max="100"
            value={params.sd_percentage}
            onChange={handleSliderChange}
          />
        </div>

        <div className="form-group">
          <label>Have PV</label>
          <div className="circle">
            <div className="circle-fill" style={{ height: `${params.pv_percentage}%` }}></div>
            <span>{params.pv_percentage}%</span>
          </div>
          <input
            type="range"
            name="pv_percentage"
            min="0"
            max="100"
            value={params.pv_percentage}
            onChange={handleSliderChange}
          />
        </div>

        <div className="form-group">
          <label>Battery</label>
          <button
            type="button"
            className={params.with_battery ? 'active' : ''}
            onClick={() => handleButtonClick('with_battery', !params.with_battery)}
          >
            {params.with_battery ? 'Yes' : 'No'}
          </button>
        </div>

        <button type="submit">Confirm</button>
      </form>

      {result && (
        <div className="results">
          <h2>Results</h2>
          
          <h3>Cost Metrics</h3>
          <p><span>Cost With LEC:</span> <span>{result.cost_metrics.cost_with_lec.toFixed(2)} €</span></p>
          <p><span>Cost Without LEC:</span> <span>{result.cost_metrics.cost_without_lec.toFixed(2)} €</span></p>
          <p><span>Cost Savings:</span> <span>{((1 - result.cost_metrics.cost_with_lec / result.cost_metrics.cost_without_lec) * 100).toFixed(2)}%</span></p>
          
          <h3>Energy Metrics</h3>
          <p><span>Total Production:</span> <span>{result.energy_metrics.total_production.toFixed(2)} kWh</span></p>
          <p><span>Total Consumption:</span> <span>{result.energy_metrics.total_consumption.toFixed(2)} kWh</span></p>
          <p><span>Grid Import:</span> <span>{result.energy_metrics.total_grid_import.toFixed(2)} kWh</span></p>
          <p><span>Grid Export:</span> <span>{result.energy_metrics.total_grid_export.toFixed(2)} kWh</span></p>
          <p><span>Self-Consumption Rate:</span> <span>{((1 - result.energy_metrics.total_grid_export / result.energy_metrics.total_production) * 100).toFixed(2)}%</span></p>
          
          <h3>Market Metrics</h3>
          <p><span>Trading Volume:</span> <span>{result.market_metrics.trading_volume.toFixed(2)} kWh</span></p>
          <p><span>Demand Fulfillment:</span> <span>{(result.market_metrics.ratio_fulfilled_demand * 100).toFixed(2)}%</span></p>
          <p><span>Supply Sold:</span> <span>{(result.market_metrics.ratio_sold_supply * 100).toFixed(2)}%</span></p>

          {result.warnings.length > 0 && (
            <>
              <h3>Warnings</h3>
              <ul>
                {result.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </>
          )}

          {result.errors.length > 0 && (
            <>
              <h3>Errors</h3>
              <ul>
                {result.errors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default App; 