import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
    PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis,
    CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { FaCanadianMapleLeaf, FaCoins, FaRegSnowflake, FaRegSun } from 'react-icons/fa';
import { PiSolarPanelFill, PiCity, PiGraph, PiFlowerTulipBold } from 'react-icons/pi';
import { GiWashingMachine } from "react-icons/gi";
import { RiDonutChartFill } from "react-icons/ri";
import { BsCloudSun } from 'react-icons/bs';
import { IoIosBatteryFull } from 'react-icons/io';
import { VscGraphLine } from 'react-icons/vsc';
import TradingNetworkForceGraph from './components/TradingNetworkForceGraph';
import './App.css';

// --- Constants ---
const API_ENDPOINT = 'http://localhost:8000/api/simulate';
const RADIAN = Math.PI / 180;
const MIN_COMMUNITY_SIZE = 5;
const MAX_COMMUNITY_SIZE = 100;
const PIE_CHART_COLORS = {
    selfConsumed: '#a3e635', // Greenish
    toBattery: '#65a30d',    // Lighter Green
    toMarket: '#82ca9d',     // Teal/Mint
    toGrid: '#9ca3af',       // Grey
    fromPV: '#a3e635',       // Same as selfConsumed
    fromBattery: '#65a30d',  // Same as toBattery
    fromMarket: '#82ca9d',   // Same as toMarket
    fromGrid: '#9ca3af',     // Same as toGrid
};
const SEASON_ICONS: Record<string, React.ComponentType<any>> = {
    'sum': FaRegSun,
    'win': FaRegSnowflake,
    'aut': FaCanadianMapleLeaf,
    'spr': PiFlowerTulipBold,
};
const CHART_HEIGHT = 260; // Consistent height for Pie charts
const PROFILE_CHART_HEIGHT = 300; // Height for Load/Gen profile chart
const GRAPH_CHART_HEIGHT = 300; // Height for Force Graph
const VALUE_TOLERANCE = 0.01; // Threshold for ignoring small values in charts/calcs


// --- Interfaces ---
interface SimulationParams {
    community_size: number;
    season: string;
    pv_percentage: number;
    sd_percentage: number;
    with_battery: boolean;
}

interface EnergyMetricsData {
    total_consumption: number;
    total_grid_import: number;
    self_consumption_volume: number;
    trading_volume: number;
    total_discharging_volume: number;
    total_production: number;
    total_grid_export: number;
    total_charging_volume: number;
}

interface CostMetricsData {
    cost_with_lec: number;
    cost_without_lec: number;
}

interface MarketMetricsData {
    ratio_fulfilled_demand: number;
    ratio_sold_supply: number;
}

interface ProfileData {
    load_profile: number[];
    gen_profile: number[];
}

// --- Interface for Trading Network Data ---
interface TradingNetworkNode {
    id: string | number; // e.g., 'building_1', 'grid'
    type: 'building' | 'grid';
}
interface TradingNetworkLink {
    source: string; // id of source node
    target: string; // id of target node
    value: number; // Amount of energy traded
}
interface TradingNetworkData {
    links: TradingNetworkLink[];
    nodes: TradingNetworkNode[];
}
// --- End Trading Network Data Interface ---

interface SimulationResult {
    energy_metrics: EnergyMetricsData;
    cost_metrics: CostMetricsData;
    market_metrics: MarketMetricsData;
    profiles: ProfileData;
    trading_network: TradingNetworkData | null;
    warnings: string[];
    errors: string[];
}

interface SimulationHistoryEntry {
  params: SimulationParams;
  result: SimulationResult;
  index: number;
}

// --- Helper Functions ---

/** Formats a number with thousand separators (') and fixed decimal places. */
const formatNumber = (num: number | null | undefined, decimals: number = 2): string => {
    if (num == null || isNaN(num)) {
        return 'N/A';
    }
    const fixedNum = num.toFixed(decimals);
    const parts = fixedNum.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, "'");
    return parts.join('.');
};

