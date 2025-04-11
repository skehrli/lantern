import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import ForceGraph2D, { NodeObject, LinkObject, ForceGraphMethods } from 'react-force-graph-2d';
import { FaBuilding } from 'react-icons/fa6';
import ReactDOMServer from 'react-dom/server';
import {IndividualMetricsData, TradingNetworkData} from '../App'; // Adjust the path if necessary

// --- Component Props ---
interface TradingNetworkGraphProps {
    tradingNetwork: TradingNetworkData | null;
    individualMetrics: IndividualMetricsData;
    width: number;
    height: number;
}

interface NodeStats {
    selfconsumption_volume: number | undefined; // Allow undefined
    grid_import: number | undefined;
    market_purchase_volume: number | undefined;
    discharging_volume: number | undefined;
    grid_export: number | undefined;
    market_sell_volume: number | undefined;
    charging_volume: number | undefined;
}

// --- Internal Data Structures ---
interface InternalLinkObject extends LinkObject {
    source: string | number | NodeObject; // Allow NodeObject after stabilization
    target: string | number | NodeObject; // Allow NodeObject after stabilization
    value: number;
    baseColor: string;
    curvature: number;
    // Add index signature if react-force-graph adds properties like __indexColor, etc.
    [key: string]: any; // Allows for properties added by the library
}


interface InternalNodeObject extends NodeObject {
    id: string | number;
    baseColor: string;
    val: number; // Physics size
    visualSize: number; // Drawing size
    fx?: number;
    fy?: number;
    x?: number; // Need x/y for initial layout before fixing
    y?: number;
}

// --- Popup Data Structure ---
interface PopupData {
    nodeId: string | number;
    finalLeft: number; // Current left position (can be updated by dragging)
    finalTop: number;  // Current top position (can be updated by dragging)
    stats: NodeStats;
    name: string;
    popupWidth: number; // Store actual width for bounds check during drag
    popupHeight: number; // Store actual height for bounds check during drag
}

// --- Link Tooltip Data Structure ---
interface LinkTooltipData {
    link: InternalLinkObject;
    x: number; // screen x position relative to container
    y: number; // screen y position relative to container
}

// --- Constants ---
// Visual Styling
const NODE_COLORS = {
    building: 'rgba(59, 130, 246, 0.95)', // Standard blue
};
const LINK_COLOR_BASE = 'rgba(156, 163, 175, 0.4)';
const LINK_COLOR_HIGHLIGHT = '#82ca9d';
const LINK_COLOR_FADED = 'rgba(200, 200, 200, 0.3)';
const LINK_COLOR_OUTGOING = '#82ca9d';
const LINK_COLOR_INCOMING = '#facc15';
const PARTICLE_COLOR_DEFAULT = LINK_COLOR_OUTGOING;
const PARTICLE_COLOR_OUTGOING = PARTICLE_COLOR_DEFAULT;
const PARTICLE_COLOR_INCOMING = LINK_COLOR_INCOMING;
const PARTICLE_COLOR_FADED = LINK_COLOR_FADED;
const PARTICLE_COLOR_HIGHLIGHT = LINK_COLOR_OUTGOING;

const NODE_FADE_OPACITY = 0.3;
const BUILDING_ICON_DRAW_SIZE = 12;
const MIN_LINK_WIDTH = 0.8;
const MAX_LINK_WIDTH = 7;
const VALUE_TOLERANCE = 0.1; // Values below this are treated as zero for display/logic
const BIDIRECTIONAL_LINK_CURVATURE = 0.25;

// Physics & Static Configuration
const INITIAL_WARMUP_TICKS = 20;
const ENGINE_TICKS_BEFORE_FIX = INITIAL_WARMUP_TICKS + 40; // Ticks before fixing node positions

// Particle Configuration
const MAX_PARTICLES_VISUAL = 10;          // Max particles for the link with the highest value
const MIN_PARTICLES_FOR_NON_ZERO = 1;     // Min particles if value > VALUE_TOLERANCE
const PARTICLE_WIDTH_DEFAULT = 4;
const PARTICLE_WIDTH_HIGHLIGHT = 6;
const PARTICLE_MIN_SPEED = 0.003;          // Speed for links with near-zero value
const PARTICLE_MAX_SPEED = 0.01;           // Speed for link with max value

// Interaction Configuration
const ZOOM_TRANSITION_MS = 400;
const ZOOM_OUT_PADDING = 4; // Padding for general zoomToFit (pixels)
const NEIGHBOR_ZOOM_PADDING = 20; // Padding around neighbors box (in graph units)

// Popup Configuration
const POPUP_DELAY_MS = ZOOM_TRANSITION_MS; // Delay opening popup until zoom finishes
const POPUP_BAR_COLORS = {
    selfconsumption_volume: '#a3e635',
    grid_import: '#9ca3af',
    market_purchase_volume: '#facc15',
    discharging_volume: '#65a30d',
    grid_export: '#9ca3af',
    market_sell_volume: '#82ca9d',
    charging_volume: '#65a30d',
};
const POPUP_BAR_HEIGHT = '8px'; // Height of the bars

