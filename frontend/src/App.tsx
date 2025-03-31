import React from 'react'; // Ensure React is imported
import { useState } from 'react';
import './App.css';
import { PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { FaSun, FaSnowflake, FaLeaf, FaSpa } from 'react-icons/fa'; // Using Font Awesome examples

// Define the EnergyMetrics type based on your provided class structure
interface EnergyMetricsData {
    total_consumption: number;
    total_grid_import: number;
    self_consumption_volume: number;
    trading_volume: number; // Note: This is TOTAL trading. Needs calculation for sold/bought.
    total_discharging_volume: number;
    total_production: number;
    total_grid_export: number;
    total_charging_volume: number;
}

interface EnergyPieChartProps {
    type: 'production' | 'consumption';
    metrics: EnergyMetricsData;
    formatNumber: (num: number, decimals?: number) => string; // Pass the formatter
}

// Define colors for consistency
const COLORS = {
  selfConsumed: '#65a30d', 
  toBattery: '#a3e635',    
  toMarket: '#82ca9d',     
  toGrid: '#9ca3af',       
  fromPV: '#a3e635',       
  fromBattery: '#a3e635',  
  fromMarket: '#82ca9d',   
  fromGrid: '#9ca3af',     
};

const RADIAN = Math.PI / 180;

// Custom label renderer for Pie chart slices
const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, index, name }: any) => {
  // Added check for percent being valid number
  if (percent == null || isNaN(percent) || percent < 0.02) return null; // Don't render labels for tiny slices

  const radius = innerRadius + (outerRadius - innerRadius) * 0.5 + 10; // Adjust label position
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text x={x} y={y} fill="black" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize="12px">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

// Pie Chart Component Definition
const EnergyPieChart: React.FC<EnergyPieChartProps> = ({ type, metrics, formatNumber }) => {

    const prepareChartData = () => {
        // Added defensive check for metrics object
        if (!metrics) {
            console.error("EnergyPieChart: metrics object is missing!");
            return [];
        }

        const {
            total_production = 0, // Default to 0 if undefined
            self_consumption_volume = 0,
            total_charging_volume = 0,
            total_grid_export = 0,
            total_consumption = 0,
            total_discharging_volume = 0,
            total_grid_import = 0,
            // trading_volume // Not directly used in pie segment calculation
        } = metrics;

        let data: { name: string; value: number; color: string }[] = []; // Explicitly type data array
        const tolerance = 0.01; // To ignore negligible values

        try { // Added try...catch for calculation robustness
            if (type === 'production') {
                const totalProduced = total_production;
                if (totalProduced < tolerance) return []; // No production, empty chart

                // Calculate market sales: Production - SelfConsumed - ToBattery - ToGrid
                const sold_on_market = Math.max(0, totalProduced - self_consumption_volume - total_charging_volume - total_grid_export);

                if (self_consumption_volume > tolerance) data.push({ name: 'Self-Consumed', value: self_consumption_volume, color: COLORS.selfConsumed });
                if (total_charging_volume > tolerance) data.push({ name: 'To Battery', value: total_charging_volume, color: COLORS.toBattery });
                if (sold_on_market > tolerance) data.push({ name: 'Sold (Market)', value: sold_on_market, color: COLORS.toMarket });
                if (total_grid_export > tolerance) data.push({ name: 'Exported (Grid)', value: total_grid_export, color: COLORS.toGrid });

                // Handle potential rounding errors - add remainder to largest segment if small discrepancy
                const sum = data.reduce((acc, item) => acc + item.value, 0);
                const diff = totalProduced - sum;

                // --- Refined rounding error logic ---
                if (data.length > 0 && Math.abs(diff) > tolerance && Math.abs(diff) < 1) { // Only adjust for small diffs and if data exists
                    let largestSegment = data[0]; // Start with first
                    for (let i = 1; i < data.length; i++) {
                        if (data[i].value > largestSegment.value) {
                            largestSegment = data[i];
                        }
                    }
                    // Check if largest segment value is positive before adding diff
                    if (largestSegment.value > tolerance) {
                        largestSegment.value += diff;
                        // Ensure value doesn't become negative after adjustment
                        largestSegment.value = Math.max(tolerance, largestSegment.value);
                    }
                }
                // --- End Refinement ---

            } else { // type === 'consumption'
                const totalConsumed = total_consumption;
                if (totalConsumed < tolerance) return []; // No consumption, empty chart

                // Calculate market purchases: Consumption - SelfConsumed - FromBattery - FromGrid
                const bought_from_market = Math.max(0, totalConsumed - self_consumption_volume - total_discharging_volume - total_grid_import);

                if (self_consumption_volume > tolerance) data.push({ name: 'Self-Produced', value: self_consumption_volume, color: COLORS.selfConsumed });
                if (total_discharging_volume > tolerance) data.push({ name: 'From Battery', value: total_discharging_volume, color: COLORS.fromBattery });
                if (bought_from_market > tolerance) data.push({ name: 'Market (Bought)', value: bought_from_market, color: COLORS.fromMarket });
                if (total_grid_import > tolerance) data.push({ name: 'Grid (Bought)', value: total_grid_import, color: COLORS.fromGrid });

                // Handle potential rounding errors
                const sum = data.reduce((acc, item) => acc + item.value, 0);
                const diff = totalConsumed - sum;

                 // --- Refined rounding error logic ---
                 if (data.length > 0 && Math.abs(diff) > tolerance && Math.abs(diff) < 1) { // Only adjust for small diffs and if data exists
                    let largestSegment = data[0]; // Start with first
                    for (let i = 1; i < data.length; i++) {
                        if (data[i].value > largestSegment.value) {
                            largestSegment = data[i];
                        }
                    }
                     // Check if largest segment value is positive before adding diff
                     if (largestSegment.value > tolerance) {
                         largestSegment.value += diff;
                         // Ensure value doesn't become negative after adjustment
                         largestSegment.value = Math.max(tolerance, largestSegment.value);
                     }
                 }
                 // --- End Refinement ---
            }
        } catch (error) {
            console.error("Error during chart data preparation:", error);
            return []; // Return empty array on error
        }
        // Filter again after potential adjustment, ensure value is strictly positive
        return data.filter(d => d.value > tolerance);
    };

    const chartData = prepareChartData();

    if (!Array.isArray(chartData)) {
        console.error("prepareChartData did not return an array:", chartData);
        return <p>Error preparing chart data.</p>; // Handle non-array return
    }

    if (chartData.length === 0) {
        return <p>No significant data available for this chart.</p>; // More specific message
    }

    // Custom Tooltip Formatter
    const renderTooltipContent = (props: any) => {
        // Added safety check for payload
        const { payload } = props;
        if (payload && payload.length > 0 && payload[0] && payload[0].payload) {
             try {
                const { name, value } = payload[0].payload; // Access data from payload object
                 // Check if value is a valid number before calculating total/percentage
                 if (typeof value !== 'number' || isNaN(value)) {
                     return null; // Don't render tooltip if value is invalid
                 }
                const color = payload[0].payload.color || '#000000'; // Default color if missing
                const total = chartData.reduce((sum, entry) => sum + entry.value, 0);
                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                return (
                    <div className="custom-tooltip"> {/* Removed inline styles, prefer CSS class */}
                       <p style={{ margin: 0, color: color, fontWeight: 'bold' }}>{`${name}`}</p>
                       <p style={{ margin: '2px 0 0 0' }}>{`${formatNumber(value)} kWh (${percentage}%)`}</p>
                    </div>
                );
             } catch (error) {
                 console.error("Error rendering tooltip:", error, "Props:", props);
                 return null; // Prevent crash on tooltip error
             }
        }
        return null;
    };

    return (
        <ResponsiveContainer width="100%" height={260}>
            <PieChart margin={{ top: 10, right: 5, bottom: 40, left: 5 }}>
                <Pie
                    data={chartData}
                    cx="50%"
                    // cy="50%" // Keep default center Y for now, adjust if needed
                    labelLine={false}
                    label={renderCustomizedLabel}
                    outerRadius={65} // Keep radius for now, reduce if still clipped
                    fill="#8884d8"
                    dataKey="value"
                    nameKey="name"
                >
                    {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                </Pie>
                <Tooltip content={renderTooltipContent} />
                <Legend
                    layout="horizontal"
                    verticalAlign="bottom"
                    align="center"
                    iconSize={10}
                    wrapperStyle={{ paddingTop: '15px' }}
                 />
            </PieChart>
        </ResponsiveContainer>
    );
};

// --- END: Moved EnergyPieChart related definitions ---


// --- Simulation Parameter Interfaces ---
interface SimulationParams {
  community_size: number;
  season: string;
  pv_percentage: number;
  sd_percentage: number;
  with_battery: boolean;
}

// --- Simulation Result Interfaces ---
interface SimulationResult {
  energy_metrics: EnergyMetricsData; // Use the defined interface here
  cost_metrics: {
    cost_with_lec: number;
    cost_without_lec: number;
  };
  market_metrics: {
    trading_volume: number; // Keep existing market metrics separate for now
    ratio_fulfilled_demand: number;
    ratio_sold_supply: number;
  };
  profiles: {
    load_profile: number[];
    gen_profile: number[];
  }
  warnings: string[];
  errors: string[];
}

export const SEASON_ICONS: Record<string, React.ComponentType<any>> = {
  'sum': FaSun,        // Reference the imported component
  'win': FaSnowflake,
  'aut': FaLeaf,
  'spr': FaSpa,        // Or FaSeedling, FaFlower etc.
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

// --- CostComparison Component (Unchanged from previous version) ---
const CostComparison = ({ withLec, withoutLec }: { withLec: number, withoutLec: number }) => {
  // ... (Keep the existing CostComparison logic)
    const maxAbsValue = Math.max(Math.abs(withLec), Math.abs(withoutLec));
    const scale = maxAbsValue > 0 ? maxAbsValue : 1;
    let withLecWidthPercent = withLec > 0 ? (withLec / scale) * 100 : 0;
    let withoutLecWidthPercent = withoutLec > 0 ? (withoutLec / scale) * 100 : 0;
    withLecWidthPercent = Math.max(0, Math.min(100, withLecWidthPercent));
    withoutLecWidthPercent = Math.max(0, Math.min(100, withoutLecWidthPercent));
    const savings = withoutLec - withLec;
    let savingsText = '';
    const tolerance = 0.01;

    if (Math.abs(savings) < tolerance) {
        savingsText = 'Costs are effectively the same.';
    } else if (withoutLec > tolerance) {
        const savingsPercent = (savings / withoutLec) * 100;
        if (savings > 0) {
            if (withLec >= 0) {
                savingsText = `You save ${savings.toFixed(2)} CHF (${savingsPercent.toFixed(1)}%) with community.`;
            } else {
                savingsText = `Community saves ${savings.toFixed(2)} CHF (${savingsPercent.toFixed(1)}%), resulting in a net gain!`;
            }
        } else {
            const increasePercent = Math.abs(savingsPercent);
            savingsText = `Costs are ${Math.abs(savings).toFixed(2)} CHF (${increasePercent.toFixed(1)}%) higher with community.`;
        }
    } else if (Math.abs(withoutLec) < tolerance) {
        if (withLec < 0) {
            savingsText = `Community results in a gain of ${Math.abs(withLec).toFixed(2)} CHF (compared to zero).`;
        } else {
            savingsText = `Community results in a cost of ${withLec.toFixed(2)} CHF (compared to zero).`;
        }
    } else {
        const absWithoutLec = Math.abs(withoutLec);
        if (withLec < withoutLec) {
            const gainIncreasePercent = (savings / absWithoutLec) * 100;
            savingsText = `Community increases gain by ${savings.toFixed(2)} CHF (${gainIncreasePercent.toFixed(1)}%).`;
        } else {
            const gainDecreasePercent = (Math.abs(savings) / absWithoutLec) * 100;
            if (withLec < -tolerance) {
                savingsText = `Community decreases gain by ${Math.abs(savings).toFixed(2)} CHF (${gainDecreasePercent.toFixed(1)}%).`;
            } else if (Math.abs(withLec) < tolerance) {
                savingsText = `Community eliminated the gain of ${absWithoutLec.toFixed(2)} CHF.`;
            } else {
                savingsText = `Community leads to a cost of ${withLec.toFixed(2)} CHF instead of a gain of ${absWithoutLec.toFixed(2)} CHF.`;
            }
        }
    }

    return (
        <div className="cost-comparison">
            <div className="bar-container">
                <div className="bar-label">With Community</div>
                <div className="bar-wrapper">
                    {withLec > 0 ? (
                        <div className="bar lec-bar" style={{ width: `${withLecWidthPercent}%` }}>
                            <span>{withLec.toFixed(2)} CHF</span>
                        </div>
                    ) : (
                        <div className="bar lec-bar zero-cost-label">
                            <span>{withLec.toFixed(2)} CHF</span>
                        </div>
                    )}
                </div>
            </div>
            <div className="bar-container">
                <div className="bar-label">Without Community</div>
                <div className="bar-wrapper">
                    {withoutLec > 0 ? (
                        <div className="bar no-lec-bar" style={{ width: `${withoutLecWidthPercent}%` }}>
                            <span>{withoutLec.toFixed(2)} CHF</span>
                        </div>
                    ) : (
                        <div className="bar no-lec-bar zero-cost-label">
                            <span>{withoutLec.toFixed(2)} CHF</span>
                        </div>
                    )}
                </div>
            </div>
            {savingsText && (
                <div className="savings-info">
                    <span>{savingsText}</span>
                </div>
            )}
        </div>
    );
};

// --- LoadGenProfile Component (Unchanged) ---
const LoadGenProfile = ({ loadProfile, genProfile }: { loadProfile: number[], genProfile: number[] }) => {
  // ... (Keep the existing LoadGenProfile logic)
    const data = loadProfile.map((load, index) => ({ time: index, load, generation: genProfile[index] }));
    return (
        <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" domain={[0, 23]} tickFormatter={(tick) => `${tick}:00`} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="load" stroke="#9ca3af" name="Load (kW)" />
                <Line type="monotone" dataKey="generation" stroke="#82ca9d" name="Generation (kW)" />
            </LineChart>
        </ResponsiveContainer>
    );
};


// --- Main App Component ---
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

  // --- Event Handlers ---
  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    // Ensure value is treated as number, handle potential NaN
    const numValue = Number(value);
    if (!isNaN(numValue)) {
        setParams((prev) => ({ ...prev, [name]: numValue }));
    }
  };

  const handleButtonClick = (name: string, value: any) => {
    setParams((prev) => ({ ...prev, [name]: value }));
  };

  const handleCircleSliderChange = (e: React.MouseEvent<HTMLDivElement>, name: string) => {
    const circle = e.currentTarget;
    const updateValue = (ev: MouseEvent | React.MouseEvent) => { // Use specific event types
      const rect = circle.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const angle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX);
      let percentage = ((angle + Math.PI) / (2 * Math.PI)) * 100;
      // Adjust percentage offset if needed to align start point visually
      percentage = (percentage + 75) % 100; // Current offset starts near the top-left visually
      const roundedPercentage = Math.max(0, Math.min(100, Math.round(percentage))); // Clamp to 0-100

      setParams(prev => ({ ...prev, [name]: roundedPercentage }));
    };

    updateValue(e); // Initial click

    const handleMouseMove = (ev: MouseEvent) => updateValue(ev); // Use specific event type
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // --- Form Submission ---
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    console.log('Form submitted');

    const submissionParams: SimulationParams = {
      community_size: params.community_size,
      season: params.season,
      pv_percentage: params.pv_percentage,
      sd_percentage: params.sd_percentage,
      with_battery: params.with_battery
    };

    console.log('Sending params:', submissionParams);

    try {
      const response = await fetch('http://localhost:8000/api/simulate', { // Ensure URL is correct
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(submissionParams)
      });

      const responseText = await response.text(); // Get text first for better error diagnosis

      if (!response.ok) {
         let errorMessage = `Simulation failed with status ${response.status}`;
         try {
             // Try to parse error detail from JSON response
             const errorData = JSON.parse(responseText);
             errorMessage = errorData.detail || errorMessage;
         } catch (parseError) {
             // If response is not JSON, use the raw text
             errorMessage = `${errorMessage}: ${responseText}`;
         }
         console.error("API Error:", errorMessage);
         throw new Error(errorMessage);
      }

      try {
        const data: SimulationResult = JSON.parse(responseText); // Parse the valid response
        console.log('Parsed response:', data);

        // Add more specific checks for nested properties if needed
        if (!data.cost_metrics || !data.energy_metrics || !data.market_metrics || !data.profiles) {
          console.error('Invalid response format: Missing key metrics sections.', data);
          throw new Error('Invalid response format from server.');
        }
        // Check if energy_metrics has expected fields (optional but good practice)
        if (typeof data.energy_metrics.total_consumption === 'undefined') {
             console.error('Invalid response format: Missing total_consumption in energy_metrics.', data.energy_metrics);
             throw new Error('Invalid response format: Missing required energy metrics.');
        }

        setResult(data);
      } catch (parseError: any) { // Catch specific error type
        console.error('Parse error:', parseError, "Response Text:", responseText);
        setError(`Failed to parse server response: ${parseError.message}`);
      }
    } catch (error: any) { // Catch specific error type
      console.error('Fetch/API Error:', error);
      setError(error instanceof Error ? error.message : 'An unexpected error occurred during simulation.');
    }
  };

  // --- Helper Functions ---
  const formatNumber = (num: number, decimals: number = 2): string => {
     // Add check for null/undefined/NaN input
     if (num == null || isNaN(num)) {
         return 'N/A'; // Or '0.00' or some other placeholder
     }
    const parts = num.toFixed(decimals).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, "'");
    return parts.join('.');
  };

  const getCircularPath = (percentage: number) => {
     // Ensure percentage is within bounds
     const clampedPercentage = Math.max(0, Math.min(100, percentage));
     if (clampedPercentage <= 0) return ""; // Return empty path for 0%

    const radius = 36;
    const center = 40;
    const startAngle = -Math.PI / 2; // Start from top
    // Calculate angle based on clamped percentage
    const angle = startAngle + (clampedPercentage / 100) * 2 * Math.PI;
    const largeArcFlag = clampedPercentage > 50 ? 1 : 0;

    const startX = center + radius * Math.cos(startAngle);
    const startY = center + radius * Math.sin(startAngle);
    const endX = center + radius * Math.cos(angle);
    const endY = center + radius * Math.sin(angle);

    // Correct path definition for SVG arc
    // M = move to start, A = arc (rx ry x-axis-rotation large-arc-flag sweep-flag x y)
    return `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY}`;

  };


  // --- JSX Render ---
  return (
    <div className="container">
      {error && (
        <div className="error">
          Error: {error}
        </div>
      )}

      <div className="flex-container">
        {/* --- Input Form --- */}
        <form onSubmit={handleSubmit} className="input-form">
          {/* Size Slider */}
          <div className="form-group">
            <label>Size (Households)</label> {/* More descriptive label */}
            <div className="size-slider" style={{
                // Calculate clip-path percentage based on value range 5-100
                '--clip-percent': `${100 - (((params.community_size - 5) / (100 - 5)) * 100)}%`
            } as React.CSSProperties}>
              <input
                type="range"
                name="community_size"
                min="5"
                max="100"
                step="1" // Ensure integer steps
                value={params.community_size}
                onChange={handleSliderChange}
                aria-labelledby="community-size-label" // Accessibility
              />
              {/* Display value inside or next to slider */}
              <span id="community-size-label" aria-hidden="true">{params.community_size}</span>
            </div>
          </div>

        {/* Season Buttons */}
          <div className="form-group">
            <label>Season</label>
            <div className="season-buttons">
              {Object.entries(SEASON_ICONS).map(([key, IconComponent]) => (
                <button
                  type="button"
                  key={key}
                  className={params.season === key ? 'active' : ''}
                  onClick={() => handleButtonClick('season', key)}
                  aria-pressed={params.season === key}
                  aria-label={key.charAt(0).toUpperCase() + key.slice(1)} // e.g., "Summer"
                >
                  <IconComponent />
                </button>
              ))}
            </div>
          </div>

          {/* Circular Sliders */}
          <div className="circles-row">
            <div className="circle-container">
              <label id="sd-label">Smart Devices</label> {/* More descriptive */}
              <div
                 className="circle"
                 onMouseDown={(e) => handleCircleSliderChange(e, 'sd_percentage')}
                 role="slider" // Accessibility
                 aria-valuemin={0}
                 aria-valuemax={100}
                 aria-valuenow={params.sd_percentage}
                 aria-labelledby="sd-label"
                 tabIndex={0} // Make it focusable
               >
                <svg className="circle-fill" viewBox="0 0 80 80">
                  {/* Use path generated by getCircularPath */}
                  <path d={getCircularPath(params.sd_percentage)} strokeWidth="8" stroke="limegreen" fill="none" />
                </svg>
                <span>{params.sd_percentage}%</span>
              </div>
            </div>

            <div className="circle-container">
              <label id="pv-label">Have PV</label> {/* More descriptive */}
              <div
                className="circle"
                onMouseDown={(e) => handleCircleSliderChange(e, 'pv_percentage')}
                role="slider" // Accessibility
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={params.pv_percentage}
                aria-labelledby="pv-label"
                tabIndex={0} // Make it focusable
              >
                <svg className="circle-fill" viewBox="0 0 80 80">
                  <path d={getCircularPath(params.pv_percentage)} strokeWidth="8" stroke="limegreen" fill="none" />
                </svg>
                <span>{params.pv_percentage}%</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="button-group">
            <button
              type="button"
              className={`battery-button ${params.with_battery ? 'active' : ''}`}
              onClick={() => handleButtonClick('with_battery', !params.with_battery)}
              aria-pressed={params.with_battery} // Accessibility
            >
              <BatteryIcon />
              {params.with_battery ? 'Yes' : 'No'} {/* Clearer text */}
            </button>
            <button type="submit">Simulate</button> {/* Changed text */}
          </div>
        </form>

              {/* --- Results Area --- */}
        {result && (
          <div className="results-container"> {/* This is display: grid */}
            {/* Item 1: Row 1, Col 1 */}
            <div className="result-tab">
              <h3>Average Cost per Household</h3>
              <CostComparison
                withLec={result.cost_metrics.cost_with_lec}
                withoutLec={result.cost_metrics.cost_without_lec}
              />
            </div>

            {/* Item 2: Row 1, Col 2 */}
            {result.profiles?.load_profile && result.profiles?.gen_profile && ( // Optional chaining
              <div className="result-tab">
                <h3>Load and Generation Profile (kW)</h3>
                <LoadGenProfile loadProfile={result.profiles.load_profile} genProfile={result.profiles.gen_profile} />
              </div>
            )}

            {/* --- START: Split Energy Flows into two tabs --- */}

            {/* Item 3: Row 2, Col 1 - Production Pie */}
            {result.energy_metrics ? (
              <div className="result-tab pie-chart-tab"> {/* Added common class */}
                 {/* Use H3 for consistency */}
                <h3>Production Allocation</h3>
                 {/* Removed intermediate container div */}
                <EnergyPieChart type="production" metrics={result.energy_metrics} formatNumber={formatNumber} />
              </div>
             ) : (
                // Optional: Render an empty placeholder grid item if metrics are missing
                // to maintain grid structure, or omit this tab entirely.
                 <div className="result-tab placeholder"></div> // Example placeholder
             )
            }

            {/* Item 4: Row 2, Col 2 - Consumption Pie */}
             {result.energy_metrics ? (
              <div className="result-tab pie-chart-tab"> {/* Added common class */}
                 {/* Use H3 for consistency */}
                <h3>Consumption Sources</h3>
                 {/* Removed intermediate container div */}
                <EnergyPieChart type="consumption" metrics={result.energy_metrics} formatNumber={formatNumber} />
              </div>
             ) : (
                 <div className="result-tab placeholder"></div> // Example placeholder
             )
            }

            {/* Item 6: Row 3, Col 2 - Warnings (Example) */}
            {result.warnings && result.warnings.length > 0 && (
               <div className="result-tab">
                  <h3>Warnings</h3>
                  <ul> {result.warnings.map((warning, index) => (<li key={`warn-${index}`}>{warning}</li> ))} </ul>
               </div>
            )}

            {/* Item 7: Row 4, Col 1 - Errors (Example) */}
            {result.errors && result.errors.length > 0 && (
               <div className="result-tab">
                 <h3>Errors</h3>
                 <ul> {result.errors.map((errorMsg, index) => ( <li key={`err-${index}`}>{errorMsg}</li> ))} </ul>
               </div>
            )}
          </div>
        )}

        <section className="results-explanation-banner">
        {/* Item 1: Cost */}
        <div className="explanation-item">
           <div className="explanation-icon-wrapper">
             {/* Cost Icon SVG */}
             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="explanation-icon">
               <path fillRule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5a.997.997 0 01.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
             </svg>
           </div>
           <h4>Cost Comparison</h4>
           <p>See how the average bill per household over an entire Season is affected by the ability to trade with your neighbors.</p>
        </div>

        {/* Item 2: Load Profile */}
        <div className="explanation-item">
           <div className="explanation-icon-wrapper">
             {/* Line Graph Icon SVG */}
             <svg
               xmlns="http://www.w3.org/2000/svg"
               viewBox="0 0 20 20"
               fill="none" // Use 'none' for fill as we are stroking the path
               stroke="currentColor" // Use stroke for the line color
               strokeWidth="1.5"     // Adjust line thickness if needed
               strokeLinecap="round" // Smoother line endings
               strokeLinejoin="round" // Smoother line joins
               className="explanation-icon"
             >
               {/* A path representing a simple fluctuating line graph */}
               <path d="M 2 17 L 6 7 L 10 12 L 14 4 L 18 8" />
               { <path d="M 2 18 L 18 18 M 2 18 L 2 2" strokeWidth="1" /> }
             </svg>
           </div>
           <h4>Daily Energy Pattern</h4>
           <p>Shows the average ups and downs of electricity use and solar generation over 24 hours.</p>
        </div>

        {/* Item 3: Energy Flows */}
        <div className="explanation-item">
           <div className="explanation-icon-wrapper">
            {/* Pie Chart Icon SVG */}
             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="explanation-icon">
                <path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z" />
               <path d="M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z" /> {/* Re-using line chart icon is fine */}
             </svg>
           </div>
           <h4>Energy Flows</h4>
           <p>Visualizes where your energy comes from (solar, grid etc.) and where generated energy goes.</p>
        </div>
      </section>

      </div> {/* End of flex-container */}
       <footer className="footer-banner">
        <img src="/logos/hslu.png" alt="Description for Logo 1" className="footer-logo"/>
        <img src="/logos/lantern.png" alt="Description for Logo 2" className="footer-logo"/>
        <img src="/logos/persist.png" alt="Description for Logo 3" className="footer-logo"/>
      </footer>

    </div> // End of container
  );
} // End of App component

export default App;