/** Generates an SVG arc path string for the circular sliders. */
const getCircularPath = (percentage: number): string => {
    const clampedPercentage = Math.max(0, Math.min(100, percentage));
    if (clampedPercentage <= 0) return ""; // No path needed for 0%

    const radius = 36; // Corresponds to circle dimensions - border width
    const center = 40; // Center of the 80x80 SVG viewbox
    const startAngle = -Math.PI / 2; // Start from the top (12 o'clock)
    const angle = startAngle + (clampedPercentage / 100) * 2 * Math.PI;
    const largeArcFlag = clampedPercentage > 50 ? 1 : 0;

    const startX = center + radius * Math.cos(startAngle);
    const startY = center + radius * Math.sin(startAngle);
    const endX = center + radius * Math.cos(angle);
    const endY = center + radius * Math.sin(angle);

    // M = move to, A = arc (rx ry x-axis-rotation large-arc-flag sweep-flag x y)
    return `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY}`;
};

// --- Reusable Components ---

interface ResultSelectorProps {
    history: SimulationHistoryEntry[];
    selectedIndex: number | null;
    onSelect: (index: number) => void;
}

/** Dropdown to select previously run simulation results. */
const ResultSelector: React.FC<ResultSelectorProps> = ({ history, selectedIndex, onSelect }) => {
    const resultsCount = history.length;
    if (resultsCount === 0) {
        return null; // Don't render if no results exist
    }

    const handleSelectionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const newIndex = parseInt(event.target.value, 10);
        if (!isNaN(newIndex)) {
            onSelect(newIndex);
        }
    };

    return (
        <div className="result-selector-container">
            <label htmlFor="result-select">View Result:</label>
            <select
                id="result-select"
                value={selectedIndex ?? ''}
                onChange={handleSelectionChange}
            >
                {history.map((entry, index) => {
                  // Example: Display timestamp if available
                  const timestampStr = entry.index? ` (${new Date(entry.index).toLocaleTimeString()})` : '';
                  return (
                      <option key={index} value={index}>
                          Simulation #{index + 1}{timestampStr}
                      </option>
                  );
              })}
           </select>
        </div>
    );
};

/** Simple SVG icon for the battery toggle button. */
const BatteryIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20 10V8A2 2 0 0 0 18 6H4A2 2 0 0 0 2 8V16A2 2 0 0 0 4 18H18A2 2 0 0 0 20 16V14H22V10H20M18 16H4V8H18V16M6 10V14H16V10H6Z" />
    </svg>
);

interface EnergyPieChartProps {
    type: 'production' | 'consumption';
    metrics: EnergyMetricsData | null; // Allow null metrics
}

