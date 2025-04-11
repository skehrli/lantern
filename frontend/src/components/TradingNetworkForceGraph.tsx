import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import ForceGraph2D, { NodeObject, LinkObject, ForceGraphMethods } from 'react-force-graph-2d';
import { FaBuilding } from 'react-icons/fa6';
import ReactDOMServer from 'react-dom/server';
import {IndividualMetricsData, TradingNetworkData} from '../App';

// --- Component Props ---
interface TradingNetworkGraphProps {
    tradingNetwork: TradingNetworkData | null;
    individualMetrics: IndividualMetricsData;
    width: number;
    height: number;
}

interface NodeStats {
    selfconsumption_volume: number;
    grid_import: number;
    market_purchase_volume: number;
    discharging_volume: number;
    grid_export: number;
    market_sell_volume: number;
    charging_volume: number;
}

// --- Internal Data Structures ---
interface InternalLinkObject extends LinkObject {
    source: string | number;
    target: string | number;
    value: number;
    baseColor: string;
    curvature: number;
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


// --- Constants ---
// Visual Styling
const NODE_COLORS = {
    building: 'rgba(59, 130, 246, 0.95)', // Standard blue
    labelHighlight: 'rgba(239, 68, 68, 1)', // Red for highlighted labels
    labelDefault: 'rgba(50, 50, 50, 0.9)',
};
const LINK_COLOR_BASE = 'rgba(156, 163, 175, 0.4)';

const LINK_COLOR_HIGHLIGHT = 'rgba(251, 146, 60, 1)'; // Vibrant orange for highlighted links
const LINK_COLOR_FADED = 'rgba(200, 200, 200, 0.3)'; // Very faded grey for non-neighbor links
const LINK_COLOR_OUTGOING = 'rgba(76, 175, 80, 0.75)'; // Muted Green (e.g., Material Green 500)
const LINK_COLOR_INCOMING = 'rgba(211, 47, 47, 0.75)'; // Muted Red (e.g., Material Red 700)
const PARTICLE_COLOR_OUTGOING = LINK_COLOR_OUTGOING;
const PARTICLE_COLOR_INCOMING = LINK_COLOR_INCOMING;

const PARTICLE_COLOR_DEFAULT = NODE_COLORS.building;
const PARTICLE_COLOR_HIGHLIGHT = LINK_COLOR_HIGHLIGHT;

const NODE_FADE_OPACITY = 0.3;
const BUILDING_ICON_DRAW_SIZE = 12;
const MIN_LINK_WIDTH = 0.5;
const MAX_LINK_WIDTH = 5;
const VALUE_TOLERANCE = 0.1;
const BIDIRECTIONAL_LINK_CURVATURE = 0.25;

// Physics & Static Configuration
const INITIAL_WARMUP_TICKS = 20;
const ENGINE_TICKS_BEFORE_FIX = INITIAL_WARMUP_TICKS + 40;

// Particle Configuration
const MAX_PARTICLES_VISUAL = 10;
const MIN_PARTICLES_FOR_NON_ZERO = 1;
const PARTICLE_WIDTH_DEFAULT = 3;
const PARTICLE_WIDTH_HIGHLIGHT = 5;
const PARTICLE_MIN_SPEED = 0.003;
const PARTICLE_MAX_SPEED = 0.01;

// Interaction Configuration
const ZOOM_TRANSITION_MS = 400;
const ZOOM_OUT_PADDING = 4; // Padding for general zoomToFit (pixels)
const NEIGHBOR_ZOOM_PADDING = 20; // Padding around neighbors box (in graph units)


// Popup Configuration
const POPUP_DELAY_MS = ZOOM_TRANSITION_MS;
const POPUP_BAR_COLORS = {
    selfconsumption_volume: '#2ecc71', // Green
    grid_import: '#e74c3c',            // Red
    market_purchase_volume: '#f39c12', // Orange
    discharging_volume: '#3498db',     // Blue
    grid_export: '#c0392b',            // Darker Red
    market_sell_volume: '#d35400',    // Darker Orange
    charging_volume: '#2980b9',       // Darker Blue
};

const POPUP_BAR_HEIGHT = '8px'; // Height of the bars

// --- Popup Placement & Dragging Configuration ---
const POPUP_OFFSET_Y = 15; // Initial desired vertical gap between node and popup
const POPUP_OFFSET_X = 0; // Initial horizontal offset (0 for centering attempt)
const POPUP_ESTIMATED_WIDTH = 220; // Estimate for *initial* placement calculation
const POPUP_ESTIMATED_HEIGHT = 180; // Estimate for *initial* placement calculation
const CONTAINER_EDGE_MARGIN = 10; // Minimum space from container edge for popup


// --- Helper to create SVG Data URI ---
const createSvgDataUri = (svgString: string): string => {
    const encodedSvg = btoa(unescape(encodeURIComponent(svgString)));
    return `data:image/svg+xml;base64,${encodedSvg}`;
};

// --- Main Component ---
const TradingNetworkForceGraph: React.FC<TradingNetworkGraphProps> = ({ tradingNetwork, individualMetrics, width, height }) => {
    const fgRef = useRef<ForceGraphMethods>();
    const containerRef = useRef<HTMLDivElement>(null); // Ref for the main container div
    const popupRef = useRef<HTMLDivElement>(null); // Ref for the popup div itself

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
    const dragStartOffsetRef = useRef({ x: 0, y: 0 }); // Offset between mouse click and popup top-left

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
                    if (typeof value === 'number' && !isNaN(value) && value > maxVal) maxVal = value;
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
        // ... (logic remains the same)
        const newHighlightLinks = new Set<InternalLinkObject>();
        const newVisibleNodes = new Set<string | number>();
        if (node) {
            const nodeId = node.id;
            newVisibleNodes.add(nodeId);
            internalGraphData.links.forEach((link) => {
                const sourceObj = link.source as NodeObject; const targetObj = link.target as NodeObject;
                const sourceId = sourceObj?.id ?? link.source; const targetId = targetObj?.id ?? link.target;
                if (sourceId === nodeId || targetId === nodeId) {
                    newHighlightLinks.add(link);
                    const neighborId = sourceId === nodeId ? targetId : sourceId;
                    newVisibleNodes.add(String(neighborId));
                }
            });
        }
        setHighlightLinks(newHighlightLinks);
        setVisibleNodes(newVisibleNodes);
    }, [internalGraphData.links]);

    const handleBackgroundClick = useCallback(() => {
        if (isDraggingPopup) return; // Don't close popup if dragging started on background somehow
        setClickedNodeId(null);
        setHighlightLinks(new Set());
        setVisibleNodes(new Set());
        setPopupData(null); // Close popup
        if (popupTimeoutRef.current) {
            clearTimeout(popupTimeoutRef.current);
            popupTimeoutRef.current = null;
        }
    }, [isDraggingPopup]);

    const handleNodeClick = useCallback((node: NodeObject | null) => {
        const internalNode = node as InternalNodeObject | null;
        const fg = fgRef.current;

        if (popupTimeoutRef.current) clearTimeout(popupTimeoutRef.current);
        setPopupData(null); // Clear previous popup immediately

        if (internalNode && fg && tradingNetwork?.nodes && individualMetrics && width > 0 && height > 0) {
            const nodeId = internalNode.id;
            if (nodeId === clickedNodeId) {
                handleBackgroundClick();
                return;
            }
            setClickedNodeId(nodeId);
            updateHighlightsAndVisibility(internalNode);

            popupTimeoutRef.current = setTimeout(() => {
                if (!fgRef.current) return;
                const currentFg = fgRef.current;
                const stats: NodeStats = { /* ... fetch stats ... */
                    selfconsumption_volume: individualMetrics.individual_selfconsumption_volume?.[Number(nodeId)],
                    grid_import: individualMetrics.individual_grid_import?.[Number(nodeId)],
                    market_purchase_volume: individualMetrics.individual_market_purchase_volume?.[Number(nodeId)],
                    discharging_volume: individualMetrics.individual_discharging_volume?.[Number(nodeId)],
                    grid_export: individualMetrics.individual_grid_export?.[Number(nodeId)],
                    market_sell_volume: individualMetrics.individual_market_sell_volume?.[Number(nodeId)],
                    charging_volume: individualMetrics.individual_charging_volume?.[Number(nodeId)],
                };

                const nodeX = isLayoutPhaseComplete ? (internalNode.fx ?? internalNode.x ?? 0) : (internalNode.x ?? 0);
                const nodeY = isLayoutPhaseComplete ? (internalNode.fy ?? internalNode.y ?? 0) : (internalNode.y ?? 0);
                const { x: screenX, y: screenY } = currentFg.graph2ScreenCoords(nodeX, nodeY);

                // --- Calculate Initial Popup Position ---
                let finalTop: number, finalLeft: number;
                let idealTop = screenY - POPUP_ESTIMATED_HEIGHT - POPUP_OFFSET_Y;
                if (idealTop < CONTAINER_EDGE_MARGIN || idealTop + POPUP_ESTIMATED_HEIGHT > height - CONTAINER_EDGE_MARGIN) {
                     idealTop = screenY + POPUP_OFFSET_Y;
                     if (idealTop + POPUP_ESTIMATED_HEIGHT > height - CONTAINER_EDGE_MARGIN) {
                         idealTop = height - POPUP_ESTIMATED_HEIGHT - CONTAINER_EDGE_MARGIN;
                         idealTop = Math.max(CONTAINER_EDGE_MARGIN, idealTop);
                     }
                }
                finalTop = idealTop;
                let idealLeft = screenX - (POPUP_ESTIMATED_WIDTH / 2) + POPUP_OFFSET_X;
                if (idealLeft < CONTAINER_EDGE_MARGIN || idealLeft + POPUP_ESTIMATED_WIDTH > width - CONTAINER_EDGE_MARGIN) {
                     idealLeft = Math.max(CONTAINER_EDGE_MARGIN, width - POPUP_ESTIMATED_WIDTH - CONTAINER_EDGE_MARGIN);
                }
                finalLeft = Math.max(CONTAINER_EDGE_MARGIN, idealLeft);

                setPopupData({
                    nodeId: internalNode.id,
                    finalLeft: finalLeft,
                    finalTop: finalTop,
                    stats: stats,
                    name: `Building ${internalNode.id}`,
                    popupWidth: POPUP_ESTIMATED_WIDTH, // Start with estimate
                    popupHeight: POPUP_ESTIMATED_HEIGHT // Start with estimate
                });
                popupTimeoutRef.current = null;
            }, POPUP_DELAY_MS);
        } else {
             handleBackgroundClick();
        }
    }, [clickedNodeId, updateHighlightsAndVisibility, handleBackgroundClick, tradingNetwork?.nodes, individualMetrics, isLayoutPhaseComplete, width, height]);

    // --- Popup Drag Handlers ---
    const handlePopupMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (!popupRef.current || !popupData) return;
        setIsDraggingPopup(true);
        const popupRect = popupRef.current.getBoundingClientRect();
        const containerRect = containerRef.current?.getBoundingClientRect() ?? { top: 0, left: 0 }; // Get container offset

        const initialMouseX = event.clientX - containerRect.left;
        const initialMouseY = event.clientY - containerRect.top;

        // Calculate offset relative to container's top-left
        dragStartOffsetRef.current = {
            x: initialMouseX - popupData.finalLeft,
            y: initialMouseY - popupData.finalTop,
        };

        // Update popup dimensions now that it's rendered
        setPopupData(prev => prev ? { ...prev, popupWidth: popupRect.width, popupHeight: popupRect.height } : null);

        event.preventDefault(); // Prevent text selection during drag
        event.stopPropagation();
    }, [popupData]); // Depend on popupData to access its position

    const handleMouseMove = useCallback((event: MouseEvent) => {
        if (!isDraggingPopup || !popupData || !containerRef.current) return;

        const containerRect = containerRef.current.getBoundingClientRect();

        const mouseX = event.clientX - containerRect.left;
        const mouseY = event.clientY - containerRect.top;

        // Calculate new potential top-left corner by subtracting the initial offset
        let newLeft = mouseX - dragStartOffsetRef.current.x;
        let newTop = mouseY - dragStartOffsetRef.current.y;

        // Clamp position within container bounds
        const maxLeft = width - popupData.popupWidth - CONTAINER_EDGE_MARGIN;
        const maxTop = height - popupData.popupHeight - CONTAINER_EDGE_MARGIN;

        newLeft = Math.max(CONTAINER_EDGE_MARGIN, Math.min(newLeft, maxLeft));
        newTop = Math.max(CONTAINER_EDGE_MARGIN, Math.min(newTop, maxTop));

        // Update state directly for smoother dragging
        setPopupData(prev => prev ? { ...prev, finalLeft: newLeft, finalTop: newTop } : null);

    }, [isDraggingPopup, popupData, width, height]); // Depend on state and dimensions

    const handleMouseUp = useCallback(() => {
        if (isDraggingPopup) {
            setIsDraggingPopup(false);
        }
    }, [isDraggingPopup]);

    // Effect to add/remove global mouse listeners for dragging
    useEffect(() => {
        if (isDraggingPopup) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        } else {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        }

        // Cleanup function
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDraggingPopup, handleMouseMove, handleMouseUp]);


    // --- Node Drawing ---
    const drawNode = useCallback((node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
       // ... (drawing logic remains the same)
        const internalNode = node as InternalNodeObject;
        const nodeId = internalNode.id;
        const isFullyVisible = !clickedNodeId || visibleNodes.has(nodeId);
        const visualSize = internalNode.visualSize;
        const nodeX = internalNode.x ?? 0; const nodeY = internalNode.y ?? 0;
        const originalAlpha = ctx.globalAlpha;
        ctx.globalAlpha = isFullyVisible ? originalAlpha : NODE_FADE_OPACITY;
        const imgToDraw = buildingImageNormal;
        if (imgToDraw?.complete && imgToDraw.naturalWidth > 0) {
            ctx.drawImage(imgToDraw, nodeX - visualSize / 2, nodeY - visualSize / 2, visualSize, visualSize);
        } else { /* Fallback */ ctx.fillStyle = internalNode.baseColor; ctx.beginPath(); ctx.arc(nodeX, nodeY, visualSize / 2, 0, 2 * Math.PI, false); ctx.fill(); }
        ctx.globalAlpha = originalAlpha;
        const labelThresholdScale = 5;
        if (isFullyVisible && (globalScale > labelThresholdScale)) { /* Label drawing */ const baseFontSize = 12; const minFontSize = 6; const fontSize = Math.max(minFontSize, baseFontSize / globalScale); ctx.font = `${fontSize}px Sans-Serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; }
    }, [clickedNodeId, visibleNodes, buildingImageNormal]);


    // --- Engine Tick Handler to Fix Positions ---
    const handleEngineTick = useCallback(() => {
        // ... (logic remains the same)
        engineTicksRef.current += 1; const currentTicks = engineTicksRef.current;
        if (!isLayoutPhaseComplete && !fixAppliedRef.current && currentTicks >= ENGINE_TICKS_BEFORE_FIX && internalGraphData.nodes.length > 0) {
            fixAppliedRef.current = true; const currentNodes = internalGraphData.nodes; let allNodesHaveCoords = true;
            for (const node of currentNodes) { if (typeof node.x !== 'number' || typeof node.y !== 'number') { console.warn(`Node ${node.id} missing coords. Delaying fix.`); allNodesHaveCoords = false; fixAppliedRef.current = false; break; }}
            if (allNodesHaveCoords) {
                setInternalGraphData(prevData => {
                    if (prevData.nodes.length === 0) return prevData;
                    const updatedNodes = prevData.nodes.map(node => ({ ...node, fx: node.x, fy: node.y }));
                    return { ...prevData, nodes: updatedNodes };
                });
                setIsLayoutPhaseComplete(true);
            }
        }
    }, [isLayoutPhaseComplete, internalGraphData.nodes]);


    // --- Effect to Handle Zooming on Focus Change ---
    useEffect(() => {
       // ... (logic remains the same)
       const fg = fgRef.current; if (!fg || !isLayoutPhaseComplete || width <= 0 || height <= 0) return;
       if (clickedNodeId !== null) {
           const nodesToConsider = internalGraphData.nodes.filter(n => visibleNodes.has(n.id));
           if (nodesToConsider.length > 0) {
               let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity; let validCoordsFound = false;
               nodesToConsider.forEach(node => { if (typeof node.fx === 'number' && typeof node.fy === 'number') { minX = Math.min(minX, node.fx); maxX = Math.max(maxX, node.fx); minY = Math.min(minY, node.fy); maxY = Math.max(maxY, node.fy); validCoordsFound = true; } else { console.warn(`Node ${node.id} missing fx/fy for zoom.`); }});
               if (validCoordsFound) {
                   const centerX = (minX + maxX) / 2; const centerY = (minY + maxY) / 2;
                   const boxWidth = (nodesToConsider.length <= 1 || maxX === minX) ? 0 : maxX - minX;
                   const boxHeight = (nodesToConsider.length <= 1 || maxY === minY) ? 0 : maxY - minY;
                   const paddedWidth = Math.max(NEIGHBOR_ZOOM_PADDING * 2, boxWidth + 2 * NEIGHBOR_ZOOM_PADDING);
                   const paddedHeight = Math.max(NEIGHBOR_ZOOM_PADDING * 2, boxHeight + 2 * NEIGHBOR_ZOOM_PADDING);
                   const zoomX = width / paddedWidth; const zoomY = height / paddedHeight;
                   const targetZoom = Math.min(zoomX, zoomY);
                   fg.centerAt(centerX, centerY, ZOOM_TRANSITION_MS); fg.zoom(targetZoom, ZOOM_TRANSITION_MS);
               } else { /* Fallback zoom */ const nodeToFocus = internalGraphData.nodes.find(n => n.id === clickedNodeId); if (nodeToFocus && typeof nodeToFocus.fx === 'number' && typeof nodeToFocus.fy === 'number') { fg.centerAt(nodeToFocus.fx, nodeToFocus.fy, ZOOM_TRANSITION_MS); fg.zoom(1.5, ZOOM_TRANSITION_MS); } else { fg.zoomToFit(ZOOM_TRANSITION_MS, ZOOM_OUT_PADDING); } }
           } else { fg.zoomToFit(ZOOM_TRANSITION_MS, ZOOM_OUT_PADDING); }
       } else { fg.zoomToFit(ZOOM_TRANSITION_MS, ZOOM_OUT_PADDING); }
    }, [clickedNodeId, isLayoutPhaseComplete, internalGraphData.nodes, visibleNodes, width, height]);

    // --- Effect to Reset State on Data Change ---
    useEffect(() => {
        setIsLayoutPhaseComplete(false); fixAppliedRef.current = false; engineTicksRef.current = 0;
        setClickedNodeId(null); setVisibleNodes(new Set()); setHighlightLinks(new Set());
        setPopupData(null); // Close popup on data change
        if (fgRef.current) fgRef.current.zoomToFit(0, ZOOM_OUT_PADDING);
    }, [tradingNetwork]);

    // --- Effect to Cleanup Popup Timeout ---
    useEffect(() => {
        return () => { if (popupTimeoutRef.current) clearTimeout(popupTimeoutRef.current); };
    }, []);

    // --- Effect to Pre-render Icons ---
    useEffect(() => {
        // ... (logic remains the same)
        const iconRenderSize = BUILDING_ICON_DRAW_SIZE * 1.5; const svgStringNormal = ReactDOMServer.renderToStaticMarkup(<FaBuilding color={NODE_COLORS.building} size={iconRenderSize} />); let isMounted = true; const imgNormal = new Image(); imgNormal.onload = () => { if (isMounted) setBuildingImageNormal(imgNormal); }; imgNormal.onerror = () => { console.error("Failed to load normal building icon"); }; imgNormal.src = createSvgDataUri(svgStringNormal); return () => { isMounted = false; };
    }, []);

    // --- Effect to Process Input Data ---
    useEffect(() => {
        // ... (logic remains the same)
        if (!tradingNetwork?.nodes || !tradingNetwork?.edges || (tradingNetwork.nodes.length === 0 && tradingNetwork.edges.length === 0)) { setInternalGraphData({ nodes: [], links: [] }); return; }
        const links: InternalLinkObject[] = []; const nodesPresentInLinks = new Set<string>();
        tradingNetwork.edges.filter(edge => edge.length === 3 && typeof edge[2] === 'number' && edge[2] > VALUE_TOLERANCE && edge[0] && edge[1]).forEach((edgeTuple) => { const sourceId = String(edgeTuple[0]); const targetId = String(edgeTuple[1]); if (sourceId === targetId) return; links.push({ source: sourceId, target: targetId, value: edgeTuple[2], baseColor: LINK_COLOR_BASE, curvature: 0 }); nodesPresentInLinks.add(sourceId); nodesPresentInLinks.add(targetId); });
        const curvatureAssignedIndices = new Set<number>(); links.forEach((link, currentIndex) => { if (curvatureAssignedIndices.has(currentIndex)) return; const reverseLinkIndex = links.findIndex((revLink, revIndex) => revLink.source === link.target && revLink.target === link.source && !curvatureAssignedIndices.has(revIndex)); if (reverseLinkIndex !== -1) { links[currentIndex].curvature = BIDIRECTIONAL_LINK_CURVATURE; links[reverseLinkIndex].curvature = BIDIRECTIONAL_LINK_CURVATURE; curvatureAssignedIndices.add(currentIndex); curvatureAssignedIndices.add(reverseLinkIndex); } });
        const nodes: InternalNodeObject[] = tradingNetwork.nodes.filter(nodeIdStr => nodesPresentInLinks.has(String(nodeIdStr))).map((nodeIdStr: string) => { const id = String(nodeIdStr); const baseColor = NODE_COLORS.building; const visualSize = BUILDING_ICON_DRAW_SIZE; const val = visualSize / 2 + 1; return { id, baseColor, val, visualSize }; });
        setInternalGraphData({ nodes, links });
    }, [tradingNetwork]);

    // --- Stat Item Renderer ---
    const renderStatItem = ( /* ... Same as before ... */
        _value: number | undefined | null, key: keyof NodeStats, label: string
    ): JSX.Element | null => {
        const value = _value ?? 0; if (Math.abs(value) <= VALUE_TOLERANCE) return null;
        const barWidthPercent = maxIndividualMetricValue > 0 ? (Math.abs(value) / maxIndividualMetricValue) * 100 : 0;
        const formattedValue = formatStat(value); const labelColumnWidth = '95px';
        return (
            <div key={key} className="stat-item" style={{ display: 'grid', gridTemplateColumns: `${labelColumnWidth} 1fr`, alignItems: 'center', gap: '8px', width: '100%' }} title={`${label}: ${formattedValue}`}>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right', width: '100%', color: '#555' }}>{label}:</span>
                <div className="bar-container" style={{ height: POPUP_BAR_HEIGHT, backgroundColor: '#e9ecef', borderRadius: '4px', overflow: 'hidden' }} title={formattedValue}>
                    <div className="bar" style={{ width: `${barWidthPercent}%`, height: '100%', backgroundColor: POPUP_BAR_COLORS[key] || '#bdc3c7', borderRadius: '4px', transition: 'width 0.2s ease-out' }} />
                </div>
            </div> );
    };

    // --- Render Logic ---
     if (!buildingImageNormal) return (<div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', background: '#f9fafb' }}><p>Loading assets...</p></div>);
     if (tradingNetwork === null) return (<div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px' }}><p>Loading network data...</p></div>);
     if (internalGraphData.nodes.length === 0 && internalGraphData.links.length === 0) return (<div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px' }}><p>No trading data to display.</p></div>);


    return (
        <div ref={containerRef} // Add ref to the main container
             style={{ position: 'relative', width, height, border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', background: '#f9fafb' }}>
             <ForceGraph2D
                ref={fgRef}
                graphData={internalGraphData}
                width={width}
                height={height}
                // Node Configuration
                nodeId="id" nodeVal="val" nodeCanvasObject={drawNode} nodeCanvasObjectMode={() => "replace"}
                onNodeClick={handleNodeClick}
                onBackgroundClick={handleBackgroundClick} // Use updated handler
                // Link Configuration
                linkSource="source" linkTarget="target"
                linkColor={(linkInput: LinkObject) => { /* ... Link color logic ... */
                    const link = linkInput as InternalLinkObject; if (!clickedNodeId) return link.baseColor; if (!highlightLinks.has(link)) return LINK_COLOR_FADED; const sourceId = typeof link.source === 'object' ? link.source.id : link.source; const targetId = typeof link.target === 'object' ? link.target.id : link.target; if (String(sourceId) === String(clickedNodeId)) return LINK_COLOR_OUTGOING; if (String(targetId) === String(clickedNodeId)) return LINK_COLOR_INCOMING; return LINK_COLOR_HIGHLIGHT;
                }}
                linkWidth={link => calculateLinkWidth(link as InternalLinkObject)}
                linkCurvature={(link) => (link as InternalLinkObject).curvature || 0}
                // Particle Configuration
                linkDirectionalParticles={(linkInput: LinkObject) => { /* ... Particle count logic ... */
                    const link = linkInput as InternalLinkObject; if (clickedNodeId && !highlightLinks.has(link)) return 0; const w = link.value || 0; if (w <= 0 || !maxLinkValue || maxLinkValue <= 0) return 0; const weightProportion = w / maxLinkValue; const calculatedParticles = weightProportion * MAX_PARTICLES_VISUAL; return calculatedParticles > 0 ? Math.max(MIN_PARTICLES_FOR_NON_ZERO, Math.round(calculatedParticles)) : 0;
                 }}
                linkDirectionalParticleWidth={(link) => highlightLinks.has(link as InternalLinkObject) ? PARTICLE_WIDTH_HIGHLIGHT : PARTICLE_WIDTH_DEFAULT }
                linkDirectionalParticleColor={(linkInput: LinkObject) => { /* ... Particle color logic ... */
                    const link = linkInput as InternalLinkObject; if (!clickedNodeId || !highlightLinks.has(link)) { return PARTICLE_COLOR_DEFAULT; } const sourceId = typeof link.source === 'object' ? link.source.id : link.source; const targetId = typeof link.target === 'object' ? link.target.id : link.target; if (String(sourceId) === String(clickedNodeId)) return PARTICLE_COLOR_OUTGOING; if (String(targetId) === String(clickedNodeId)) return PARTICLE_COLOR_INCOMING; return PARTICLE_COLOR_HIGHLIGHT;
                }}
                linkDirectionalParticleSpeed={(linkInput: LinkObject) => { /* ... Particle speed logic ... */
                    const link = linkInput as InternalLinkObject; if (!maxLinkValue || maxLinkValue <= 0 || !link.value || link.value <= 0) { return PARTICLE_MIN_SPEED; } const proportion = Math.max(0, Math.min(1, link.value / maxLinkValue)); const speed = PARTICLE_MIN_SPEED + proportion * (PARTICLE_MAX_SPEED - PARTICLE_MIN_SPEED); return speed;
                 }}
                 // Physics & Interaction Configuration
                enableZoomInteraction={false} // Allow zoom/pan
                enablePanInteraction={false}
                enableNodeDrag={!isLayoutPhaseComplete}
                warmupTicks={INITIAL_WARMUP_TICKS} cooldownTicks={Infinity}
                onEngineTick={handleEngineTick}
            />

            {/* --- Draggable Popup --- */}
            {popupData && (
                <div
                    ref={popupRef} // Add ref to the popup div
                    className="node-popup"
                    style={{
                        position: 'absolute',
                        left: `${popupData.finalLeft}px`,
                        top: `${popupData.finalTop}px`,
                        // pointerEvents: isDraggingPopup ? 'auto' : 'none', // Let events through only when dragging? No, need mousedown
                        pointerEvents: 'auto', // Needs to be auto to receive mousedown
                        zIndex: 10, // Ensure popup is above graph canvas
                        background: 'rgba(255, 255, 255, 0.95)',
                        padding: '0', // Remove padding here, apply to inner content if needed
                        borderRadius: '6px',
                        boxShadow: '0 3px 10px rgba(0,0,0,0.15)',
                        fontSize: '12px',
                        color: '#333',
                        minWidth: '200px',
                        maxWidth: '280px',
                        opacity: 1,
                        // Remove transition on top/left for smoother dragging
                        // transition: 'opacity 0.2s ease-in-out, top 0.1s ease-out, left 0.1s ease-out',
                        transition: 'opacity 0.2s ease-in-out',
                        cursor: isDraggingPopup ? 'grabbing' : 'default', // Indicate draggable state
                        maxHeight: `calc(100% - ${2 * CONTAINER_EDGE_MARGIN}px)`,
                        overflowY: 'auto',
                    }}
                >
                    {/* Drag Handle (the header) */}
                    <h4
                        onMouseDown={handlePopupMouseDown} // Attach mouse down listener here
                        style={{
                            margin: '0', // Reset margin
                            padding: '10px 15px', // Add padding back here
                            fontSize: '14px',
                            fontWeight: '600',
                            borderBottom: '1px solid #eee',
                            textAlign: 'center',
                            cursor: 'move', // Indicate draggable area
                            userSelect: 'none', // Prevent text selection of header
                            backgroundColor: '#f8f9fa', // Slightly different bg for handle (optional)
                            borderTopLeftRadius: '6px', // Match container radius
                            borderTopRightRadius: '6px',
                        }}
                    >
                        {popupData.name}
                    </h4>
                    {/* Popup Content */}
                     <div className="popup-stats" style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px 15px' /* Add padding here */ }}>
                         {/* Render "Source/Input" Stats */}
                         {renderStatItem(popupData.stats.selfconsumption_volume, 'selfconsumption_volume', 'Self-Consumed')}
                         {renderStatItem(popupData.stats.discharging_volume, 'discharging_volume', 'From Battery')}
                         {renderStatItem(popupData.stats.market_purchase_volume, 'market_purchase_volume', 'From Market')}
                         {renderStatItem(popupData.stats.grid_import, 'grid_import', 'From Grid')}

                         {/* --- Divider --- */}
                        {
                             ( (popupData.stats.selfconsumption_volume ?? 0) > VALUE_TOLERANCE ||
                               (popupData.stats.discharging_volume ?? 0) > VALUE_TOLERANCE ||
                               (popupData.stats.market_purchase_volume ?? 0) > VALUE_TOLERANCE ||
                               (popupData.stats.grid_import ?? 0) > VALUE_TOLERANCE )
                             &&
                             ( (popupData.stats.charging_volume ?? 0) > VALUE_TOLERANCE ||
                               (popupData.stats.market_sell_volume ?? 0) > VALUE_TOLERANCE ||
                               (popupData.stats.grid_export ?? 0) > VALUE_TOLERANCE )
                             ? <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '6px 0', width: '100%' }} />
                             : null
                        }

                         {/* Render "Sink/Output" Stats */}
                         {renderStatItem(popupData.stats.charging_volume, 'charging_volume', 'To Battery')}
                         {renderStatItem(popupData.stats.market_sell_volume, 'market_sell_volume', 'To Market')}
                         {renderStatItem(popupData.stats.grid_export, 'grid_export', 'To Grid')}
                     </div>
                </div>
            )}
            {/* End Popup */}
        </div>
    );
};

export default TradingNetworkForceGraph;
