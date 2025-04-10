import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import ForceGraph2D, { NodeObject, LinkObject, ForceGraphMethods } from 'react-force-graph-2d';
import { FaBuilding } from 'react-icons/fa6';
import ReactDOMServer from 'react-dom/server';

// --- Component Props ---
interface ApiTradingNetworkData {
    nodes: string[];
    edges: [string, string, number][];
}

interface TradingNetworkGraphProps {
    tradingNetwork: ApiTradingNetworkData | null;
    width: number;
    height: number;
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
}

// --- Helper Functions ---
const formatNumber = (num: number | null | undefined, decimals: number = 1): string => {
    // ... (formatNumber remains the same)
    if (num == null || isNaN(num)) { return 'N/A'; }
    const fixedNum = num.toFixed(decimals);
    const parts = fixedNum.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, "'");
    return parts.join('.');
};

// --- Constants ---
// Visual Styling
const NODE_COLORS = {
    building: 'rgba(59, 130, 246, 0.95)', // Standard blue
    labelHighlight: 'rgba(239, 68, 68, 1)', // Red for highlighted labels
    labelDefault: 'rgba(50, 50, 50, 0.9)',
};
const LINK_COLOR_BASE = 'rgba(156, 163, 175, 0.4)';
const LINK_COLOR_HIGHLIGHT = 'rgba(251, 146, 60, 1)'; // Vibrant orange for highlighted links
const LINK_COLOR_FADED = 'rgba(200, 200, 200, 0.2)'; // Very faded grey for non-neighbor links

const PARTICLE_COLOR_DEFAULT = NODE_COLORS.building;
const PARTICLE_COLOR_HIGHLIGHT = LINK_COLOR_HIGHLIGHT;
// Particles on faded links will be hidden by setting count to 0

const NODE_FADE_OPACITY = 0.2; // Opacity for non-neighbor nodes
const BUILDING_ICON_DRAW_SIZE = 12;
const MIN_LINK_WIDTH = 0.7;
const MAX_LINK_WIDTH = 5;
const VALUE_TOLERANCE = 0.1;
const BIDIRECTIONAL_LINK_CURVATURE = 0.25;

// Physics & Static Configuration
const INITIAL_WARMUP_TICKS = 20;
const ENGINE_TICKS_BEFORE_FIX = INITIAL_WARMUP_TICKS + 40;

// Particle Configuration
const MAX_PARTICLES_VISUAL = 15;
const MIN_PARTICLES_FOR_NON_ZERO = 1;
const PARTICLE_WIDTH_DEFAULT = 2;
const PARTICLE_WIDTH_HIGHLIGHT = 3.5;

// Interaction Configuration
const ZOOM_TRANSITION_MS = 500;
const FOCUSED_ZOOM_LEVEL = 2.5;
const ZOOM_OUT_PADDING = 5;

// --- Helper to create SVG Data URI ---
const createSvgDataUri = (svgString: string): string => {
    const encodedSvg = btoa(unescape(encodeURIComponent(svgString)));
    return `data:image/svg+xml;base64,${encodedSvg}`;
};