/** Pie chart component for visualizing energy production allocation or consumption sources. */
const EnergyPieChart: React.FC<EnergyPieChartProps> = ({ type, metrics }) => {

    const chartData = useMemo(() => {
        if (!metrics) return [];

        const {
            total_consumption = 0,
            total_grid_import = 0,
            self_consumption_volume = 0,
            trading_volume = 0,
            total_discharging_volume = 0,
            total_production = 0,
            total_grid_export = 0,
            total_charging_volume = 0,
        } = metrics;

        let data: { name: string; value: number; color: string }[] = [];

        if (type === 'production') {
            if (total_production < VALUE_TOLERANCE) return [];
            if (self_consumption_volume > VALUE_TOLERANCE) data.push({ name: 'Self-Consumed', value: self_consumption_volume, color: PIE_CHART_COLORS.selfConsumed });
            if (total_charging_volume > VALUE_TOLERANCE) data.push({ name: 'To Battery', value: total_charging_volume, color: PIE_CHART_COLORS.toBattery });
            if (trading_volume > VALUE_TOLERANCE) data.push({ name: 'Market (Sold)', value: trading_volume, color: PIE_CHART_COLORS.toMarket });
            if (total_grid_export > VALUE_TOLERANCE) data.push({ name: 'Grid (Export)', value: total_grid_export, color: PIE_CHART_COLORS.toGrid });

        } else { // type === 'consumption'
            if (total_consumption < VALUE_TOLERANCE) return [];
            if (self_consumption_volume > VALUE_TOLERANCE) data.push({ name: 'From own PV', value: self_consumption_volume, color: PIE_CHART_COLORS.fromPV });
            if (total_discharging_volume > VALUE_TOLERANCE) data.push({ name: 'From Battery', value: total_discharging_volume, color: PIE_CHART_COLORS.fromBattery });
            if (trading_volume > VALUE_TOLERANCE) data.push({ name: 'Market (Bought)', value: trading_volume, color: PIE_CHART_COLORS.fromMarket });
            if (total_grid_import > VALUE_TOLERANCE) data.push({ name: 'Grid (Import)', value: total_grid_import, color: PIE_CHART_COLORS.fromGrid });
        }

        return data.filter(d => d.value > VALUE_TOLERANCE);

    }, [metrics, type]); // Recalculate only when metrics or type change

    const renderCustomizedLabel = useCallback(({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }: any) => {
        if (percent == null || isNaN(percent) || percent < 0.03) return null; // Hide labels for very small slices

        const radius = innerRadius + (outerRadius - innerRadius) * 0.6; // Position label inside slice
        const x = cx + radius * Math.cos(-midAngle * RADIAN);
        const y = cy + radius * Math.sin(-midAngle * RADIAN);

        return (
            <text x={x} y={y} fill="#333" textAnchor="middle" dominantBaseline="central" fontSize="11px" fontWeight="500">
                {`${(percent * 100).toFixed(0)}%`}
            </text>
        );
    }, []); // No dependencies, function is stable

    const renderTooltipContent = useCallback((props: any) => {
        const { payload } = props;
        if (payload && payload.length > 0 && payload[0] && payload[0].payload) {
            const { name, value, color } = payload[0].payload;
            if (typeof value !== 'number' || isNaN(value)) return null;

            const total = chartData.reduce((sum, entry) => sum + entry.value, 0);
            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';

            return (
                <div className="custom-tooltip">
                    <p style={{ color: color || '#000', fontWeight: 'bold' }}>{name}</p>
                    <p>{`${formatNumber(value)} kWh (${percentage}%)`}</p>
                </div>
            );
        }
        return null;
    }, [chartData]); // Depends on chartData for total calculation

    if (!metrics) {
        return <p>Loading data...</p>; // Or some placeholder
    }

    if (chartData.length === 0) {
        return <p>No significant data available for this chart.</p>;
    }

    return (
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <PieChart margin={{ top: 5, right: 5, bottom: 5, left: 5 }}> {/* Increased bottom margin for legend */}
                <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={renderCustomizedLabel}
                    outerRadius={80} // Adjust radius as needed
                    innerRadius={50} // Make it a donut chart
                    fill="#8884d8" // Default fill (overridden by Cells)
                    dataKey="value"
                    nameKey="name"
                >
                    {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} stroke={entry.color} />
                    ))}
                </Pie>
                <Tooltip content={renderTooltipContent} />
                <Legend
                    layout="horizontal"
                    verticalAlign="bottom"
                    align="center"
                    iconSize={10}
                    wrapperStyle={{ paddingTop: '15px', paddingBottom: '5px' }} // Adjust spacing around legend
                />
            </PieChart>
        </ResponsiveContainer>
    );
};

interface CostComparisonProps {
    withLec: number | null;
    withoutLec: number | null;
}

