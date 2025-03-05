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

const SEASON_SYMBOLS: Record<string, string> = {
  'sum': '☀️',  // sun for summer
  'win': '❄️',  // snowflake for winter
  'aut': '🍂',  // leaf for autumn
  'spr': '🌸',  // flower for spring
};

const BatteryIcon = () => (
  <svg 
    width="24" 
    height="24" 
    viewBox="0 0 24 24" 
    fill="currentColor"  // This will inherit the color from the parent
  >
    <path d="M20 10V8A2 2 0 0 0 18 6H4A2 2 0 0 0 2 8V16A2 2 0 0 0 4 18H18A2 2 0 0 0 20 16V14H22V10H20M18 16H4V8H18V16M6 10V14H16V10H6Z"/>
  </svg>
);

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

  const handleCircleSliderChange = (e: React.MouseEvent<HTMLDivElement>, name: string) => {
    // Store the circle element reference
    const circle = e.currentTarget;
    
    const updateValue = (e: MouseEvent | React.MouseEvent) => {
      const rect = circle.getBoundingClientRect();  // Use stored circle reference
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
      let percentage = ((angle + Math.PI) / (2 * Math.PI)) * 100;
      percentage = (percentage + 75) % 100;
      
      setParams(prev => ({ ...prev, [name]: Math.round(percentage) }));
    };

    // Handle initial click
    updateValue(e);

    // Setup mouse move tracking
    const handleMouseMove = (e: MouseEvent) => updateValue(e);
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    console.log('Form submitted');

    const formData = new FormData(e.currentTarget);
    
    const submissionParams: SimulationParams = {
      community_size: Number(formData.get('community_size')),
      season: params.season,
      pv_percentage: params.pv_percentage,
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

  const formatNumber = (num: number, decimals: number = 2): string => {
    const parts = num.toFixed(decimals).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, "'");
    return parts.join('.');
  };

  const getCircularPath = (percentage: number) => {
    const radius = 36;  // Slightly smaller radius to account for stroke width
    const center = 40;  // Center point (half of viewBox)
    const startAngle = -Math.PI/2;
    const angle = startAngle + (percentage / 100) * 2 * Math.PI;
    const x = center + radius * Math.cos(angle);
    const y = center + radius * Math.sin(angle);
    // Start from top center (center, center-radius)
    return `M${center},${center-radius} A${radius},${radius} 0 ${percentage > 50 ? 1 : 0},1 ${x},${y}`;
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
          <div className="size-slider" style={{
            '--clip-percent': `${100 - ((params.community_size - 5) / 95) * 100}%`
          } as React.CSSProperties}>
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
                {SEASON_SYMBOLS[season]}
              </button>
            ))}
          </div>
        </div>

        <div className="circles-row">
          <div className="circle-container">
            <label>Smart Devices</label>
            <div className="circle" onMouseDown={(e) => handleCircleSliderChange(e, 'sd_percentage')}>
              <svg className="circle-fill" viewBox="0 0 80 80">
                <path d={getCircularPath(params.sd_percentage)} />
              </svg>
              <div className="circle-thumb"
                style={{
                  transform: `rotate(${params.sd_percentage * 3.6}deg) translateY(-36px)`
                }}
              />
              <span>{params.sd_percentage}%</span>
            </div>
          </div>

          <div className="circle-container">
            <label>Have PV</label>
            <div className="circle" onMouseDown={(e) => handleCircleSliderChange(e, 'pv_percentage')}>
              <svg className="circle-fill" viewBox="0 0 80 80">
                <path d={getCircularPath(params.pv_percentage)} />
              </svg>
              <div className="circle-thumb"
                style={{
                  transform: `rotate(${params.pv_percentage * 3.6}deg) translateY(-36px)`
                }}
              />
              <span>{params.pv_percentage}%</span>
            </div>
          </div>
        </div>

        <div className="button-group">
          <button
            type="button"
            className={`battery-button ${params.with_battery ? 'active' : ''}`}
            onClick={() => handleButtonClick('with_battery', !params.with_battery)}
          >
            <BatteryIcon />
            {params.with_battery ? 'Yes' : 'No'}
          </button>
          <button type="submit">Confirm</button>
        </div>
      </form>

      {result && (
        <div className="results">
          <h2>Results</h2>
          
          <h3>Cost Metrics</h3>
          <p><span>Cost With LEC:</span> <span>{formatNumber(result.cost_metrics.cost_with_lec)} CHF</span></p>
          <p><span>Cost Without LEC:</span> <span>{formatNumber(result.cost_metrics.cost_without_lec)} CHF</span></p>
          <p><span>Cost Savings:</span> <span>{formatNumber((1 - result.cost_metrics.cost_with_lec / result.cost_metrics.cost_without_lec) * 100)}%</span></p>
          
          <h3>Energy Metrics</h3>
          <p><span>Total Production:</span> <span>{formatNumber(result.energy_metrics.total_production)} kWh</span></p>
          <p><span>Total Consumption:</span> <span>{formatNumber(result.energy_metrics.total_consumption)} kWh</span></p>
          <p><span>Grid Import:</span> <span>{formatNumber(result.energy_metrics.total_grid_import)} kWh</span></p>
          <p><span>Grid Export:</span> <span>{formatNumber(result.energy_metrics.total_grid_export)} kWh</span></p>

          <h3>Market Metrics</h3>
          <p><span>Trading Volume:</span> <span>{formatNumber(result.market_metrics.trading_volume)} kWh</span></p>
          <p><span>Demand Fulfillment:</span> <span>{formatNumber(result.market_metrics.ratio_fulfilled_demand * 100)}%</span></p>
          <p><span>Supply Sold:</span> <span>{formatNumber(result.market_metrics.ratio_sold_supply * 100)}%</span></p>

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