// --- Main Component ---
const TradingNetworkForceGraph: React.FC<TradingNetworkGraphProps> = ({ tradingNetwork, width, height }) => {
    const fgRef = useRef<ForceGraphMethods>();
    const [visibleNodes, setVisibleNodes] = useState<Set<string | number>>(new Set()); // Nodes to keep fully visible (clicked + neighbors)
    const [highlightLinks, setHighlightLinks] = useState<Set<InternalLinkObject>>(new Set());
    const [hoverNode, setHoverNode] = useState<InternalNodeObject | null>(null);
    const [clickedNodeId, setClickedNodeId] = useState<string | number | null>(null); // Track the *single* clicked node

    const [buildingImageNormal, setBuildingImageNormal] = useState<HTMLImageElement | null>(null);

    // State for layout fixing
    const [isLayoutPhaseComplete, setIsLayoutPhaseComplete] = useState(false);
    const [internalGraphData, setInternalGraphData] = useState<{ nodes: InternalNodeObject[], links: InternalLinkObject[] }>({ nodes: [], links: [] });
    const fixAppliedRef = useRef(false);
    const engineTicksRef = useRef(0);

    // Reset state on data change
    useEffect(() => {
        console.log("TradingNetwork prop received:", tradingNetwork);
        setIsLayoutPhaseComplete(false);
        fixAppliedRef.current = false;
        engineTicksRef.current = 0;
        setClickedNodeId(null);
        setVisibleNodes(new Set()); // Clear visible nodes
        setHighlightLinks(new Set());
        setHoverNode(null);
        console.log("Resetting state for new data.");
    }, [tradingNetwork]);

    // Pre-render icons
    useEffect(() => {
        const iconRenderSize = BUILDING_ICON_DRAW_SIZE * 1.5;
        const svgStringNormal = ReactDOMServer.renderToStaticMarkup(
            <FaBuilding color={NODE_COLORS.building} size={iconRenderSize} />
        );

        let isMounted = true;
        const imgNormal = new Image();

        imgNormal.onload = () => { if (isMounted) setBuildingImageNormal(imgNormal); };
        imgNormal.onerror = () => { console.error("Failed to load normal building icon image"); };
        imgNormal.src = createSvgDataUri(svgStringNormal);

        return () => { isMounted = false; };
    }, []);

    // Process data
    useEffect(() => {
        // ... (data processing logic remains the same)
        if (!tradingNetwork?.nodes || !tradingNetwork?.edges || (tradingNetwork.nodes.length === 0 && tradingNetwork.edges.length === 0)) {
            console.log("No valid data, setting empty graph.");
            setInternalGraphData({ nodes: [], links: [] });
            return;
        }

        console.log("Processing new tradingNetwork prop into internalGraphData...");
        const links: InternalLinkObject[] = [];
        const nodesPresentInLinks = new Set<string>();

        tradingNetwork.edges
            .filter(edge => edge.length === 3 && typeof edge[2] === 'number' && edge[2] > VALUE_TOLERANCE && edge[0] && edge[1])
            .forEach((edgeTuple) => {
                const sourceId = String(edgeTuple[0]);
                const targetId = String(edgeTuple[1]);
                if (sourceId === targetId) return;

                links.push({
                    source: sourceId,
                    target: targetId,
                    value: edgeTuple[2],
                    baseColor: LINK_COLOR_BASE,
                    curvature: 0
                });
                nodesPresentInLinks.add(sourceId);
                nodesPresentInLinks.add(targetId);
            });

        // Apply curvature
        const curvatureAssignedIndices = new Set<number>();
        links.forEach((link, currentIndex) => {
            if (curvatureAssignedIndices.has(currentIndex)) return;
            const reverseLinkIndex = links.findIndex(
                (revLink, revIndex) =>
                    revLink.source === link.target &&
                    revLink.target === link.source &&
                    !curvatureAssignedIndices.has(revIndex)
            );
            if (reverseLinkIndex !== -1) {
                links[currentIndex].curvature = BIDIRECTIONAL_LINK_CURVATURE;
                links[reverseLinkIndex].curvature = BIDIRECTIONAL_LINK_CURVATURE;
                curvatureAssignedIndices.add(currentIndex);
                curvatureAssignedIndices.add(reverseLinkIndex);
            }
        });


        const nodes: InternalNodeObject[] = tradingNetwork.nodes
            .filter(nodeIdStr => nodesPresentInLinks.has(String(nodeIdStr)))
            .map((nodeIdStr: string) => {
                const id = String(nodeIdStr);
                const baseColor = NODE_COLORS.building;
                const visualSize = BUILDING_ICON_DRAW_SIZE;
                const val = visualSize / 2 + 1;
                return { id, baseColor, val, visualSize };
            });

        console.log("Setting new internalGraphData:", { nodes: nodes.length, links: links.length });
        setInternalGraphData({ nodes, links });
    }, [tradingNetwork]);

    const maxLinkValue = useMemo(() => {
        if (!internalGraphData.links || internalGraphData.links.length === 0) return 1;
        return Math.max(1, ...internalGraphData.links.map(l => l.value));
    }, [internalGraphData.links]);

    const calculateLinkWidth = useCallback((link: InternalLinkObject): number => {
        // Don't adjust width based on highlight, keep it consistent
        const scale = Math.max(0, Math.min(1, link.value / maxLinkValue));
        return MIN_LINK_WIDTH + scale * (MAX_LINK_WIDTH - MIN_LINK_WIDTH);
    }, [maxLinkValue]);

    // --- Interaction Handlers ---

    const updateHighlightsAndVisibility = useCallback((node: InternalNodeObject | null) => {
        const newHighlightLinks = new Set<InternalLinkObject>();
        const newVisibleNodes = new Set<string | number>(); // Changed name

        if (node) {
            const nodeId = node.id;
            newVisibleNodes.add(nodeId); // Clicked node is visible
            internalGraphData.links.forEach((link) => {
                const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
                const targetId = typeof link.target === 'object' ? link.target.id : link.target;

                if (sourceId === nodeId || targetId === nodeId) {
                    newHighlightLinks.add(link); // Connected link is highlighted
                    // Add neighbors connected by these links to the visible set
                    newVisibleNodes.add(String(sourceId));
                    newVisibleNodes.add(String(targetId));
                }
            });
        }
        setHighlightLinks(newHighlightLinks);
        setVisibleNodes(newVisibleNodes); // Set the visible nodes state

    }, [internalGraphData.links]);

    // Handle HOVER
    const handleNodeHover = useCallback((node: NodeObject | null) => {
        setHoverNode(node as InternalNodeObject | null);
    }, []);

    // Handle CLICK
    const handleNodeClick = useCallback((node: NodeObject | null) => {
        const internalNode = node as InternalNodeObject | null;
        if (internalNode) {
            // If clicking the *same* node again, treat it as deselect (like background click)
            if (internalNode.id === clickedNodeId) {
                 handleBackgroundClick();
                 return;
            }
            setClickedNodeId(internalNode.id);
            updateHighlightsAndVisibility(internalNode); // Use updated function
            setHoverNode(internalNode);
            console.log("Node clicked, setting focus:", internalNode.id);
        } else {
             handleBackgroundClick();
        }
    }, [clickedNodeId, updateHighlightsAndVisibility]); // Added clickedNodeId dependency

    // Handle background click
    const handleBackgroundClick = useCallback(() => {
        console.log("Background/Deselect clicked, clearing focus.");
        setClickedNodeId(null);
        setHighlightLinks(new Set());
        setVisibleNodes(new Set()); // Clear visible nodes
        setHoverNode(null);
    }, []);

    // --- Node Drawing ---
    const drawNode = useCallback((node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const internalNode = node as InternalNodeObject;
        const nodeId = internalNode.id;
        const isVisible = !clickedNodeId || visibleNodes.has(nodeId); // Is visible if no node is clicked OR if it's in the visible set
        const isLabelHighlighted = clickedNodeId && visibleNodes.has(nodeId); // Label is highlighted only if a node is clicked AND this node is visible
        const isHoveredDirectly = hoverNode?.id === nodeId;

        const visualSize = internalNode.visualSize;
        const nodeX = internalNode.x ?? 0;
        const nodeY = internalNode.y ?? 0;

        // --- Adjust Opacity for Fading ---
        const originalAlpha = ctx.globalAlpha;
        ctx.globalAlpha = isVisible ? originalAlpha : NODE_FADE_OPACITY;

        // --- Draw Node ---
        const imgToDraw = buildingImageNormal;
        if (imgToDraw?.complete && imgToDraw.naturalWidth > 0) {
            ctx.drawImage(
                imgToDraw,
                nodeX - visualSize / 2,
                nodeY - visualSize / 2,
                visualSize,
                visualSize
            );
        } else {
            // Fallback drawing
            ctx.fillStyle = internalNode.baseColor; // Use base color even when faded
            ctx.beginPath();
            ctx.arc(nodeX, nodeY, visualSize / 2, 0, 2 * Math.PI, false);
            ctx.fill();
        }

        // --- Reset Opacity ---
        ctx.globalAlpha = originalAlpha;

        // --- Draw Label ---
        // Show label if it should be highlighted (visible neighbor when node clicked),
        // or if directly hovered, or if zoomed in enough. Don't show labels for faded nodes.
        const labelThresholdScale = 5;
        if (isVisible && (isLabelHighlighted || isHoveredDirectly || globalScale > labelThresholdScale)) {
             const labelYOffset = (visualSize / 2) + 8 / globalScale;
             const fontSize = Math.max(6, 12 / globalScale);
             ctx.font = `${fontSize}px Sans-Serif`;
             ctx.textAlign = 'center';
             ctx.textBaseline = 'top';
             // Use highlight color for label if needed, otherwise default
             ctx.fillStyle = isLabelHighlighted ? NODE_COLORS.labelHighlight : NODE_COLORS.labelDefault;
             ctx.fillText(String(nodeId), nodeX, nodeY + labelYOffset);
        }
    }, [clickedNodeId, visibleNodes, hoverNode, buildingImageNormal]); // Added clickedNodeId, visibleNodes


    // --- Engine Tick Handler to Fix Positions ---
    const handleEngineTick = useCallback(() => {
        // ... (engine tick logic remains the same)
        engineTicksRef.current += 1;
        const currentTicks = engineTicksRef.current;

        if (
            !isLayoutPhaseComplete &&
            !fixAppliedRef.current &&
            currentTicks >= ENGINE_TICKS_BEFORE_FIX &&
            internalGraphData.nodes.length > 0
        ) {
            console.log(`Engine tick ${currentTicks}: Met conditions (>= ${ENGINE_TICKS_BEFORE_FIX}), attempting to fix node positions.`);
            fixAppliedRef.current = true;

            setInternalGraphData(prevData => {
                if (prevData.nodes.length === 0) {
                     console.warn("Attempted to fix positions, but nodes array is empty.");
                    return prevData;
                }
                console.log("Applying fx/fy based on current node positions.");
                const updatedNodes = prevData.nodes.map(node => {
                    if (typeof node.x !== 'number' || typeof node.y !== 'number') {
                         console.warn(`Node ${node.id} has invalid coordinates at fixing time. Skipping fix.`);
                         return node;
                    }
                    return {
                        ...node,
                        fx: node.x,
                        fy: node.y,
                    };
                });
                return { ...prevData, nodes: updatedNodes };
            });
            setIsLayoutPhaseComplete(true);
            console.log("Layout phase marked as complete.");
        }
    }, [isLayoutPhaseComplete, internalGraphData.nodes]);


    // --- Effect to Handle Zooming on Focus Change ---
    useEffect(() => {
        const fg = fgRef.current;
        if (!fg || !isLayoutPhaseComplete) return;

        if (clickedNodeId !== null) {
            const nodeToFocus = internalGraphData.nodes.find(n => n.id === clickedNodeId);
            if (nodeToFocus && typeof nodeToFocus.fx === 'number' && typeof nodeToFocus.fy === 'number') {
                console.log(`Focusing on node ${clickedNodeId} at (${nodeToFocus.fx}, ${nodeToFocus.fy})`);
                fg.centerAt(nodeToFocus.fx, nodeToFocus.fy, ZOOM_TRANSITION_MS);
                fg.zoom(FOCUSED_ZOOM_LEVEL, ZOOM_TRANSITION_MS);
            } else {
                 console.warn(`Could not find node ${clickedNodeId} or its fixed position to focus.`);
            }
        } else {
             // Only zoom out if the layout phase is actually complete
             if (isLayoutPhaseComplete) {
                 console.log("Focus cleared, zooming out to fit.");
                 fg.zoomToFit(ZOOM_TRANSITION_MS, ZOOM_OUT_PADDING);
             }
        }

    }, [clickedNodeId, isLayoutPhaseComplete, internalGraphData.nodes]);


    // --- Render Logic ---
    if (!buildingImageNormal) {
         return (<div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', background: '#f9fafb' }}><p>Loading assets...</p></div>);
    }
     if (tradingNetwork === null) {
        return (<div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px' }}><p>Loading network data...</p></div>);
    }
     if (internalGraphData.nodes.length === 0 && internalGraphData.links.length === 0) {
         return (<div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px' }}><p>No trading data to display (or all trades below tolerance).</p></div>);
    }

    return (
        <div style={{ position: 'relative', width, height, border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', background: '#f9fafb' }}>
             <ForceGraph2D
                ref={fgRef}
                graphData={internalGraphData}
                width={width}
                height={height}
                // Node Configuration
                nodeId="id"
                nodeVal="val"
                nodeCanvasObject={drawNode} // Updated drawNode handles fading
                nodeCanvasObjectMode={() => "replace"}
                onNodeHover={handleNodeHover}
                onNodeClick={handleNodeClick}
                onBackgroundClick={handleBackgroundClick}
                // Link Configuration
                linkSource="source"
                linkTarget="target"
                linkColor={(linkInput: LinkObject) => {
                    const link = linkInput as InternalLinkObject;
                    if (!clickedNodeId) {
                        return link.baseColor; // Default color if nothing clicked
                    }
                    return highlightLinks.has(link)
                        ? LINK_COLOR_HIGHLIGHT // Highlight color for connected links
                        : LINK_COLOR_FADED;    // Faded color for non-connected links
                }}
                linkWidth={link => calculateLinkWidth(link as InternalLinkObject)}
                linkCurvature={(link) => (link as InternalLinkObject).curvature || 0}
                // Particle Configuration
                linkDirectionalParticles={(linkInput: LinkObject) => {
                    const link = linkInput as InternalLinkObject;
                    // No particles on faded links
                    if (clickedNodeId && !highlightLinks.has(link)) {
                        return 0;
                    }
                    // Calculate normally otherwise
                    const w = link.value || 0;
                    if (w <= 0) return 0;
                    const weightProportion = w / maxLinkValue;
                    const calculatedParticles = weightProportion * MAX_PARTICLES_VISUAL;
                    return calculatedParticles > 0 ? Math.max(MIN_PARTICLES_FOR_NON_ZERO, Math.round(calculatedParticles)) : 0;
                }}
                linkDirectionalParticleWidth={(link) => highlightLinks.has(link as InternalLinkObject)
                                                        ? PARTICLE_WIDTH_HIGHLIGHT
                                                        : PARTICLE_WIDTH_DEFAULT
                                                    } // Width applies only if particles > 0
                linkDirectionalParticleColor={(link) => highlightLinks.has(link as InternalLinkObject)
                                                        ? PARTICLE_COLOR_HIGHLIGHT
                                                        : PARTICLE_COLOR_DEFAULT // Color applies only if particles > 0
                                                    }
                linkDirectionalParticleSpeed={0.006}
                 // Physics & Interaction Configuration
                enableZoomInteraction={true}
                enablePanInteraction={true}
                enableNodeDrag={!isLayoutPhaseComplete}
                warmupTicks={INITIAL_WARMUP_TICKS}
                cooldownTicks={Infinity}
                onEngineTick={handleEngineTick}
            />
            {/* Tooltip Display */}
            {hoverNode && (
                 <div style={{
                    position: 'absolute', bottom: '10px', right: '10px',
                    background: 'rgba(40, 40, 40, 0.9)', color: 'white',
                    padding: '8px 12px', borderRadius: '4px', fontSize: '12px',
                    maxWidth: '250px', pointerEvents: 'none',
                    boxShadow: '0 2px 5px rgba(0,0,0,0.3)', zIndex: 10,
                    textAlign: 'right'
                  }}>
                    <div style={{ fontWeight: 'bold' }}>Node: {String(hoverNode.id)}</div>
                </div>
            )}
        </div>
    );
};

export default TradingNetworkForceGraph;