/** Displays comparison bars for costs with and without the energy community. */
const CostComparison: React.FC<CostComparisonProps> = ({ withLec, withoutLec }) => {
    if (withLec === null || withoutLec === null) {
        return <p>Cost data not available.</p>;
    }

    // Handle potentially negative costs (profits) for scaling
    const maxValue = Math.max(withLec, withoutLec, 0); // Find highest cost (or 0 if both are profits)
    const minValue = Math.min(withLec, withoutLec, 0); // Find lowest cost/highest profit
    const range = Math.max(maxValue - minValue, VALUE_TOLERANCE); // Avoid division by zero

    // Calculate width percentage based on positive cost values relative to max cost
    const calculateWidth = (cost: number) => {
        if (cost <= 0) return 0; // No bar width for zero or negative cost
        // Scale width based on the maximum positive cost only
        const positiveMax = Math.max(withLec, withoutLec, VALUE_TOLERANCE);
        return Math.max(0, Math.min(100, (cost / positiveMax) * 100));
    }

    const withLecWidthPercent = calculateWidth(withLec);
    const withoutLecWidthPercent = calculateWidth(withoutLec);

    const savings = withoutLec - withLec;
    let savingsText = '';

    if (Math.abs(savings) < VALUE_TOLERANCE) {
        savingsText = 'Costs are effectively the same.';
    } else if (savings > 0) { // withLec cost is lower than withoutLec cost
        const percentageSavings = Math.abs(withoutLec) > VALUE_TOLERANCE ? (savings / Math.abs(withoutLec)) * 100 : 0;
        savingsText = `Savings with community: ${formatNumber(savings)} CHF`;
        if (percentageSavings > 0) {
           savingsText += ` (${percentageSavings.toFixed(1)}%)`;
        }
    } else { // withLec cost is higher than withoutLec cost
        const percentageIncrease = Math.abs(withoutLec) > VALUE_TOLERANCE ? (Math.abs(savings) / Math.abs(withoutLec)) * 100 : 0;
        savingsText = `Increased cost with community: ${formatNumber(Math.abs(savings))} CHF`;
         if (percentageIncrease > 0) {
            savingsText += ` (${percentageIncrease.toFixed(1)}%)`;
         }
    }
    // Add note about profits if applicable
    if (withLec < 0 || withoutLec < 0) {
        savingsText += " (Negative values indicate profit)";
    }

    return (
        <div className="cost-comparison">
            <div className="bar-container">
                <div className="bar-label">With Community: {formatNumber(withLec)} CHF</div>
                <div className="bar-wrapper">
                    {withLec > 0 && (
                        <div className="bar lec-bar" style={{ width: `${withLecWidthPercent}%` }} />
                    )}
                </div>
            </div>
            <div className="bar-container">
                <div className="bar-label">Without Community: {formatNumber(withoutLec)} CHF</div>
                <div className="bar-wrapper">
                     {withoutLec > 0 && (
                        <div className="bar no-lec-bar" style={{ width: `${withoutLecWidthPercent}%` }} />
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

interface LoadGenProfileProps {
    profiles: ProfileData | null;
}

/** Displays a line chart showing average daily load and generation profiles. */
const LoadGenProfile: React.FC<LoadGenProfileProps> = ({ profiles }) => {
    const chartData = useMemo(() => {
        if (!profiles?.load_profile || !profiles?.gen_profile || profiles.load_profile.length === 0) {
            return [];
        }
        // Assuming both profiles have the same length (e.g., 24 hours)
        return profiles.load_profile.map((load, index) => ({
            time: index, // Represents hour 0 to 23
            load: load ?? 0, // Default to 0 if null/undefined
            generation: profiles.gen_profile[index] ?? 0, // Default to 0
        }));
    }, [profiles]);

    if (chartData.length === 0) {
        return <p>Load and Generation profile data not available.</p>;
    }

    return (
        <ResponsiveContainer width="100%" height={PROFILE_CHART_HEIGHT}>
            <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0"/>
                <XAxis
                    dataKey="time"
                    domain={[0, 23]}
                    type="number"
                    tickFormatter={(tick) => `${tick}:00`}
                    interval="preserveStartEnd" // Show 0:00 and 23:00
                    ticks={[0, 6, 12, 18, 23]} // Define specific ticks
                />
                <YAxis unit=" kW" width={45}/>
                <Tooltip formatter={(value: number) => formatNumber(value, 2)} />
                <Legend verticalAlign="top" height={36}/>
                <Line type="monotone" dataKey="load" stroke="#9ca3af" name="Load" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="generation" stroke="#a3e635" name="PV Gen" dot={false} strokeWidth={2}/>
            </LineChart>
        </ResponsiveContainer>
    );
};

// --- Main Application Component ---
function App() {
    const [resultsHistory, setResultsHistory] = useState<SimulationHistoryEntry[]>([]);
    const [selectedResultIndex, setSelectedResultIndex] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [params, setParams] = useState<SimulationParams>({
        community_size: 10,
        season: 'sum',
        pv_percentage: 50,
        sd_percentage: 25,
        with_battery: true,
    });

    const currentHistoryEntry = useMemo(() => {
      if (selectedResultIndex === null || selectedResultIndex < 0 || selectedResultIndex >= resultsHistory.length) {
        return null;
      }
      return resultsHistory[selectedResultIndex];
    }, [selectedResultIndex, resultsHistory]);

    // Memoize current result to avoid recalculation on every render
    const currentResult = useMemo(() => {
      return currentHistoryEntry?.result ?? null;
    }, [currentHistoryEntry]);

    // --- Event Handlers  ---

    useEffect(() => {
        // Check if a valid index is selected and exists in history
        if (selectedResultIndex !== null && selectedResultIndex >= 0 && selectedResultIndex < resultsHistory.length) {
            const selectedEntry = resultsHistory[selectedResultIndex];
            // Update the main params state with the stored params from that history entry
            setParams(selectedEntry.params);
        }
        // This effect runs when the selected index changes or the history array itself changes
    }, [selectedResultIndex, resultsHistory]);

    const handleParamChange = useCallback((key: keyof SimulationParams, value: any) => {
        setParams(prev => ({ ...prev, [key]: value }));
    }, []);

    const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        const numValue = Number(value);
        if (!isNaN(numValue) && name in params) {
            handleParamChange(name as keyof SimulationParams, numValue);
        }
    }, [handleParamChange, params]); // Include params if validation depends on it

    const handleCircleSliderInteraction = useCallback((e: React.MouseEvent<HTMLDivElement>, name: keyof SimulationParams) => {
        const circle = e.currentTarget;
        const rect = circle.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const updateValue = (ev: MouseEvent | React.MouseEvent) => {
            const angle = Math.atan2(ev.clientY - centerY, ev.clientX - centerX);
            // Map angle (-PI to PI) to percentage (0 to 100), starting from top (approx -PI/2)
            let percentage = ((angle + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * 100;
            const roundedPercentage = Math.max(0, Math.min(100, Math.round(percentage)));
            // Use requestAnimationFrame to potentially batch updates
            requestAnimationFrame(() => {
                 handleParamChange(name, roundedPercentage);
            });
        };

        updateValue(e); // Initial value on mouse down

        const handleMouseMove = (ev: MouseEvent) => updateValue(ev);
        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [handleParamChange]);

    const handleSubmit = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);
        const currentParams = { ...params };
        console.log('Submitting simulation params:', params);

        try {
            const response = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify(params)
            });

            const responseBody = await response.text();

            if (!response.ok) {
                let errorMessage = `Error ${response.status}: ${response.statusText}`;
                try {
                    const errorJson = JSON.parse(responseBody);
                    if (errorJson.detail) {
                        if (Array.isArray(errorJson.detail)) { // Handle Pydantic validation errors
                            errorMessage = errorJson.detail.map((err: any) => `${err.loc.join('.')} - ${err.msg}`).join('; ');
                        } else {
                            errorMessage = errorJson.detail;
                        }
                    } else if (errorJson.message) {
                         errorMessage = errorJson.message;
                    }
                } catch (parseError) {
                    if (responseBody) errorMessage += ` - ${responseBody}`;
                }
                 console.error("API Error Response:", responseBody);
                throw new Error(errorMessage);
            }

            // Try parsing the successful response
            try {
                const data: SimulationResult = JSON.parse(responseBody);
                console.log('Received simulation result:', data);

                // Basic validation of received structure
                if (!data || !data.cost_metrics || !data.energy_metrics || !data.profiles ) { // removed trading_network check for now !data.trading_network
                    throw new Error('Received incomplete or invalid data structure from server.');
                }
                 // Add specific check for trading_network if it's crucial
                 if (data.trading_network === undefined) {
                    console.warn("API response did not include 'trading_network' field.");
                    // Optionally set it to null or an empty structure if needed downstream
                    data.trading_network = null;
                 }


                setResultsHistory(prevHistory => {
                    const newEntry: SimulationHistoryEntry = {
                      params: currentParams,
                      result: data,
                      index: Date.now()
                    }
                    const newHistory = [...prevHistory, newEntry];
                    // Select the newly added result
                    setSelectedResultIndex(newHistory.length - 1);
                    return newHistory;
                });

            } catch (parseError: any) {
                 console.error('Failed to parse successful response:', parseError, "Response Body:", responseBody);
                 throw new Error(`Failed to process server response: ${parseError.message}`);
            }

        } catch (error: any) {
            console.error('Simulation request failed:', error);
            setError(error instanceof Error ? error.message : 'An unexpected error occurred.');
        } finally {
            setIsLoading(false);
        }
    }, [params]); // Depends on params for submission

    // Calculate clip-path percentage for the size slider's visual fill
    const sizeSliderClipPercent = useMemo(() => {
         const range = MAX_COMMUNITY_SIZE - MIN_COMMUNITY_SIZE;
         if (range <= 0) return 0;
         const valuePercent = ((params.community_size - MIN_COMMUNITY_SIZE) / range) * 100;
         return 100 - valuePercent; // Inset from the right
    }, [params.community_size]);

    // --- JSX Structure ---
    return (
        <div className="container">

            {error && <div className="error">Error: {error}</div>}

            <div className="flex-container">

              {/* --- Input Column --- */}
              <div className="input-column">

                {/* --- Input Form Section --- */}
                <form onSubmit={handleSubmit} className="input-form">
                    <div className="form-header">
                        <h2>Energy Community Simulator</h2>
                        <p>Configure and simulate the performance of a local energy community.</p>
                    </div>

                    {/* Community Size Slider */}
                    <div className="form-group">
                        <label htmlFor="community_size">Community Size (Buildings)</label>
                        <div className="size-slider" style={{ '--clip-percent': `${sizeSliderClipPercent}%` } as React.CSSProperties}>
                            <input
                                type="range"
                                id="community_size"
                                name="community_size"
                                min={MIN_COMMUNITY_SIZE}
                                max={MAX_COMMUNITY_SIZE}
                                step="1"
                                value={params.community_size}
                                onChange={handleSliderChange}
                                disabled={isLoading}
                                aria-describedby="community-size-value"
                            />
                            <span id="community-size-value" aria-hidden="true">{params.community_size}</span>
                        </div>
                    </div>

                    {/* Season Selection */}
                    <div className="form-group">
                        <label>Season</label>
                        <div className="season-buttons">
                            {Object.entries(SEASON_ICONS).map(([key, IconComponent]) => (
                                <button
                                    type="button"
                                    key={key}
                                    className={params.season === key ? 'active' : ''}
                                    onClick={() => handleParamChange('season', key)}
                                    disabled={isLoading}
                                    aria-pressed={params.season === key}
                                    aria-label={`Season: ${key}`} // More descriptive label
                                >
                                    <IconComponent aria-hidden="true" />
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Circular Sliders for PV/SD Percentage */}
                    <div className="circles-row">
                        <div className="circle-container">
                            <label id="sd-label">Smart Devices</label>
                            <div
                                className="circle"
                                onMouseDown={(e) => handleCircleSliderInteraction(e, 'sd_percentage')}
                                role="slider"
                                aria-valuemin={0} aria-valuemax={100}
                                aria-valuenow={params.sd_percentage}
                                aria-labelledby="sd-label"
                                tabIndex={isLoading ? -1 : 0} // Prevent focus when loading
                            >
                                <svg className="circle-fill" viewBox="0 0 80 80">
                                    <path d={getCircularPath(params.sd_percentage)} />
                                </svg>
                                <span>{params.sd_percentage}%</span>
                            </div>
                        </div>
                        <div className="circle-container">
                            <label id="pv-label">PV Adoption</label>
                            <div
                                className="circle"
                                onMouseDown={(e) => handleCircleSliderInteraction(e, 'pv_percentage')}
                                role="slider"
                                aria-valuemin={0} aria-valuemax={100}
                                aria-valuenow={params.pv_percentage}
                                aria-labelledby="pv-label"
                                tabIndex={isLoading ? -1 : 0}
                            >
                                <svg className="circle-fill" viewBox="0 0 80 80">
                                    <path d={getCircularPath(params.pv_percentage)} />
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
                            onClick={() => handleParamChange('with_battery', !params.with_battery)}
                            disabled={isLoading}
                            aria-pressed={params.with_battery}
                            aria-label="Toggle community battery"
                        >
                            <BatteryIcon aria-hidden="true" />
                            Battery: {params.with_battery ? 'On' : 'Off'}
                        </button>
                        <button type="submit" disabled={isLoading}>
                            {isLoading ? 'Simulating...' : 'Run Simulation'}
                        </button>
                    </div>
                </form>

                      {/* --- Input Explanation Panel --- */}
                <section className="input-explanation-panel" aria-labelledby="input-explanation-title">
                     <h3 id="input-explanation-title">Input Explanation</h3> {/* Title for the panel */}

                     {/* Explanation Item 1: Community Size */}
                     <div className="explanation-item">
                        <div className="explanation-icon-wrapper">
                           {/* Buildings Icon SVG */}
                           <PiCity className="explanation-icon" aria-hidden="true"/>
                        </div>
                        <div> {/* Wrap text for better alignment if using flex on item */}
                          <h4>Community Size</h4>
                          <p>Choose the number of buildings (of six households each) participating in the local energy community. Buildings without solar panels can still purchase energy from their neighbors.</p>
                        </div>
                     </div>

                     {/* Explanation Item 2: Season */}
                     <div className="explanation-item">
                        <div className="explanation-icon-wrapper">
                           {/* Season Icon SVG */}
                           <BsCloudSun className="explanation-icon" aria-hidden="true"/>
                        </div>
                         <div>
                           <h4>Season</h4>
                           <p>Select which season the 3-month simulation takes place in. This greatly affects energy usage and solar generation.</p>
                         </div>
                     </div>

                     {/* Explanation Item 3: PV adoption slider */}
                     <div className="explanation-item">
                        <div className="explanation-icon-wrapper">
                           {/* PV Icon SVG */}
                           <PiSolarPanelFill className="explanation-icon" aria-hidden="true"/>
                        </div>
                         <div>
                           <h4>PV Adoption</h4>
                           <p>Adjust the percentage of buildings with solar panels (PV).</p>
                         </div>
                     </div>

                     {/* Explanation Item 4: Smart Device Slider */}
                     <div className="explanation-item">
                        <div className="explanation-icon-wrapper">
                           {/* SD Icon SVG */}
                           <GiWashingMachine className="explanation-icon" aria-hidden="true"/>
                        </div>
                         <div>
                           <h4>Smart Devices</h4>
                           <p>Adjust the percentage of households with controllable smart devices. This allows for smart load shifting to reduce peak usage.</p>
                         </div>
                     </div>

                     {/* Explanation Item 5: Battery */}
                     <div className="explanation-item">
                        <div className="explanation-icon-wrapper">
                           {/* SD Icon SVG */}
                           <IoIosBatteryFull className="explanation-icon" aria-hidden="true"/>
                        </div>
                        <div>
                          <h4>Battery</h4>
                          <p>Decide whether buildings with solar panels also have a battery. Excess solar production can be used to charge the battery, and it can be discharged when solar production is not sufficient.</p>
                        </div>
                     </div>

                </section>
              </div> {/* --- End input-column wrapper --- */}

              {/* --- Results Display Section --- */}
              <div className="results-area">
                  <ResultSelector
                      history={resultsHistory}
                      selectedIndex={selectedResultIndex}
                      onSelect={setSelectedResultIndex}
                  />

                  {/* Display selected result or placeholder */}
                  {currentResult ? (
                      <div className="current-result-display">
                          <div className="results-container"> {/* This should be display: grid; grid-template-columns: repeat(3, 1fr); in CSS */}

                              {/* --- Column 1 --- */}
                              <div className="result-tab">
                                  <h3>Avg. Cost per Household</h3>
                                  <CostComparison
                                      withLec={currentResult.cost_metrics?.cost_with_lec}
                                      withoutLec={currentResult.cost_metrics?.cost_without_lec}
                                  />
                              </div>

                              <div className="result-tab">
                                  <h3>Avg. Daily Energy Profile</h3>
                                  <LoadGenProfile profiles={currentResult.profiles} />
                              </div>

                              <div className="result-tab trading-network-tab-span">
                                  <h3>Trading Network</h3>
                                  <TradingNetworkForceGraph
                                      tradingNetwork={currentResult.trading_network}
                                      width={350} // Adjust as needed
                                      height={GRAPH_CHART_HEIGHT * 2 + 20} // Approx double height + gap
                                  />
                              </div>

                               <div className="result-tab pie-chart-tab">
                                  <h3>Energy Consumption Sources</h3>
                                  <EnergyPieChart type="consumption" metrics={currentResult.energy_metrics} />
                              </div>

                              <div className="result-tab pie-chart-tab">
                                  <h3>PV Production Allocation</h3>
                                  <EnergyPieChart type="production" metrics={currentResult.energy_metrics} />
                              </div>

                              {/* --- Output Explanation Panel (Spanning all columns) --- */}
                              <section className="output-explanation-panel" aria-labelledby="output-explanation-title">
                                   <h3 id="output-explanation-title">Results Explanation</h3>
                                    {/* Use the grid container for explanation items */}
                                    <div className="explanation-items-grid">

                                        <div className="explanation-item">
                                            <div className="explanation-icon-wrapper">
                                                <FaCoins className="explanation-icon" aria-hidden="true"/>
                                            </div>
                                            <div>
                                                <h4>Cost Comparison</h4>
                                                <p>Shows the average cost per household over the simulated period, comparing scenarios with and without the energy community.</p>
                                            </div>
                                        </div>

                                        <div className="explanation-item">
                                            <div className="explanation-icon-wrapper">
                                                <VscGraphLine className="explanation-icon" aria-hidden="true"/>
                                            </div>
                                            <div>
                                                <h4>Daily Energy Pattern</h4>
                                                <p>Illustrates the average electricity consumption (Load) and solar generation (PV Gen) per building over 24 hours.</p>
                                            </div>
                                        </div>

                                        <div className="explanation-item">
                                            <div className="explanation-icon-wrapper">
                                                <PiGraph className="explanation-icon" aria-hidden="true"/>
                                            </div>
                                            <div>
                                                <h4>Trading Network</h4>
                                                <p>Visualizes energy flows between buildings and the grid. Thicker lines indicate more energy traded (log scale).</p>
                                            </div>
                                        </div>

                                        <div className="explanation-item">
                                            <div className="explanation-icon-wrapper">
                                                <RiDonutChartFill className="explanation-icon" aria-hidden="true"/>
                                            </div>
                                            <div>
                                                <h4>Energy Flow</h4>
                                                <p>Shows how generated solar energy is used (Production Allocation) and where consumed energy comes from (Consumption Sources).</p>
                                            </div>
                                        </div>

                                    </div> {/* End .explanation-items-grid */}
                              </section>
                               {/* End output-explanation-panel */}

                              {/* Warnings Tab (Optional - placed below explanation) */}
                              {currentResult.warnings && currentResult.warnings.length > 0 && (
                                  <div className="result-tab warnings-tab"> {/* Add class, maybe style differently */}
                                      <h3>Warnings</h3>
                                      <ul>
                                          {currentResult.warnings.map((warning, index) => (<li key={`warn-${index}`}>{warning}</li>))}
                                      </ul>
                                  </div>
                              )}

                              {/* Errors Tab (Optional - might indicate partial success - placed below explanation) */}
                              {currentResult.errors && currentResult.errors.length > 0 && (
                                  <div className="result-tab errors-tab"> {/* Add class */}
                                      <h3>Simulation Errors</h3>
                                      <ul>
                                          {currentResult.errors.map((errMsg, index) => (<li key={`err-${index}`}>{errMsg}</li>))}
                                      </ul>
                                  </div>
                              )}
                          </div> {/* End .results-container */}
                      </div> // End .current-result-display
                  ) : (
                       // Show loading state or initial prompt
                      !isLoading && resultsHistory.length === 0 && !error && (
                          <p className="no-results-yet">Run a simulation to see the results here.</p>
                      )
                      // Could add a specific loading indicator here if desired while isLoading is true
                       || isLoading && ( // Show loading indicator within results area
                           <div className="loading-indicator">
                               <p>Loading results...</p> {/* Add a spinner or better visual */}
                           </div>
                       )
                  )}
              </div> {/* End .results-area */}

            </div> {/* End .flex-container */}

            {/* Footer Section */}
            <footer className="footer-banner">
                 {/* Ensure alt text is descriptive or leave empty if purely decorative */}
                <img src="/logos/hslu.png" alt="HSLU Logo" className="footer-logo" />
                <img src="/logos/lantern.png" alt="Lantern Project Logo" className="footer-logo" />
                <img src="/logos/persist.png" alt="PERSIST Project Logo" className="footer-logo" />
            </footer>

        </div> // End .container
    );
}

export default App;
