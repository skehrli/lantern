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
    // Add fx and fy for fixed positions after layout
    fx?: number;
    fy?: number;
}

// --- Helper Functions ---
const formatNumber = (num: number | null | undefined, decimals: number = 1): string => {
    if (num == null || isNaN(num)) { return 'N/A'; }
    const fixedNum = num.toFixed(decimals);
    const parts = fixedNum.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, "'");
    return parts.join('.');
};

// --- Constants ---
// Visual Styling
const NODE_COLORS = {
    building: 'rgba(59, 130, 246, 0.95)',
    highlight: 'rgba(239, 68, 68, 1)',
};
const LINK_COLOR = 'rgba(156, 163, 175, 0.5)';
const LINK_HIGHLIGHT_COLOR = 'rgba(239, 68, 68, 0.9)';
const BUILDING_ICON_DRAW_SIZE = 12;
const MIN_LINK_WIDTH = 0.7;
const MAX_LINK_WIDTH = 5;
const VALUE_TOLERANCE = 0.1;
const BIDIRECTIONAL_LINK_CURVATURE = 0.25;

// Physics & Static Configuration
const INITIAL_WARMUP_TICKS = 20; // Ticks for initial layout before fixing is considered
const ENGINE_TICKS_BEFORE_FIX = INITIAL_WARMUP_TICKS + 40; // Total ticks before fixing (adjust buffer if needed)

// Particle Configuration
const MAX_PARTICLES_VISUAL = 15;
const MIN_PARTICLES_FOR_NON_ZERO = 1;

// --- Helper to create SVG Data URI ---
const createSvgDataUri = (svgString: string): string => {
    const encodedSvg = btoa(unescape(encodeURIComponent(svgString)));
    return `data:image/svg+xml;base64,${encodedSvg}`;
};