// --- Popup Placement & Dragging Configuration ---
const POPUP_ESTIMATED_WIDTH = 220; // Estimate for *initial* placement calculation
const POPUP_ESTIMATED_HEIGHT = 180; // Estimate for *initial* placement calculation
const CONTAINER_EDGE_MARGIN = 10; // Minimum space from container edge for popup

// --- Link Tooltip Configuration ---
const LINK_TOOLTIP_OFFSET_X = 10;
const LINK_TOOLTIP_OFFSET_Y = 10;


// --- Helper to create SVG Data URI ---
const createSvgDataUri = (svgString: string): string => {
    // Use btoa for Base64 encoding
    const encodedSvg = btoa(unescape(encodeURIComponent(svgString)));
    return `data:image/svg+xml;base64,${encodedSvg}`;
};

// --- Helper to format link capacity ---
const formatLinkValue = (value: number | undefined | null): string => {
    if (value === undefined || value === null || isNaN(value)) return "N/A";
    return `${value.toFixed(1)} kWh`;
}

// --- Main Component ---
const TradingNetworkForceGraph: React.FC<TradingNetworkGraphProps> = ({ tradingNetwork, individualMetrics, width, height }) => {
    const fgRef = useRef<ForceGraphMethods>();
    const containerRef = useRef<HTMLDivElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);

    const [visibleNodes, setVisibleNodes] = useState<Set<string | number>>(new Set());
    const [highlightLinks, setHighlightLinks] = useState<Set<InternalLinkObject>>(new Set());
    const [clickedNodeId, setClickedNodeId] = useState<string | number | null>(null);

    const [buildingImageNormal, setBuildingImageNormal] = useState<HTMLImageElement | null>(null);

    const [isLayoutPhaseComplete, setIsLayoutPhaseComplete] = useState(false);
    const [internalGraphData, setInternalGraphData] = useState<{ nodes: InternalNodeObject[], links: InternalLinkObject[] }>({ nodes: [], links: [] });
    const fixAppliedRef = useRef(false);
    const engineTicksRef = useRef(0);

    // --- Popup State ---
    const [popupData, setPopupData] = useState<PopupData | null>(null);
    const popupTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const [isDraggingPopup, setIsDraggingPopup] = useState(false);
    const dragStartOffsetRef = useRef({ x: 0, y: 0 });

    // --- Link Hover State ---
    const [hoveredLinkData, setHoveredLinkData] = useState<LinkTooltipData | null>(null);
    const mousePositionRef = useRef<{ x: number; y: number } | null>(null); // Use ref to avoid re-renders on mouse move

    // --- Memoized Calculations ---
    const maxIndividualMetricValue = useMemo(() => {
        let maxVal = 0;
        if (!individualMetrics) return 1;
        const metricCategories = [
            individualMetrics.individual_selfconsumption_volume, individualMetrics.individual_grid_import,
            individualMetrics.individual_market_purchase_volume, individualMetrics.individual_discharging_volume,
            individualMetrics.individual_grid_export, individualMetrics.individual_market_sell_volume,
            individualMetrics.individual_charging_volume,
        ];
        for (const category of metricCategories) {
            if (category) {
                for (const nodeId in category) {
                    const value = category[nodeId];
                    if (typeof value === 'number' && !isNaN(value) && value > maxVal) {
                        maxVal = value;
                    }
                }
            }
        }
        return Math.max(1, maxVal);
    }, [individualMetrics]);

    const maxLinkValue = useMemo(() => {
        if (!internalGraphData.links || internalGraphData.links.length === 0) return 1;
        return Math.max(1, ...internalGraphData.links.map(l => l.value));
    }, [internalGraphData.links]);

    // --- Callbacks ---
    const calculateLinkWidth = useCallback((link: InternalLinkObject): number => {
        if (!maxLinkValue || maxLinkValue <= 0) return MIN_LINK_WIDTH;
        const scale = Math.max(0, Math.min(1, link.value / maxLinkValue));
        return MIN_LINK_WIDTH + scale * (MAX_LINK_WIDTH - MIN_LINK_WIDTH);
    }, [maxLinkValue]);

    const formatStat = (num: number | undefined): string => {
        if (num === undefined || num === null || isNaN(num)) return "N/A";
        return num.toFixed(1) + ' kWh';
    }

    const updateHighlightsAndVisibility = useCallback((node: InternalNodeObject | null) => {
        const newHighlightLinks = new Set<InternalLinkObject>();
        const newVisibleNodes = new Set<string | number>();
        if (node) {
            const nodeId = node.id;
            newVisibleNodes.add(nodeId);
            internalGraphData.links.forEach((link) => {
                const sourceObj = link.source as NodeObject;
                const targetObj = link.target as NodeObject;
                const sourceId = sourceObj?.id ?? link.source;
                const targetId = targetObj?.id ?? link.target;
                if (String(sourceId) === String(nodeId) || String(targetId) === String(nodeId)) {
                    newHighlightLinks.add(link);
                    const neighborId = String(sourceId) === String(nodeId) ? targetId : sourceId;
                    newVisibleNodes.add(String(neighborId));
                }
            });
        }
        setHighlightLinks(newHighlightLinks);
        setVisibleNodes(newVisibleNodes);
    }, [internalGraphData.links]);

    // --- Event Handlers ---

    // Track mouse position within the container
    const handleContainerMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            mousePositionRef.current = {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top
            };
            // Update tooltip position if a link is currently hovered
            setHoveredLinkData(prev => {
                if (prev && mousePositionRef.current) {
                    return { ...prev, x: mousePositionRef.current.x, y: mousePositionRef.current.y };
                }
                return prev;
            });
        }
    }, []); // No dependencies needed

    const handleBackgroundClick = useCallback(() => {
        if (isDraggingPopup) return;
        setClickedNodeId(null);
        setHighlightLinks(new Set());
        setVisibleNodes(new Set());
        setPopupData(null);
        setHoveredLinkData(null); // Clear link tooltip
        if (popupTimeoutRef.current) {
            clearTimeout(popupTimeoutRef.current);
            popupTimeoutRef.current = null;
        }
    }, [isDraggingPopup]);

    const handleNodeClick = useCallback((node: NodeObject | null) => {
        const internalNode = node as InternalNodeObject | null;
        const fg = fgRef.current;

        setHoveredLinkData(null); // Clear link tooltip on node click

        if (popupTimeoutRef.current) clearTimeout(popupTimeoutRef.current);
        setPopupData(null);

        if (internalNode && fg && tradingNetwork?.nodes && individualMetrics && width > 0 && height > 0) {
            const nodeId = internalNode.id;
            if (nodeId === clickedNodeId) {
                handleBackgroundClick(); // This already clears hoveredLinkData
                return;
            }
            setClickedNodeId(nodeId);
            updateHighlightsAndVisibility(internalNode);

            popupTimeoutRef.current = setTimeout(() => {
                 if (!fgRef.current) return;
                 const stats: NodeStats = {
                    selfconsumption_volume: individualMetrics.individual_selfconsumption_volume?.[Number(nodeId)],
                    grid_import: individualMetrics.individual_grid_import?.[Number(nodeId)],
                    market_purchase_volume: individualMetrics.individual_market_purchase_volume?.[Number(nodeId)],
                    discharging_volume: individualMetrics.individual_discharging_volume?.[Number(nodeId)],
                    grid_export: individualMetrics.individual_grid_export?.[Number(nodeId)],
                    market_sell_volume: individualMetrics.individual_market_sell_volume?.[Number(nodeId)],
                    charging_volume: individualMetrics.individual_charging_volume?.[Number(nodeId)],
                 };

                 let finalTop = CONTAINER_EDGE_MARGIN;
                 let finalLeft = CONTAINER_EDGE_MARGIN;

                 setPopupData({
                     nodeId: internalNode.id,
                     finalLeft: finalLeft,
                     finalTop: finalTop,
                     stats: stats,
                     name: `Building ${internalNode.id}`,
                     popupWidth: POPUP_ESTIMATED_WIDTH,
                     popupHeight: POPUP_ESTIMATED_HEIGHT
                 });
                 popupTimeoutRef.current = null;
            }, POPUP_DELAY_MS);
        } else {
             handleBackgroundClick(); // This already clears hoveredLinkData
        }
    }, [clickedNodeId, updateHighlightsAndVisibility, handleBackgroundClick, tradingNetwork?.nodes, individualMetrics, isLayoutPhaseComplete, width, height]);


    // Handle hovering over links
    const handleLinkHover = useCallback((link: LinkObject | null) => {
        if (link && mousePositionRef.current) {
            setHoveredLinkData({
                link: link as InternalLinkObject,
                x: mousePositionRef.current.x,
                y: mousePositionRef.current.y,
            });
        } else {
            setHoveredLinkData(null);
        }
    }, []); // Depends only on setHoveredLinkData


    // --- Popup Drag Handlers ---
    // (These remain unchanged)
    const handlePopupMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (!popupRef.current || !popupData || !containerRef.current) return;
        setIsDraggingPopup(true);
        const popupRect = popupRef.current.getBoundingClientRect();
        const initialClientX = event.clientX;
        const initialClientY = event.clientY;
        dragStartOffsetRef.current = {
            x: initialClientX - popupRect.left,
            y: initialClientY - popupRect.top,
        };
        setPopupData(prev => prev ? { ...prev, popupWidth: popupRect.width, popupHeight: popupRect.height } : null);
        event.preventDefault();
        event.stopPropagation();
    }, [popupData]);

    const handleMouseMove = useCallback((event: MouseEvent) => {
        if (!isDraggingPopup || !popupData || !containerRef.current) return;
        const containerRect = containerRef.current.getBoundingClientRect();
        const currentClientX = event.clientX;
        const currentClientY = event.clientY;
        let newLeft = (currentClientX - containerRect.left) - dragStartOffsetRef.current.x;
        let newTop = (currentClientY - containerRect.top) - dragStartOffsetRef.current.y;
        const maxLeft = width - popupData.popupWidth - CONTAINER_EDGE_MARGIN;
        const maxTop = height - popupData.popupHeight - CONTAINER_EDGE_MARGIN;
        newLeft = Math.max(CONTAINER_EDGE_MARGIN, Math.min(newLeft, maxLeft));
        newTop = Math.max(CONTAINER_EDGE_MARGIN, Math.min(newTop, maxTop));
        setPopupData(prev => prev ? { ...prev, finalLeft: newLeft, finalTop: newTop } : null);
    }, [isDraggingPopup, popupData, width, height]);

    const handleMouseUp = useCallback(() => {
        if (isDraggingPopup) {
            setIsDraggingPopup(false);
        }
    }, [isDraggingPopup]);

    // Effect to add/remove global mouse listeners for dragging
    // (Remains unchanged)
    useEffect(() => {
        if (isDraggingPopup) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        } else {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDraggingPopup, handleMouseMove, handleMouseUp]);

    // --- Helper for Zoom Calculation ---
    // (Remains unchanged)
    const calculateAndApplyZoom = useCallback((nodesToZoom: InternalNodeObject[], centerNode?: InternalNodeObject) => {
        const fg = fgRef.current;
        if (!fg || nodesToZoom.length === 0 || width <= 0 || height <= 0) return;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        let validCoordsFound = false;
        nodesToZoom.forEach(node => {
            if (typeof node.fx === 'number' && typeof node.fy === 'number') {
                minX = Math.min(minX, node.fx);
                maxX = Math.max(maxX, node.fx);
                minY = Math.min(minY, node.fy);
                maxY = Math.max(maxY, node.fy);
                validCoordsFound = true;
            }
        });
        if (validCoordsFound) {
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            const boxWidth = (nodesToZoom.length <= 1 || maxX === minX) ? NEIGHBOR_ZOOM_PADDING * 2 : maxX - minX;
            const boxHeight = (nodesToZoom.length <= 1 || maxY === minY) ? NEIGHBOR_ZOOM_PADDING * 2 : maxY - minY;
            const paddedWidth = boxWidth + 2 * NEIGHBOR_ZOOM_PADDING;
            const paddedHeight = boxHeight + 2 * NEIGHBOR_ZOOM_PADDING;
            const zoomX = width / paddedWidth;
            const zoomY = height / paddedHeight;
            const targetZoom = Math.min(zoomX, zoomY) * 0.95;
            fg.centerAt(centerX, centerY, ZOOM_TRANSITION_MS);
            fg.zoom(targetZoom, ZOOM_TRANSITION_MS);
        } else if (centerNode?.fx != null && centerNode?.fy != null) {
            fg.centerAt(centerNode.fx, centerNode.fy, ZOOM_TRANSITION_MS);
            fg.zoom(1.5, ZOOM_TRANSITION_MS);
        } else {
            fg.zoomToFit(ZOOM_TRANSITION_MS, ZOOM_OUT_PADDING);
        }
    }, [width, height]);


    // --- Engine Tick Handler to Fix Positions ---
    // (Remains largely unchanged, added calculateAndApplyZoom dep)
    const handleEngineTick = useCallback(() => {
        engineTicksRef.current += 1;
        const currentTicks = engineTicksRef.current;
        if (!isLayoutPhaseComplete && !fixAppliedRef.current && currentTicks >= ENGINE_TICKS_BEFORE_FIX && internalGraphData.nodes.length > 0) {
            fixAppliedRef.current = true;
            const currentNodes = internalGraphData.nodes;
            let allNodesHaveCoords = true;
            for (const node of currentNodes) {
                if (typeof node.x !== 'number' || typeof node.y !== 'number') {
                    allNodesHaveCoords = false;
                    fixAppliedRef.current = false;
                    break;
                }
            }
            if (allNodesHaveCoords) {
                setInternalGraphData(prevData => {
                    if (prevData.nodes.length === 0) return prevData;
                    const updatedNodes = prevData.nodes.map(node => ({ ...node, fx: node.x, fy: node.y }));
                    return { ...prevData, nodes: updatedNodes };
                });
                setIsLayoutPhaseComplete(true);
                 if (fgRef.current && clickedNodeId) {
                    const focusedNode = internalGraphData.nodes.find(n => n.id === clickedNodeId);
                    const nodesToConsider = internalGraphData.nodes.filter(n => visibleNodes.has(n.id));
                    if (nodesToConsider.length > 0) {
                        calculateAndApplyZoom(nodesToConsider, focusedNode);
                    } else if (focusedNode?.fx != null && focusedNode?.fy != null) {
                        fgRef.current.centerAt(focusedNode.fx, focusedNode.fy, ZOOM_TRANSITION_MS);
                        fgRef.current.zoom(1.5, ZOOM_TRANSITION_MS);
                    } else {
                        fgRef.current.zoomToFit(ZOOM_TRANSITION_MS, ZOOM_OUT_PADDING);
                    }
                 } else if (fgRef.current) {
                     fgRef.current.zoomToFit(ZOOM_TRANSITION_MS, ZOOM_OUT_PADDING);
                 }
            }
        }
    }, [isLayoutPhaseComplete, internalGraphData.nodes, clickedNodeId, visibleNodes, calculateAndApplyZoom]); // Added calculateAndApplyZoom dependency


    // --- Effect to Handle Zooming on Focus Change (After Layout is Complete) ---
    // (Remains unchanged, added calculateAndApplyZoom dep)
    useEffect(() => {
        const fg = fgRef.current;
        if (!fg || !isLayoutPhaseComplete || width <= 0 || height <= 0) return;
        if (clickedNodeId !== null) {
            const nodesToConsider = internalGraphData.nodes.filter(n => visibleNodes.has(n.id));
            const focusedNode = internalGraphData.nodes.find(n => n.id === clickedNodeId);
            if (nodesToConsider.length > 0) {
                calculateAndApplyZoom(nodesToConsider, focusedNode);
            } else {
                fg.zoomToFit(ZOOM_TRANSITION_MS, ZOOM_OUT_PADDING);
            }
        } else {
            fg.zoomToFit(ZOOM_TRANSITION_MS, ZOOM_OUT_PADDING);
        }
    }, [clickedNodeId, isLayoutPhaseComplete, width, height, calculateAndApplyZoom, internalGraphData.nodes, visibleNodes]); // Added missing dependencies


    // --- Effect to Reset State on Data Change ---
    // (Added clearing for hoveredLinkData)
    useEffect(() => {
        setIsLayoutPhaseComplete(false);
        fixAppliedRef.current = false;
        engineTicksRef.current = 0;
        setClickedNodeId(null);
        setVisibleNodes(new Set());
        setHighlightLinks(new Set());
        setPopupData(null);
        setHoveredLinkData(null); // Clear link tooltip
        if (popupTimeoutRef.current) {
            clearTimeout(popupTimeoutRef.current);
            popupTimeoutRef.current = null;
        }
        if (fgRef.current) {
            fgRef.current.zoomToFit(0, ZOOM_OUT_PADDING);
        }
    }, [tradingNetwork]);

    // --- Effect to Cleanup Popup Timeout ---
    // (Remains unchanged)
    useEffect(() => {
        return () => { if (popupTimeoutRef.current) clearTimeout(popupTimeoutRef.current); };
    }, []);

    // --- Effect to Pre-render Icons ---
    // (Remains unchanged)
    useEffect(() => {
        const iconRenderSize = BUILDING_ICON_DRAW_SIZE * 1.5;
        const svgStringNormal = ReactDOMServer.renderToStaticMarkup( <FaBuilding color={NODE_COLORS.building} size={iconRenderSize} /> );
        let isMounted = true;
        const imgNormal = new Image();
        imgNormal.onload = () => { if (isMounted) setBuildingImageNormal(imgNormal); };
        imgNormal.onerror = () => { console.error("Failed to load normal building icon from SVG data URI"); };
        imgNormal.src = createSvgDataUri(svgStringNormal);
        return () => { isMounted = false; };
    }, []);

    // --- Effect to Process Input Data ---
    // (Remains unchanged)
    useEffect(() => {
        if (!tradingNetwork?.nodes || !tradingNetwork?.edges || (tradingNetwork.nodes.length === 0 && tradingNetwork.edges.length === 0)) {
            setInternalGraphData({ nodes: [], links: [] });
            return;
        }
        const links: InternalLinkObject[] = [];
        const nodesPresentInLinks = new Set<string>();
        tradingNetwork.edges
            .filter(edge => Array.isArray(edge) && edge.length === 3 && typeof edge[2] === 'number' && !isNaN(edge[2]) && edge[2] > VALUE_TOLERANCE && edge[0] != null && edge[1] != null)
            .forEach((edgeTuple) => {
                const sourceId = String(edgeTuple[0]);
                const targetId = String(edgeTuple[1]);
                if (sourceId === targetId) return;
                links.push({ source: sourceId, target: targetId, value: edgeTuple[2], baseColor: LINK_COLOR_BASE, curvature: 0 });
                nodesPresentInLinks.add(sourceId);
                nodesPresentInLinks.add(targetId);
            });
        const curvatureAssignedIndices = new Set<number>();
        links.forEach((link, currentIndex) => {
            if (curvatureAssignedIndices.has(currentIndex)) return;
            const reverseLinkIndex = links.findIndex((revLink, revIndex) => revLink.source === link.target && revLink.target === link.source && !curvatureAssignedIndices.has(revIndex));
            if (reverseLinkIndex !== -1) {
                links[currentIndex].curvature = BIDIRECTIONAL_LINK_CURVATURE;
                links[reverseLinkIndex].curvature = BIDIRECTIONAL_LINK_CURVATURE;
                curvatureAssignedIndices.add(currentIndex);
                curvatureAssignedIndices.add(reverseLinkIndex);
            }
        });
        const nodes: InternalNodeObject[] = tradingNetwork.nodes
            .filter(nodeIdStr => nodesPresentInLinks.has(String(nodeIdStr)))
            .map((nodeIdStr: string | number) => {
                const id = String(nodeIdStr);
                const baseColor = NODE_COLORS.building;
                const visualSize = BUILDING_ICON_DRAW_SIZE;
                const val = visualSize / 2 + 1;
                return { id, baseColor, val, visualSize };
            });
        setInternalGraphData({ nodes, links });
    }, [tradingNetwork]);

    // --- Stat Item Renderer ---
    // (Remains unchanged)
    const renderStatItem = (
        _value: number | undefined | null, key: keyof NodeStats, label: string
    ): JSX.Element | null => {
        const value = _value ?? 0;
        if (Math.abs(value) <= VALUE_TOLERANCE) return null;
        const barWidthPercent = maxIndividualMetricValue > 0 ? Math.min(100, (value / maxIndividualMetricValue) * 100 + 3): 0;
        const formattedValue = formatStat(value);
        const labelColumnWidth = '95px'; // Keep this definition

        return (
            <div
                key={key}
                className="stat-item"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    width: '100%'
                }}
                title={`${label}: ${formattedValue}`}
            >
                <span style={{
                    width: labelColumnWidth,
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    textAlign: 'right',
                    color: '#555',
                    fontSize: '11px',
                    position: 'relative',
                    top: '-7px',
                }}>
                    {label}:
                </span>
                <div
                    className="bar-container"
                    style={{
                        flex: 1,
                        height: POPUP_BAR_HEIGHT,
                        backgroundColor: 'white',
                        borderRadius: '4px',
                        overflow: 'hidden'
                    }}
                    title={formattedValue}
                >
                     <div
                         className="popup-stat-bar"
                         style={{
                             width: `${barWidthPercent}%`,
                             height: '100%',
                             backgroundColor: POPUP_BAR_COLORS[key] || '#bdc3c7',
                             borderRadius: '4px',
                             transition: 'width 0.2s ease-out',
                             display: 'block',
                         }}
                     />
                </div>
            </div>
        );
    };


    // --- Memoized Callbacks for ForceGraph Props ---
    // (Most remain unchanged)
    const nodeCanvasObject = useCallback((node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const internalNode = node as InternalNodeObject;
        const nodeId = internalNode.id;
        const isFullyVisible = !clickedNodeId || visibleNodes.has(nodeId);
        const visualSize = internalNode.visualSize;
        const nodeX = internalNode.x ?? 0;
        const nodeY = internalNode.y ?? 0;
        const originalAlpha = ctx.globalAlpha;
        ctx.globalAlpha = isFullyVisible ? originalAlpha : NODE_FADE_OPACITY;
        const imgToDraw = buildingImageNormal;
        if (imgToDraw?.complete && imgToDraw.naturalWidth > 0) {
            ctx.drawImage(imgToDraw, nodeX - visualSize / 2, nodeY - visualSize / 2, visualSize, visualSize);
        } else {
            ctx.fillStyle = internalNode.baseColor;
            ctx.beginPath();
            ctx.arc(nodeX, nodeY, visualSize / 2, 0, 2 * Math.PI, false);
            ctx.fill();
        }
        ctx.globalAlpha = originalAlpha;
    }, [clickedNodeId, visibleNodes, buildingImageNormal]);

    const memoizedNodeCanvasObjectMode = useCallback(() => "replace" as const, []);

    const memoizedLinkColor = useCallback((linkInput: LinkObject) => {
        const link = linkInput as InternalLinkObject;
        if (!clickedNodeId) return link.baseColor;
        if (!highlightLinks.has(link)) return LINK_COLOR_FADED;
        const sourceId = typeof link.source === 'object' && link.source !== null ? (link.source as NodeObject).id : link.source;
        const targetId = typeof link.target === 'object' && link.target !== null ? (link.target as NodeObject).id : link.target;
        if (String(sourceId) === String(clickedNodeId)) return LINK_COLOR_OUTGOING;
        if (String(targetId) === String(clickedNodeId)) return LINK_COLOR_INCOMING;
        return LINK_COLOR_HIGHLIGHT;
    }, [clickedNodeId, highlightLinks]);

    const memoizedLinkWidth = useCallback((link: LinkObject) => {
        return calculateLinkWidth(link as InternalLinkObject);
    }, [calculateLinkWidth]);

    const memoizedLinkCurvature = useCallback((link: LinkObject) => {
        return (link as InternalLinkObject).curvature || 0;
    }, []);

    const memoizedLinkDirectionalParticles = useCallback((linkInput: LinkObject) => {
        const link = linkInput as InternalLinkObject;
        const w = link.value || 0;
        if (w <= VALUE_TOLERANCE || !maxLinkValue || maxLinkValue <= 0) return 0;
        const weightProportion = w / maxLinkValue;
        const calculatedParticles = weightProportion * MAX_PARTICLES_VISUAL;
        return Math.max(MIN_PARTICLES_FOR_NON_ZERO, Math.round(calculatedParticles));
    }, [maxLinkValue]);

    const memoizedLinkDirectionalParticleWidth = useCallback((linkInput: LinkObject) => {
        const link = linkInput as InternalLinkObject;
        const isHighlighted = clickedNodeId && highlightLinks.has(link);
        return isHighlighted ? PARTICLE_WIDTH_HIGHLIGHT : PARTICLE_WIDTH_DEFAULT;
    }, [clickedNodeId, highlightLinks]);

    const memoizedLinkDirectionalParticleColor = useCallback((linkInput: LinkObject) => {
        if (!clickedNodeId) {
            return PARTICLE_COLOR_DEFAULT;
        }
        const link = linkInput as InternalLinkObject;
        const isHighlighted = clickedNodeId && highlightLinks.has(link);
        if (!isHighlighted) {
             return PARTICLE_COLOR_FADED;
        }
        const sourceId = typeof link.source === 'object' && link.source !== null ? (link.source as NodeObject).id : link.source;
        const targetId = typeof link.target === 'object' && link.target !== null ? (link.target as NodeObject).id : link.target;
        if (String(sourceId) === String(clickedNodeId)) return PARTICLE_COLOR_OUTGOING;
        if (String(targetId) === String(clickedNodeId)) return PARTICLE_COLOR_INCOMING;
        return PARTICLE_COLOR_HIGHLIGHT;
    }, [clickedNodeId, highlightLinks]);

    const memoizedLinkDirectionalParticleSpeed = useCallback((linkInput: LinkObject) => {
        const link = linkInput as InternalLinkObject;
        if (!maxLinkValue || maxLinkValue <= 0 || !link.value || link.value <= VALUE_TOLERANCE) {
            return PARTICLE_MIN_SPEED;
        }
        const proportion = Math.max(0, Math.min(1, link.value / maxLinkValue));
        const speed = PARTICLE_MIN_SPEED + proportion * (PARTICLE_MAX_SPEED - PARTICLE_MIN_SPEED);
        return speed;
    }, [maxLinkValue]);


    // --- Render Logic ---
     if (!buildingImageNormal) return (
        <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', background: '#f9fafb' }}>
            <p>Loading assets...</p>
        </div>
    );
     if (tradingNetwork === null) return (
        <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
            <p>Loading network data...</p>
        </div>
    );
     if (internalGraphData.nodes.length === 0 && internalGraphData.links.length === 0) return (
         <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
             <p>No trading data to display for the selected period.</p>
         </div>
     );

    return (
        // Add onMouseMove to the container
        <div
            ref={containerRef}
            onMouseMove={handleContainerMouseMove} // <-- Add mouse tracking here
            style={{ position: 'relative', width, height, border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', background: '#f9fafb' }}
        >
             <ForceGraph2D
                ref={fgRef}
                graphData={internalGraphData}
                width={width}
                height={height}
                // Node Configuration
                nodeId="id"
                nodeVal="val"
                nodeCanvasObject={nodeCanvasObject}
                nodeCanvasObjectMode={memoizedNodeCanvasObjectMode}
                // Link Configuration
                linkSource="source"
                linkTarget="target"
                linkColor={memoizedLinkColor}
                linkWidth={memoizedLinkWidth}
                linkCurvature={memoizedLinkCurvature}
                // Particle Configuration
                linkDirectionalParticles={memoizedLinkDirectionalParticles}
                linkDirectionalParticleWidth={memoizedLinkDirectionalParticleWidth}
                linkDirectionalParticleColor={memoizedLinkDirectionalParticleColor}
                linkDirectionalParticleSpeed={memoizedLinkDirectionalParticleSpeed}
                 // Physics & Interaction Configuration
                enableZoomInteraction={clickedNodeId !== null}
                enablePanInteraction={clickedNodeId !== null}
                enableNodeDrag={!isLayoutPhaseComplete}
                warmupTicks={INITIAL_WARMUP_TICKS}
                cooldownTicks={Infinity}
                onEngineTick={handleEngineTick}
                // Event Handlers
                onNodeClick={handleNodeClick}
                onBackgroundClick={handleBackgroundClick}
                onLinkHover={handleLinkHover} // <-- Add link hover handler
            />

            {/* --- Draggable Node Popup --- */}
            {/* (Node popup rendering logic remains the same) */}
            {popupData && (
                <div
                    ref={popupRef}
                    className="node-popup"
                    onMouseDown={handlePopupMouseDown}
                    style={{
                        position: 'absolute',
                        left: `${popupData.finalLeft}px`,
                        top: `${popupData.finalTop}px`,
                        pointerEvents: 'auto',
                        zIndex: 10,
                        background: 'rgba(255, 255, 255, 0.97)',
                        padding: '0',
                        borderRadius: '6px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                        fontSize: '12px',
                        color: '#333',
                        minWidth: '200px',
                        maxWidth: '280px',
                        opacity: 0.95,
                        transition: 'opacity 0.2s ease-in-out',
                        cursor: isDraggingPopup ? 'grabbing' : 'default',
                        maxHeight: `calc(100% - ${2 * CONTAINER_EDGE_MARGIN}px)`,
                        overflowY: 'auto',
                        userSelect: 'none'
                    }} >
                     <div className="popup-stats" style={{ display: 'flex', flexDirection: 'column', gap: '0px', padding: '8px 10px 0px 10px' }}>
                         <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '11.5px', color: '#3b82f6' }}>
                             Consumed Energy Sources
                         </div>
                         {renderStatItem(popupData.stats.selfconsumption_volume, 'selfconsumption_volume', 'From Solar')}
                         {renderStatItem(popupData.stats.discharging_volume, 'discharging_volume', 'From Battery')}
                         {renderStatItem(popupData.stats.market_purchase_volume, 'market_purchase_volume', 'From Market')}
                         {renderStatItem(popupData.stats.grid_import, 'grid_import', 'From Grid')}
                        {
                             ( (Math.abs(popupData.stats.selfconsumption_volume ?? 0) > VALUE_TOLERANCE) ||
                               (Math.abs(popupData.stats.discharging_volume ?? 0) > VALUE_TOLERANCE) ||
                               (Math.abs(popupData.stats.market_purchase_volume ?? 0) > VALUE_TOLERANCE) ||
                               (Math.abs(popupData.stats.grid_import ?? 0) > VALUE_TOLERANCE) )
                             &&
                             ( (Math.abs(popupData.stats.charging_volume ?? 0) > VALUE_TOLERANCE) ||
                               (Math.abs(popupData.stats.market_sell_volume ?? 0) > VALUE_TOLERANCE) ||
                               (Math.abs(popupData.stats.grid_export ?? 0) > VALUE_TOLERANCE) )
                             ? <hr style={{ border: 'none', borderTop: '5px solid transparent', margin: '0px 0', width: '100%' }} />
                             : null
                        }
                         <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '11.5px', color: '#3b82f6' }}>
                             Produced Energy Destinations
                         </div>
                         {renderStatItem(popupData.stats.selfconsumption_volume, 'selfconsumption_volume', 'Self-Consumed')}
                         {renderStatItem(popupData.stats.charging_volume, 'charging_volume', 'To Battery')}
                         {renderStatItem(popupData.stats.market_sell_volume, 'market_sell_volume', 'To Market')}
                         {renderStatItem(popupData.stats.grid_export, 'grid_export', 'To Grid')}
                     </div>
                </div>
            )}
            {/* End Node Popup */}

            {/* --- Link Hover Tooltip --- */}
            {hoveredLinkData && (
                <div style={{
                    position: 'absolute',
                    left: `${hoveredLinkData.x + LINK_TOOLTIP_OFFSET_X}px`,
                    top: `${hoveredLinkData.y + LINK_TOOLTIP_OFFSET_Y}px`,
                    background: 'rgba(0, 0, 0, 0.8)', // Dark background
                    color: 'white',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    pointerEvents: 'none', // Important: Prevent tooltip from blocking mouse events
                    zIndex: 20, // Ensure it's above the graph canvas, potentially below node popup if needed
                    whiteSpace: 'nowrap',
                    boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                    // Prevent going off-screen (simple version)
                    transform: `translate(${ (hoveredLinkData.x + 200 > width) ? '-100%' : '0' }, ${ (hoveredLinkData.y + 50 > height) ? '-100%' : '0' })`
                }}>
                    Amount Traded: {formatLinkValue(hoveredLinkData.link.value)}
                </div>
            )}
            {/* End Link Tooltip */}

        </div>
    );
};

export default TradingNetworkForceGraph;
