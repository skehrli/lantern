import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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
import LanguageSwitcher from './components/LanguageSwitcher';
import TradingNetworkForceGraph from './components/TradingNetworkForceGraph';
import './App.css';
import explanationAudio from './assets/explanation.mp3';

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
const SEASON_DISPLAY_NAMES: { [key: string]: string } = {
    sum: "Summer",
    win: "Winter",
    aut: "Autumn",
    spr: "Spring"
};
const SEASON_ICONS: Record<string, React.ComponentType<any>> = {
    'sum': FaRegSun,
    'win': FaRegSnowflake,
    'aut': FaCanadianMapleLeaf,
    'spr': PiFlowerTulipBold,
};
const CHART_HEIGHT = 300; // Consistent height for Pie charts
const PROFILE_CHART_HEIGHT = 300; // Height for Load/Gen profile chart
const VALUE_TOLERANCE = 0.1; // Threshold for ignoring small values in charts/calcs
const MAX_SAVINGS_PER_HH = 30; // Max expected savings in CHF for scaling visualization

// --- Interfaces ---
interface SimulationParams {
    community_size: number;
    season: string;
    pv_percentage: number;
    sd_percentage: number;
    with_battery: boolean;
}

interface MarketMetricsData {
    supply_sold: number;
    demand_covered: number;
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

export interface IndividualMetricsData {
    individual_selfconsumption_volume: number[];
    individual_grid_import: number[];
    individual_market_purchase_volume: number[];
    individual_discharging_volume: number[];
    individual_grid_export: number[];
    individual_market_sell_volume: number[];
    individual_charging_volume: number[];
    has_pv: boolean[];
}

interface CostMetricsData {
    cost_with_lec: number;
    cost_without_lec: number;
}


interface ProfileData {
    load_profile: number[];
    gen_profile: number[];
}

// --- Interface for Trading Network Data ---
export interface TradingNetworkNode {
    id: string | number; // e.g., 'building_1', 'grid'
}
export interface TradingNetworkLink {
    source: string; // id of source node
    target: string; // id of target node
    value: number; // Amount of energy traded
}
export interface TradingNetworkData {
    edges: TradingNetworkLink[];
    nodes: TradingNetworkNode[];
}

interface SimulationResult {
    energy_metrics: EnergyMetricsData;
    market_metrics:MarketMetricsData;
    individual_metrics: IndividualMetricsData;
    cost_metrics: CostMetricsData;
    profiles: ProfileData;
    trading_network: TradingNetworkData;
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

    const t = useTranslation().t;

    return (
        <div className="result-selector-container">
            <label htmlFor="result-select">{t('results.selectorLabel')}</label>
            <select
                id="result-select"
                value={selectedIndex ?? ''}
                onChange={handleSelectionChange}
            >
                {history.map((entry, index) => {
                    const timestampStr = entry.index ? ` (${new Date(entry.index).toLocaleTimeString()})` : '';
                    const seasonIcons: { [key: string]: string } = {
                        sum: "☀️",
                        win: "❄️",
                        aut: "🍂",
                        spr: "🌼",
                    };

                    const icon = seasonIcons[entry.params.season] || "❓";

                    return (
                        <option key={index} value={index}>
                            {t('results.simulationNumberPrefix')}{index + 1} | 🏘️ {entry.params.community_size} | {t('form.seasonLabel')} {icon} | {timestampStr}
                        </option>
                    );
                })}
            </select>
            <button
                type="button"
                onClick={() => onSelect(Math.max(0, (selectedIndex ?? 0) - 1))}
                disabled={!history.length || (selectedIndex ?? 0) <= 0}
                aria-label="Previous Result"
            >
                ←
            </button>
            <button
                type="button"
                onClick={() => onSelect(Math.min(history.length - 1, (selectedIndex ?? 0) + 1))}
                disabled={!history.length || (selectedIndex ?? 0) >= history.length - 1}
                aria-label="Next Result"
            >
                →
            </button>
        </div>
    );
};

interface EnergyPieChartProps {
    type: 'production' | 'consumption';
    metrics: EnergyMetricsData | null; // Allow null metrics
}

/** Pie chart component for visualizing energy production allocation or consumption sources. */
const EnergyPieChart: React.FC<EnergyPieChartProps> = ({ type, metrics }) => {

    const t = useTranslation().t;

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
            if (self_consumption_volume > VALUE_TOLERANCE) data.push({ name: `${t('energyPieChart.production.selfConsumed')}`, value: self_consumption_volume, color: PIE_CHART_COLORS.selfConsumed });
            if (total_charging_volume > VALUE_TOLERANCE) data.push({ name: `${t('energyPieChart.production.toBattery')}`, value: total_charging_volume, color: PIE_CHART_COLORS.toBattery });
            if (trading_volume > VALUE_TOLERANCE) data.push({ name: `${t('energyPieChart.production.marketSold')}`, value: trading_volume, color: PIE_CHART_COLORS.toMarket });
            if (total_grid_export > VALUE_TOLERANCE) data.push({ name: `${t('energyPieChart.production.gridExport')}`, value: total_grid_export, color: PIE_CHART_COLORS.toGrid });

        } else { // type === 'consumption'
            if (total_consumption < VALUE_TOLERANCE) return [];
            if (self_consumption_volume > VALUE_TOLERANCE) data.push({ name: `${t('energyPieChart.consumption.fromPV')}`, value: self_consumption_volume, color: PIE_CHART_COLORS.fromPV });
            if (total_discharging_volume > VALUE_TOLERANCE) data.push({ name: `${t('energyPieChart.consumption.fromBattery')}`, value: total_discharging_volume, color: PIE_CHART_COLORS.fromBattery });
            if (trading_volume > VALUE_TOLERANCE) data.push({ name: `${t('energyPieChart.consumption.marketBought')}`, value: trading_volume, color: PIE_CHART_COLORS.fromMarket });
            if (total_grid_import > VALUE_TOLERANCE) data.push({ name: `${t('energyPieChart.consumption.gridImport')}`, value: total_grid_import, color: PIE_CHART_COLORS.fromGrid });
        }