// --- Main Component ---
const TradingNetworkForceGraph: React.FC<TradingNetworkGraphProps> = ({ tradingNetwork, width, height }) => {
    const fgRef = useRef<ForceGraphMethods>();
    const [highlightNodes, setHighlightNodes] = useState<Set<string | number>>(new Set());
    const [highlightLinks, setHighlightLinks] = useState<Set<InternalLinkObject>>(new Set());
    const [hoverNode, setHoverNode] = useState<InternalNodeObject | null>(null);
    const [hoverLink, setHoverLink] = useState<InternalLinkObject | null>(null);
    const [buildingImageNormal, setBuildingImageNormal] = useState<HTMLImageElement | null>(null);
    const [buildingImageHighlight, setBuildingImageHighlight] = useState<HTMLImageElement | null>(null);

    // State to track graph readiness and fixing
    const [isLayoutPhaseComplete, setIsLayoutPhaseComplete] = useState(false);
    const [internalGraphData, setInternalGraphData] = useState<{ nodes: InternalNodeObject[], links: InternalLinkObject[] }>({ nodes: [], links: [] });
    const fixAppliedRef = useRef(false); // Ref to track if fix was applied for the current dataset
    const engineTicksRef = useRef(0); // Ref to count engine ticks for the current dataset

    // Log prop changes for debugging
    useEffect(() => {
        console.log("TradingNetwork prop received:", tradingNetwork);
        // Reset state when new data comes in (or data is cleared)
        setIsLayoutPhaseComplete(false);
        fixAppliedRef.current = false; // Reset fix flag
        engineTicksRef.current = 0; // Reset tick count
        console.log("Resetting layout phase and fix flags for new data.");
    }, [tradingNetwork]);

    // Effect to pre-render the icon SVG
    useEffect(() => {
        const iconRenderSize = BUILDING_ICON_DRAW_SIZE * 1.5;
        const svgStringNormal = ReactDOMServer.renderToStaticMarkup(
            <FaBuilding color={NODE_COLORS.building} size={iconRenderSize} />
        );
        const svgStringHighlight = ReactDOMServer.renderToStaticMarkup(
            <FaBuilding color={NODE_COLORS.highlight} size={iconRenderSize} />
        );

        let isMounted = true;
        const imgNormal = new Image();
        const imgHighlight = new Image();

        imgNormal.onload = () => { if (isMounted) setBuildingImageNormal(imgNormal); };
        imgNormal.onerror = () => { console.error("Failed to load normal building icon image"); };
        imgNormal.src = createSvgDataUri(svgStringNormal);

        imgHighlight.onload = () => { if (isMounted) setBuildingImageHighlight(imgHighlight); };
        imgHighlight.onerror = () => { console.error("Failed to load highlight building icon image"); };
        imgHighlight.src = createSvgDataUri(svgStringHighlight);

        return () => { isMounted = false; };
    }, []);


    // Process data when tradingNetwork prop changes
    useEffect(() => {
        // Reset flags happened in the other useEffect [tradingNetwork]

        if (!tradingNetwork?.nodes || !tradingNetwork?.edges || (tradingNetwork.nodes.length === 0 && tradingNetwork.edges.length === 0)) {
            console.log("No valid data, setting empty graph.");
            setInternalGraphData({ nodes: [], links: [] });
            // Resetting state is handled by the other effect
            return; // Exit early
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
                    baseColor: LINK_COLOR,
                    curvature: 0
                });
                nodesPresentInLinks.add(sourceId);
                nodesPresentInLinks.add(targetId);
            });

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
                // Initialize WITHOUT fx/fy for new data
                return { id, baseColor, val, visualSize };
            });

        console.log("Setting new internalGraphData:", { nodes: nodes.slice(0, 5), links: links.slice(0, 5) }); // Log sample
        setInternalGraphData({ nodes, links });

    }, [tradingNetwork]); // Depend ONLY on tradingNetwork


    const maxLinkValue = useMemo(() => {
        if (!internalGraphData.links || internalGraphData.links.length === 0) return 1;
        return Math.max(1, ...internalGraphData.links.map(l => l.value)); // Ensure max is at least 1
    }, [internalGraphData.links]); // Depend on internal state

    const calculateLinkWidth = useCallback((link: InternalLinkObject): number => {
        const scale = Math.max(0, Math.min(1, link.value / maxLinkValue));
        return MIN_LINK_WIDTH + scale * (MAX_LINK_WIDTH - MIN_LINK_WIDTH);
    }, [maxLinkValue]); // Depend on derived maxLinkValue


    // --- Hover Logic (no changes needed) ---
    const handleNodeHover = useCallback((node: NodeObject | null) => {
        const newHighlightNodes = new Set<string | number>();
        const newHighlightLinks = new Set<InternalLinkObject>();
        const internalNode = node as InternalNodeObject | null;

        if (internalNode) {
            const nodeId = internalNode.id;
            newHighlightNodes.add(nodeId);
            internalGraphData.links.forEach((link) => {
                if (link.source === nodeId || link.target === nodeId) {
                    newHighlightLinks.add(link);
                    newHighlightNodes.add(String(link.source)); // Ensure string comparison if needed later
                    newHighlightNodes.add(String(link.target));
                }
            });
        }
        setHoverNode(internalNode);
        setHighlightNodes(newHighlightNodes);
        setHighlightLinks(newHighlightLinks);
        setHoverLink(null);
    }, [internalGraphData.links]); // Depend on internal state links

    const handleLinkHover = useCallback((link: LinkObject | null) => {
        const newHighlightNodes = new Set<string | number>();
        const newHighlightLinks = new Set<InternalLinkObject>();
        const internalLink = link as InternalLinkObject | null;

        if (internalLink) {
            newHighlightLinks.add(internalLink);
            newHighlightNodes.add(String(internalLink.source));
            newHighlightNodes.add(String(internalLink.target));
        }
        setHoverLink(internalLink);
        setHighlightNodes(newHighlightNodes);
        setHighlightLinks(newHighlightLinks);
        setHoverNode(null);
    }, []); // No dependencies needed


    // --- Node Drawing (no changes needed) ---
    const drawNode = useCallback((node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const internalNode = node as InternalNodeObject;
        const nodeId = internalNode.id;
        const visualSize = internalNode.visualSize;
        const isHighlighted = highlightNodes.has(nodeId);
        const nodeX = internalNode.x ?? 0;
        const nodeY = internalNode.y ?? 0;

        const imgToDraw = isHighlighted ? buildingImageHighlight : buildingImageNormal;
        if (imgToDraw?.complete && imgToDraw.naturalWidth > 0) {
            ctx.drawImage(
                imgToDraw,
                nodeX - visualSize / 2,
                nodeY - visualSize / 2,
                visualSize,
                visualSize
            );
        }

        const labelThresholdScale = 5;
        const isHovered = hoverNode?.id === nodeId;
        if (isHighlighted || isHovered || globalScale > labelThresholdScale) {
             const labelYOffset = (visualSize / 2) + 8 / globalScale;
             const fontSize = Math.max(6, 12 / globalScale);
             ctx.font = `${fontSize}px Sans-Serif`;
             ctx.textAlign = 'center';
             ctx.textBaseline = 'top';
             ctx.fillStyle = isHighlighted ? NODE_COLORS.highlight : 'rgba(50, 50, 50, 0.9)';
             ctx.fillText(String(nodeId), nodeX, nodeY + labelYOffset);
        }
    }, [highlightNodes, hoverNode, buildingImageNormal, buildingImageHighlight]);


    // --- Engine Tick Handler to Trigger Fixing ---
    const handleEngineTick = useCallback(() => {
        // Increment tick count for the current dataset
        engineTicksRef.current += 1;
        const currentTicks = engineTicksRef.current;

        // Check if conditions are met to fix positions
        if (
            !isLayoutPhaseComplete &&               // Check if layout isn't already marked complete
            !fixAppliedRef.current &&               // Check if fix hasn't been applied for this data yet
            currentTicks >= ENGINE_TICKS_BEFORE_FIX && // Check if enough ticks have passed
            internalGraphData.nodes.length > 0       // Check if there are actually nodes
        ) {
            console.log(`Engine tick ${currentTicks}: Met conditions (>= ${ENGINE_TICKS_BEFORE_FIX}), attempting to fix node positions.`);
            fixAppliedRef.current = true; // Mark that we are attempting the fix *now*

            // Update the state with fixed positions
            // Read the latest x/y directly from the nodes array, which D3 force should have mutated
            setInternalGraphData(prevData => {
                // Safety check in case data was cleared concurrently
                if (prevData.nodes.length === 0) {
                    console.warn("Attempted to fix positions, but nodes array is empty.");
                    return prevData;
                }

                console.log("Applying fx/fy based on current node positions.");
                const updatedNodes = prevData.nodes.map(node => {
                    // Check if coordinates are valid numbers before fixing
                    if (typeof node.x !== 'number' || typeof node.y !== 'number') {
                         console.warn(`Node ${node.id} has invalid coordinates (x: ${node.x}, y: ${node.y}) at fixing time. Skipping fix for this node.`);
                         return node; // Return the node without fx/fy if coords invalid
                    }
                    return {
                        ...node,
                        fx: node.x,
                        fy: node.y,
                    };
                });

                // Log first few nodes after adding fx/fy for confirmation
                // console.log("Sample nodes after adding fx/fy:", updatedNodes.slice(0, 3));

                return { ...prevData, nodes: updatedNodes };
            });

            // Mark the layout phase as complete in React state
            setIsLayoutPhaseComplete(true);
            console.log("Layout phase marked as complete.");

        } else if (!isLayoutPhaseComplete && currentTicks < ENGINE_TICKS_BEFORE_FIX && currentTicks % 50 === 0) {
             // Optional: Log progress during layout phase
             // console.log(`Engine tick ${currentTicks}: Layout phase in progress...`);
        }

    }, [isLayoutPhaseComplete, internalGraphData.nodes]); // Dependencies: phase state and nodes array

    useEffect(() => {
         // Check if the layout phase just completed and we have nodes to zoom to
         if (isLayoutPhaseComplete && fgRef.current && internalGraphData.nodes.length > 0) {
            // Using a small timeout can sometimes help ensure the graph has fully processed
            // the fixed positions before zooming, making it smoother. Optional but often good.
            const timer = setTimeout(() => {
                console.log("Layout fixed. Running zoomToFit...");
                fgRef.current?.zoomToFit(
                    400, // Duration of the zoom animation (ms)
                    15   // Padding around the graph content (pixels)
                );
            }, 50); // Short delay (e.g., 50ms) after fixing is marked complete

            // Cleanup function for the timeout
            return () => clearTimeout(timer);
        }
        // This effect should run specifically when isLayoutPhaseComplete changes to true,
        // assuming there are nodes present.
    }, [isLayoutPhaseComplete, internalGraphData.nodes.length]); // Depend on phase completion and node presence


    // --- Render Logic ---
    if (!buildingImageNormal || !buildingImageHighlight) {
         return (
              <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', background: '#f9fafb' }}>
                 <p>Loading assets...</p>
             </div>
         );
    }
     if (tradingNetwork === null) { // Check if tradingNetwork is still loading
         return (
             <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                 <p>Loading network data...</p>
             </div>
         );
     }
     // Use internalGraphData for the empty check after loading attempt
     if (internalGraphData.nodes.length === 0 && internalGraphData.links.length === 0) {
         return (
              <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                 <p>No trading data to display (or all trades below tolerance).</p>
             </div>
         );
    }

    // console.log("Rendering ForceGraph2D. Is layout complete:", isLayoutPhaseComplete);
    // console.log("Nodes have fx/fy?", internalGraphData.nodes[0]?.hasOwnProperty('fx'));

    return (
        <div style={{ position: 'relative', width, height, border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', background: '#f9fafb' }}>
             <ForceGraph2D
                ref={fgRef}
                graphData={internalGraphData} // Pass the state data
                width={width}
                height={height}
                // Node Configuration
                nodeId="id"
                nodeVal="val"
                nodeCanvasObject={drawNode}
                nodeCanvasObjectMode={() => "replace"}
                onNodeHover={handleNodeHover}
                // Link Configuration
                linkSource="source"
                linkTarget="target"
                linkColor={(link) => highlightLinks.has(link as InternalLinkObject) ? LINK_HIGHLIGHT_COLOR : (link as InternalLinkObject).baseColor}
                linkWidth={link => calculateLinkWidth(link as InternalLinkObject)}
                linkCurvature={(link) => (link as InternalLinkObject).curvature || 0}
                linkDirectionalParticles={(linkInput: LinkObject) => {
                    const link = linkInput as InternalLinkObject;
                    const w = link.value || 0;
                    if (w <= 0) return 0;
                    const weightProportion = w / maxLinkValue;
                    const calculatedParticles = weightProportion * MAX_PARTICLES_VISUAL;
                    // Ensure at least MIN_PARTICLES if value > 0, but round otherwise
                    return calculatedParticles > 0 ? Math.max(MIN_PARTICLES_FOR_NON_ZERO, Math.round(calculatedParticles)) : 0;
                }}
                linkDirectionalParticleWidth={3}
                linkDirectionalParticleSpeed={0.006}
                onLinkHover={handleLinkHover}
                 // Physics & Interaction Configuration
                enableZoomInteraction={false}
                enablePanInteraction={false}
                enableNodeDrag={!isLayoutPhaseComplete} // Disable dragging when static
                warmupTicks={INITIAL_WARMUP_TICKS}      // Initial layout burst
                cooldownTicks={Infinity}               // Keep simulation running for particles
                onEngineTick={handleEngineTick}        // Hook into the simulation ticks
                // onEngineStop={() => console.log("Engine stopped (shouldn't happen with cooldownTicks: Infinity)")} // For debugging if needed
            />
            {/* Tooltip Display (Keep as is) */}
            {(hoverNode || hoverLink) && (
                 <div style={{
                    position: 'absolute', bottom: '10px', right: '10px',
                    background: 'rgba(40, 40, 40, 0.9)', color: 'white',
                    padding: '8px 12px', borderRadius: '4px', fontSize: '12px',
                    maxWidth: '250px', pointerEvents: 'none',
                    boxShadow: '0 2px 5px rgba(0,0,0,0.3)', zIndex: 10,
                    textAlign: 'right'
                 }}>
                   {hoverNode && (
                        <>
                            <div style={{ fontWeight: 'bold' }}>Node: {String(hoverNode.id)}</div>
                        </>
                    )}
                    {hoverLink && !hoverNode && (
                         <>
                             <div style={{ fontWeight: 'bold' }}>Trade</div>
                             <div>From: {String(hoverLink.source)}</div>
                             <div>To: {String(hoverLink.target)}</div>
                             <div>Amount: {formatNumber(hoverLink.value)} kWh</div>
                         </>
                    )}
                </div>
            )}
        </div>
    );
};

export default TradingNetworkForceGraph;