        return data.filter(d => d.value > VALUE_TOLERANCE);

    }, [metrics, type, t]); // Recalculate only when metrics or type change

    const renderCustomizedLabel = useCallback(({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
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
        return <p>{t('energyPieChart.loadingData')}</p>; // Or some placeholder
    }

    if (chartData.length === 0) {
        return <p>{t('energyPieChart.noSignificantData')}</p>;
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
                    isAnimationActive={true} // Explicitly true (usually default)
                    animationDuration={750} // Adjust duration (ms) for desired smoothness (e.g., 500-1000ms)
                    animationEasing="ease-in-out"
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

// REMOVED the old CostComparison component as it's being replaced by CommunityOutcomes

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
        // Use translation key if available, otherwise fallback text
        const { t } = useTranslation();
        return <p>{t('results.loadGenProfile.notAvailable', 'Load and Generation profile data not available.')}</p>;
    }

    return (
        <ResponsiveContainer width="100%" height={PROFILE_CHART_HEIGHT}>
            <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis
                    dataKey="time"
                    domain={[0, 23]}
                    type="number"
                    tickFormatter={(tick) => `${tick}:00`}
                    interval="preserveStartEnd" // Show 0:00 and 23:00
                    ticks={[0, 6, 12, 18, 23]} // Define specific ticks
                />
                <YAxis unit=" kW" width={45} />
                <Tooltip formatter={(value: number) => formatNumber(value, 2)} />
                <Legend verticalAlign="top" height={36} />
                <Line type="monotone" dataKey="load" stroke="#9ca3af" name="Load" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="generation" stroke="#a3e635" name="PV Gen" dot={false} strokeWidth={2} />
            </LineChart>
        </ResponsiveContainer>
    );
};


// --- New Component: CommunityOutcomes ---
interface CommunityOutcomesProps {
    costMetrics: CostMetricsData | null;
    energyMetrics: EnergyMetricsData | null;
    marketMetrics: MarketMetricsData | null;
    communitySize: number;
    season: string;
}

/** Displays key outcomes: savings, autarky, and market activity. */
const CommunityOutcomes: React.FC<CommunityOutcomesProps> = ({ costMetrics, energyMetrics, marketMetrics, communitySize, season }) => {
    const { t } = useTranslation();

    const outcomeData = useMemo(() => {
        // Ensure all necessary data is present and valid
        if (!costMetrics || !energyMetrics || !marketMetrics || communitySize <= 0 ||
            costMetrics.cost_with_lec == null || costMetrics.cost_without_lec == null ||
            energyMetrics.total_consumption == null || energyMetrics.self_consumption_volume == null ||
            energyMetrics.total_discharging_volume == null || energyMetrics.trading_volume == null ||
            energyMetrics.total_production == null || marketMetrics.supply_sold == null ||
            marketMetrics.demand_covered == null) {
            return null;
        }

        const { cost_with_lec, cost_without_lec } = costMetrics;
        const {
            total_consumption,
            total_grid_import,
            total_production,
            total_grid_export,
        } = energyMetrics;
        const {
            supply_sold,
            demand_covered,
        } = marketMetrics;

        // --- Savings Calculation ---
        const avgSavingsChf = cost_without_lec - cost_with_lec;
        const avgSavingsPercent = (Math.abs(cost_without_lec) < VALUE_TOLERANCE)
            ? 0 // Avoid division by zero or near-zero
            : (avgSavingsChf / cost_without_lec) * 100;

        // Clamp savings for visualization scaling (0 to 1), but display actual number
        const savingsScale = Math.max(0, Math.min(1, avgSavingsChf / MAX_SAVINGS_PER_HH));

        // --- Autarky Calculation ---
        const autarkyPercent = (1 - (total_grid_import + total_grid_export) / (total_consumption + total_production)) * 100;

        return {
            avgSavingsChf,
            avgSavingsPercent,
            savingsScale, // Value between 0 and 1 for visualization
            autarkyPercent,
            supply_sold,
            demand_covered
        };

    }, [costMetrics, energyMetrics, communitySize]);

    if (!outcomeData) {
        // Use translation key if available, otherwise fallback text
        return <div className="community-outcomes-loading">{t('results.loadingData', 'Calculating outcomes...')}</div>;
    }

    const {
        avgSavingsChf,
        avgSavingsPercent,
        savingsScale,
        autarkyPercent,
        supply_sold,
        demand_covered
    } = outcomeData;

    // Simple scaling for icon size and opacity based on savings magnitude
    const coinIconSize = 24 + savingsScale * 24; // Scale from 24px up to 48px
    const coinIconOpacity = 0.6 + savingsScale * 0.4; // Scale opacity from 0.6 to 1.0

    const season_placeholder = SEASON_DISPLAY_NAMES[season] || season; // t(`seasons.${season}`, season);

    return (
        <div className="community-outcomes-container">
            {/* 1. Savings Section */}
            <div className="outcome-metric savings-metric">
                <div className="savings-icon-area" title={`${t('results.outcomes.avgSavingsTooltip', 'Average savings per household compared to no LEC')}`}>
                    <FaCoins
                        className="savings-icon"
                        style={{ fontSize: `${coinIconSize}px`, opacity: coinIconOpacity }}
                        aria-hidden="true"
                    />
                    {/* Optional: Add a subtle background glow that scales */}
                    <div className="savings-glow" style={{ transform: `scale(${savingsScale})`, opacity: savingsScale * 0.5 }}></div>
                </div>
                <div className="savings-text-area">
                    <span className="savings-label">
                        {`Savings per Household over one ${season_placeholder} (vs no community)`}
                    </span>
                    <span className="savings-value-chf">
                        {formatNumber(avgSavingsChf, 2)} CHF
                    </span>
                    <span className={`savings-value-percent ${avgSavingsChf >= -VALUE_TOLERANCE ? 'positive' : 'negative'}`}>
                        ({avgSavingsChf >= -VALUE_TOLERANCE ? '' : ''}{formatNumber(avgSavingsPercent, 1)}%)
                    </span>
                </div>
            </div>

            {/* 2. Autarky Section */}
            <div className="outcome-metric autarky-metric" title={t('results.outcomes.autarkyTooltip', 'Percentage of total consumption covered locally (PV, Battery, Market)')}>
                 <span className="autarky-label">{t('results.outcomes.autarkyLabel', 'Community Autarky')}</span>
                <div className="autarky-bar-container">
                    <div className="autarky-bar-background">
                        <div
                            className="autarky-bar-fill"
                            style={{ width: `${autarkyPercent}%` }}
                            role="progressbar"
                            aria-valuenow={autarkyPercent}
                            aria-valuemin="0"
                            aria-valuemax="100"
                        ></div>
                    </div>
                    <span className="autarky-value">{formatNumber(autarkyPercent, 1)}%</span>
                </div>
            </div>

            {/* 3. Market Activity Section */}
            <div className="outcome-metric market-metric" title={t('results.outcomes.marketActivityTooltip', 'Internal market performance metrics')}>
                <span className="market-label">{t('results.outcomes.marketActivityLabel', 'Market Effectiveness')}</span>
                <div className="market-details">
                    <div className="market-consumption-share">
                        <span className="detail-label">{t('results.outcomes.marketConsumptionShareLabel', 'Demand Covered')}:</span>
                        <span className="detail-value">{formatNumber(demand_covered, 1)}%</span>
                    </div>
                    <div className="market-production-share">
                        <span className="detail-label">{t('results.outcomes.marketProductionShareLabel', 'Supply Sold')}:</span>
                        <span className="detail-value">{formatNumber(supply_sold, 1)}%</span>
                    </div>
                </div>
            </div>
        </div>
    );
};


// --- Main Application Component ---
function App() {
    const [resultsHistory, setResultsHistory] = useState<SimulationHistoryEntry[]>([]);
    const [selectedResultIndex, setSelectedResultIndex] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const { t } = useTranslation();
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

    // State and Ref for dynamic graph sizing
    const networkContainerRef = useRef(null);
    const [graphDimensions, setGraphDimensions] = useState({ width: 0, height: 0 });

    const TITLE_APPROX_HEIGHT = 40;

    // Callback to update graph dimensions based on container size
    const updateGraphDimensions = useCallback(() => {
        if (networkContainerRef.current) {
            const element = networkContainerRef.current as HTMLDivElement;
            const styles = window.getComputedStyle(element); // Get computed styles

            const paddingLeft = parseFloat(styles.paddingLeft);
            const paddingRight = parseFloat(styles.paddingRight);
            const paddingTop = parseFloat(styles.paddingTop);
            const paddingBottom = parseFloat(styles.paddingBottom);

            // Basic check for valid padding values
            if (!isNaN(paddingLeft) && !isNaN(paddingRight) && !isNaN(paddingTop) && !isNaN(paddingBottom)) {

                const containerWidth = element.offsetWidth;
                const graphContentWidth = Math.max(0, containerWidth - (paddingLeft + paddingRight));

                const containerHeight = element.offsetHeight;
                // Adjust height calculation considering potential title height
                const graphContentHeight = Math.max(0, containerHeight - (paddingTop + paddingBottom + TITLE_APPROX_HEIGHT));

                const finalWidth = graphContentWidth;
                // Ensure a minimum height for the graph
                const finalHeight = Math.max(150, graphContentHeight);


                // Update state only if dimensions actually changed to prevent infinite loops
                if (graphDimensions.width !== finalWidth || graphDimensions.height !== finalHeight) {
                     setGraphDimensions({ width: finalWidth, height: finalHeight });
                }
            } else {
                // Fallback or warning if padding couldn't be parsed
                 console.warn("Could not parse padding for network container. Using offsetWidth/Height directly.");
                 const fallbackWidth = Math.max(0, element.offsetWidth - 20); // Guess padding
                 const fallbackHeight = Math.max(150, element.offsetHeight - TITLE_APPROX_HEIGHT - 20);
                  if (graphDimensions.width !== fallbackWidth || graphDimensions.height !== fallbackHeight) {
                    setGraphDimensions({ width: fallbackWidth, height: fallbackHeight });
                  }
            }
        }
    }, [graphDimensions.width, graphDimensions.height]); // Dependencies

    useEffect(() => {
        const currentContainer = networkContainerRef.current;

        // Only run if the container exists and we have network data to display
        if (!currentContainer || !currentResult?.trading_network) {
             // If network data disappears, reset dimensions? Or leave as is?
             // Let's reset to avoid showing an old graph in an empty container potentially
             if (graphDimensions.width !== 0 || graphDimensions.height !== 0) {
                setGraphDimensions({ width: 0, height: 0 });
             }
            return;
        }

        // Initial calculation
        updateGraphDimensions();

        // Observe resizing
        const resizeObserver = new ResizeObserver(updateGraphDimensions);
        resizeObserver.observe(currentContainer);

        // Cleanup
        return () => {
            if (currentContainer) {
                resizeObserver.unobserve(currentContainer);
            }
            resizeObserver.disconnect();
        };
    }, [updateGraphDimensions, currentResult?.trading_network]); // Re-run if data or callback changes

    // --- Event Handlers  ---

    const handleResultSelection = useCallback((index: number) => {
        if (index >= 0 && index < resultsHistory.length) {
            const selectedEntry = resultsHistory[index];
            // 1. Update the selected index state
            setSelectedResultIndex(index);
            // 2. Update the params state based on the selected history item
            // Check if params actually changed to avoid unnecessary re-renders
            if (JSON.stringify(params) !== JSON.stringify(selectedEntry.params)) {
                 setParams(selectedEntry.params);
            }
        } else {
            setSelectedResultIndex(null); // Reset if index is invalid
        }
    }, [resultsHistory, params]); // Include params in dependency array

    const handleParamChange = useCallback((key: keyof SimulationParams, value: any) => {
        setParams(prev => ({ ...prev, [key]: value }));
    }, []);

    const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        const numValue = Number(value);
        // Check if the key exists in SimulationParams before updating
        if (!isNaN(numValue) && name in params) {
            handleParamChange(name as keyof SimulationParams, numValue);
        }
    }, [handleParamChange, params]);

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
            // Use requestAnimationFrame to potentially batch updates and improve performance
            requestAnimationFrame(() => {
                // Check if value actually changed before updating state
                 setParams(prev => {
                    if (prev[name] !== roundedPercentage) {
                        return { ...prev, [name]: roundedPercentage };
                    }
                    return prev; // No change
                });
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
    }, [handleParamChange]); // handleParamChange itself is stable due to useCallback

    const handleSubmit = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);
        const currentParams = { ...params }; // Capture params at submission time
        console.log('Submitting simulation params:', currentParams);

        try {
            const response = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify(currentParams) // Use captured params
            });

            const responseBody = await response.text(); // Read body once

            if (!response.ok) {
                let errorMessage = `Error ${response.status}: ${response.statusText}`;
                try {
                    const errorJson = JSON.parse(responseBody);
                    // Handle structured FastAPI errors
                    if (errorJson.detail) {
                        if (Array.isArray(errorJson.detail)) { // Pydantic validation errors
                            errorMessage = errorJson.detail.map((err: any) => `${err.loc.join('.')} - ${err.msg}`).join('; ');
                        } else if (typeof errorJson.detail === 'string'){
                            errorMessage = errorJson.detail; // Simple string error
                        }
                    } else if (errorJson.message) { // Handle other potential error structures
                        errorMessage = errorJson.message;
                    }
                } catch (parseError) {
                    // If parsing fails but body exists, include it
                    if (responseBody) errorMessage += ` - ${responseBody}`;
                }
                console.error("API Error Response:", responseBody); // Log raw response on error
                throw new Error(errorMessage);
            }

            // Try parsing the successful response
            try {
                const data: SimulationResult = JSON.parse(responseBody);
                console.log('Received simulation result:', data);

                // Basic validation of received data structure
                if (!data || !data.cost_metrics || !data.energy_metrics || !data.profiles || !data.individual_metrics || !data.trading_network) {
                    console.error("Incomplete data received:", data);
                    throw new Error(t('errors.incompleteData', 'Received incomplete or invalid data structure from server.'));
                }

                setResultsHistory(prevHistory => {
                    const newEntry: SimulationHistoryEntry = {
                        params: currentParams, // Use the params captured at submission
                        result: data,
                        index: Date.now() // Simple timestamp index
                    }
                    const newHistory = [...prevHistory, newEntry];
                    // Automatically select the newly added result
                    setSelectedResultIndex(newHistory.length - 1);
                    return newHistory;
                });

            } catch (parseError: any) {
                console.error('Failed to parse successful response:', parseError, "Response Body:", responseBody);
                throw new Error(t('errors.parsingError', `Failed to process server response: ${parseError.message}`));
            }

        } catch (error: any) {
            console.error('Simulation request failed:', error);
            // Set user-friendly error message
            setError(error instanceof Error ? error.message : t('errors.unexpected', 'An unexpected error occurred.'));
        } finally {
            setIsLoading(false);
        }
    }, [params, t]); // Depends on params for submission and t for error messages

    // Calculate clip-path percentage for the size slider's visual fill
    const sizeSliderClipPercent = useMemo(() => {
        const range = MAX_COMMUNITY_SIZE - MIN_COMMUNITY_SIZE;
        if (range <= 0) return 0; // Avoid division by zero
        const valuePercent = ((params.community_size - MIN_COMMUNITY_SIZE) / range) * 100;
        return 100 - valuePercent; // Inset from the right
    }, [params.community_size]);

    // --- JSX Structure ---
  return (
        <div className="container">
            <LanguageSwitcher />

            {error && <div className="error">{t('errors.apiErrorPrefix', 'Simulation Error:')} {error}</div>}

            <div className="flex-container">

                {/* --- Input Column --- */}
                <div className="input-column">

                    {/* --- Input Form Section --- */}
                    <form onSubmit={handleSubmit} className="input-form">
                        <div className="form-header">
                            <h2>{t('app.title')}</h2>
                            <p>{t('app.subtitle')}</p>
                             {/* Simple Audio Player */}
                            {explanationAudio && (
                                <div className="audio-player-container">
                                    <audio src={explanationAudio} controls preload="metadata">
                                        {t('app.audioNotSupported', 'Your browser does not support the audio element.')}
                                    </audio>
                                </div>
                            )}
                            <p>{t('app.description')}</p>
                        </div>

                        {/* Community Size Slider */}
                        <div className="form-group">
                            <label htmlFor="community_size">{t('form.communitySizeLabel')}</label>
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
                                {/* Tooltip-like display for current value */}
                                <span id="community-size-value" className="size-slider-value" aria-hidden="true">{params.community_size}</span>
                            </div>
                        </div>

                        {/* Season Selection */}
                        <div className="form-group">
                            <label>{t('form.seasonLabel')}</label>
                            <div className="season-buttons">
                                {Object.entries(SEASON_ICONS).map(([key, IconComponent]) => (
                                    <button
                                        type="button"
                                        key={key}
                                        className={`season-button ${params.season === key ? 'active' : ''}`}
                                        onClick={() => handleParamChange('season', key)}
                                        disabled={isLoading}
                                        aria-pressed={params.season === key}
                                        aria-label={`${t('form.seasonLabel')}: ${t('seasons.'+key, key)}`} // Use translation for season name
                                        title={t('seasons.'+key, key)} // Tooltip
                                    >
                                        <IconComponent aria-hidden="true" />
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Circular Sliders for PV/SD Percentage */}
                        <div className="circles-row">
                            <div className="circle-container">
                                <label id="sd-label">{t('form.smartDevicesLabel')}</label>
                                <div
                                    className={`circle ${isLoading ? 'disabled' : ''}`}
                                    onMouseDown={isLoading ? undefined : (e) => handleCircleSliderInteraction(e, 'sd_percentage')}
                                    role="slider"
                                    aria-valuemin={0} aria-valuemax={100}
                                    aria-valuenow={params.sd_percentage}
                                    aria-labelledby="sd-label"
                                    aria-disabled={isLoading}
                                    tabIndex={isLoading ? -1 : 0} // Make focusable only when enabled
                                >
                                    <svg className="circle-fill" viewBox="0 0 80 80">
                                        <path d={getCircularPath(params.sd_percentage)} />
                                    </svg>
                                    <span>{params.sd_percentage}%</span>
                                </div>
                            </div>
                            <div className="circle-container">
                                <label id="pv-label">{t('form.pvAdoptionLabel')}</label>
                                <div
                                    className={`circle ${isLoading ? 'disabled' : ''}`}
                                    onMouseDown={isLoading ? undefined : (e) => handleCircleSliderInteraction(e, 'pv_percentage')}
                                    role="slider"
                                    aria-valuemin={0} aria-valuemax={100}
                                    aria-valuenow={params.pv_percentage}
                                    aria-labelledby="pv-label"
                                    aria-disabled={isLoading}
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
                                title={params.with_battery ? t('buttons.toggleBatteryAriaLabelOn', 'Disable community battery') : t('buttons.toggleBatteryAriaLabelOff', 'Enable community battery')}
                            >
                                <IoIosBatteryFull aria-hidden="true" /> {/* Updated Icon */}
                                {/* Text removed for cleaner look, state indicated by style */}
                            </button>
                            <button type="submit" className="run-simulation-button" disabled={isLoading}>
                                {isLoading ? t('buttons.simulating', 'Simulating...') : t('buttons.runSimulation', 'Run Simulation')}
                            </button>
                        </div>
                    </form>

                    {/* --- Input Explanation Panel --- */}
                    <section className="input-explanation-panel" aria-labelledby="input-explanation-title">
                        <h3 id="input-explanation-title">{t('form.inputExplanationTitle')}</h3>

                        {/* Explanation Item 1: Community Size */}
                        <div className="explanation-item">
                            <div className="explanation-icon-wrapper">
                                <PiCity className="explanation-icon" aria-hidden="true" />
                            </div>
                            <div>
                                <h4>{t('form.explanationCommunitySizeTitle')}</h4>
                                <p>{t('form.explanationCommunitySizeText')}</p>
                            </div>
                        </div>

                        {/* Explanation Item 2: Season */}
                        <div className="explanation-item">
                            <div className="explanation-icon-wrapper">
                                <BsCloudSun className="explanation-icon" aria-hidden="true" />
                            </div>
                            <div>
                                <h4>{t('form.explanationSeasonTitle')}</h4>
                                <p>{t('form.explanationSeasonText')}</p>
                            </div>
                        </div>

                        {/* Explanation Item 3: PV adoption slider */}
                        <div className="explanation-item">
                            <div className="explanation-icon-wrapper">
                                <PiSolarPanelFill className="explanation-icon" aria-hidden="true" />
                            </div>
                            <div>
                                <h4>{t('form.explanationPVTitle')}</h4>
                                <p>{t('form.explanationPVText')}</p>
                            </div>
                        </div>

                        {/* Explanation Item 4: Smart Device Slider */}
                        <div className="explanation-item">
                            <div className="explanation-icon-wrapper">
                                <GiWashingMachine className="explanation-icon" aria-hidden="true" />
                            </div>
                            <div>
                                <h4>{t('form.explanationSDTitle')}</h4>
                                <p>{t('form.explanationSDText')}</p>
                            </div>
                        </div>

                        {/* Explanation Item 5: Battery */}
                        <div className="explanation-item">
                            <div className="explanation-icon-wrapper">
                                <IoIosBatteryFull className="explanation-icon" aria-hidden="true" />
                            </div>
                            <div>
                                <h4>{t('form.explanationBatteryTitle')}</h4>
                                <p>{t('form.explanationBatteryText')}</p>
                            </div>
                        </div>

                    </section>
                </div> {/* --- End input-column wrapper --- */}

                {/* --- Results Display Section --- */}
                <div className="results-area">

                    <ResultSelector
                        history={resultsHistory}
                        selectedIndex={selectedResultIndex}
                        onSelect={handleResultSelection}
                    />

                    {/* Display selected result or placeholder */}
                    {currentHistoryEntry && currentResult ? (
                        <div className="current-result-display">
                            {/* Grid container for result tabs */}
                            <div className="results-container">

                                 {/* --- Column 1 (or first items in flow) --- */}
                                <div className="result-tab community-outcomes-tab" key="community-outcomes">
                                    <h3>{t('results.resultsContainer.outcomesHeading', 'Outcomes')}</h3>
                                    <CommunityOutcomes
                                        costMetrics={currentResult.cost_metrics}
                                        marketMetrics={currentResult.market_metrics}
                                        energyMetrics={currentResult.energy_metrics}
                                        communitySize={currentHistoryEntry.params.community_size}
                                        season={currentHistoryEntry.params.season}
                                    />
                                </div>

                                <div className="result-tab" key="energy-profile">
                                    <h3>{t('results.resultsContainer.energyProfileHeading')}</h3>
                                    <LoadGenProfile profiles={currentResult.profiles} />
                                </div>

                                {/* Trading Network - Spans across columns potentially or takes significant space */}
                                {currentResult.trading_network && currentResult.trading_network.nodes?.length > 0 ? (
                                    <div
                                        className="result-tab trading-network-tab" // Adjust class if spanning needed
                                        key="trading-network"
                                        ref={networkContainerRef}
                                        style={{ position: 'relative', width: '100%', minHeight: '300px', overflow: 'hidden' }} // Ensure min height
                                    >
                                        <h3>{t('results.resultsContainer.tradingNetworkHeading')}</h3>
                                        {graphDimensions.width > 0 && graphDimensions.height > 0 && currentResult.individual_metrics && ( // Conditional render & check for individual metrics
                                            <TradingNetworkForceGraph
                                                tradingNetwork={currentResult.trading_network}
                                                individualMetrics={currentResult.individual_metrics} // Pass individual metrics
                                                width={graphDimensions.width} // Use dynamic width
                                                height={graphDimensions.height} // Use dynamic height
                                            />
                                        )}
                                        {(graphDimensions.width <= 0 || graphDimensions.height <=0) && <p>{t('results.calculatingLayout', 'Calculating layout...')}</p>}
                                    </div>
                                ) : (
                                    // Optional: Placeholder if no trading network data
                                     <div className="result-tab trading-network-tab placeholder" key="trading-network-placeholder">
                                         <h3>{t('results.resultsContainer.tradingNetworkHeading')}</h3>
                                         <p>{t('results.tradingNetworkNotAvailable', 'Trading network data not available for this simulation.')}</p>
                                     </div>
                                )}


                                {/* Pie Charts */}
                                <div className="result-tab pie-chart-tab" key="consumption-sources">
                                     <h3>{t('results.resultsContainer.consumptionSourcesHeading')}</h3>
                                     <EnergyPieChart type="consumption" metrics={currentResult.energy_metrics} />
                                 </div>

                                <div className="result-tab pie-chart-tab" key="production-allocation">
                                    <h3>{t('results.resultsContainer.productionAllocationHeading')}</h3>
                                    <EnergyPieChart type="production" metrics={currentResult.energy_metrics} />
                                </div>


                                {/* --- Output Explanation Panel (Spanning potentially) --- */}
                                <section className="output-explanation-panel" aria-labelledby="output-explanation-title">
                                    <h3 id="output-explanation-title">{t('results.resultsExplanationTitle')}</h3>
                                    {/* Use the grid container for explanation items */}
                                    <div className="explanation-items-grid">

                                        {/* Explanation for Community Outcomes */}
                                        <div className="explanation-item">
                                            <div className="explanation-icon-wrapper">
                                                <FaCoins className="explanation-icon" aria-hidden="true" />
                                            </div>
                                            <div>
                                                <h4>{t('explanations.outcomesTitle', 'Key Outcomes')}</h4>
                                                <p>{t('explanations.outcomesText', 'Shows average household savings, community self-sufficiency (autarky), and internal market activity.')}</p>
                                            </div>
                                        </div>

                                        <div className="explanation-item">
                                            <div className="explanation-icon-wrapper">
                                                <VscGraphLine className="explanation-icon" aria-hidden="true" />
                                            </div>
                                            <div>
                                                <h4>{t('explanations.dailyEnergyPatternTitle')}</h4>
                                                <p>{t('explanations.dailyEnergyPatternText')}</p>
                                            </div>
                                        </div>

                                        <div className="explanation-item">
                                            <div className="explanation-icon-wrapper">
                                                <PiGraph className="explanation-icon" aria-hidden="true" />
                                            </div>
                                            <div>
                                                <h4>{t('explanations.tradingNetworkTitle')}</h4>
                                                <p>{t('explanations.tradingNetworkText')}</p>
                                            </div>
                                        </div>

                                        <div className="explanation-item">
                                            <div className="explanation-icon-wrapper">
                                                <RiDonutChartFill className="explanation-icon" aria-hidden="true" />
                                            </div>
                                            <div>
                                                <h4>{t('explanations.energyFlowTitle')}</h4>
                                                <p>{t('explanations.energyFlowText')}</p>
                                            </div>
                                        </div>

                                    </div> {/* End .explanation-items-grid */}
                                </section>
                                {/* End output-explanation-panel */}

                                {/* Warnings Tab (Optional) */}
                                {currentResult.warnings && currentResult.warnings.length > 0 && (
                                    <div className="result-tab warnings-tab">
                                        <h3>{t('results.warningsTitle', 'Warnings')}</h3>
                                        <ul>
                                            {currentResult.warnings.map((warning, index) => (<li key={`warn-${index}`}>{warning}</li>))}
                                        </ul>
                                    </div>
                                )}

                                {/* Errors Tab (Optional - might indicate partial success) */}
                                {currentResult.errors && currentResult.errors.length > 0 && (
                                    <div className="result-tab errors-tab">
                                        <h3>{t('results.errorsTitle', 'Errors')}</h3>
                                        <ul>
                                            {currentResult.errors.map((errMsg, index) => (<li key={`err-${index}`}>{errMsg}</li>))}
                                        </ul>
                                    </div>
                                )}
                            </div> {/* End .results-container */}
                        </div> // End .current-result-display
                    ) : (
                        // Show loading state or initial prompt
                        isLoading ? (
                            <div className="loading-indicator">
                                <p>{t('results.loadingResults', 'Loading simulation results...')}</p>
                                {/* Optional: Add a spinner */}
                            </div>
                        ) : (
                            resultsHistory.length === 0 && !error && (
                                <p className="no-results-yet">{t('results.noResultsYet', 'Run a simulation to see the results here.')}</p>
                            )
                            // Handle case where error occurred before any results loaded - Error message displayed above
                        )
                    )}
                </div> {/* End .results-area */}

            </div> {/* End .flex-container */}

            {/* Footer Section */}
            <footer className="footer-banner">
                <img src="/logos/hslu.png" alt={t('footer.hsluAlt')} className="footer-logo" />
                <img src="/logos/lantern.png" alt={t('footer.lanternAlt')} className="footer-logo" />
                <img src="/logos/persist.png" alt={t('footer.persistAlt')} className="footer-logo" />
            </footer>

        </div> // End .container
    );
}

export default App;
