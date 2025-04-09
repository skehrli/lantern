import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import ForceGraph2D, { NodeObject, LinkObject, ForceGraphMethods } from 'react-force-graph-2d';
// import * as d3 from 'd3-force';
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
    source: string | number; // Ensure source/target types match node IDs
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
const BUILDING_ICON_DRAW_SIZE = 12; // Slightly increased icon size
const MIN_LINK_WIDTH = 0.5;
const MAX_LINK_WIDTH = 7;
const VALUE_TOLERANCE = 0.1; // Lower tolerance if needed
const BIDIRECTIONAL_LINK_CURVATURE = 0.25;

// Physics Simulation
// const CHARGE_STRENGTH = -600;
// const LINK_DISTANCE = 90;
// const CENTER_STRENGTH = 0.01;

// Particle Configuration
const MAX_PARTICLES_VISUAL = 20; // Max particles to *show* visually
const MIN_PARTICLES_FOR_NON_ZERO = 1; // Min particles if weight > 0

// --- Helper to create SVG Data URI ---
const createSvgDataUri = (svgString: string): string => {
    const encodedSvg = btoa(unescape(encodeURIComponent(svgString))); // Ensure proper encoding
    return `data:image/svg+xml;base64,${encodedSvg}`;
};

// --- Main Component ---
const TradingNetworkForceGraph: React.FC<TradingNetworkGraphProps> = ({ tradingNetwork, width, height }) => {
    const fgRef = useRef<ForceGraphMethods>();
    const [highlightNodes, setHighlightNodes] = useState<Set<string | number>>(new Set());
    const [highlightLinks, setHighlightLinks] = useState<Set<InternalLinkObject>>(new Set()); // Use InternalLinkObject
    const [hoverNode, setHoverNode] = useState<InternalNodeObject | null>(null);
    const [hoverLink, setHoverLink] = useState<InternalLinkObject | null>(null);
    const [buildingImageNormal, setBuildingImageNormal] = useState<HTMLImageElement | null>(null);
    const [buildingImageHighlight, setBuildingImageHighlight] = useState<HTMLImageElement | null>(null);

    // Effect to pre-render the icon SVG
    useEffect(() => {
        const iconRenderSize = BUILDING_ICON_DRAW_SIZE * 1.5; // Render slightly larger for potential scaling
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


    const graphData = useMemo(() => {
         if (!tradingNetwork?.nodes || !tradingNetwork?.edges || (tradingNetwork.nodes.length === 0 && tradingNetwork.edges.length === 0)) {
            return { nodes: [] as InternalNodeObject[], links: [] as InternalLinkObject[] }; // Ensure types
        }

        // Process Links first to find nodes that actually participate
        const links: InternalLinkObject[] = [];
        const nodesPresentInLinks = new Set<string>(); // Use Set for efficient lookup

        tradingNetwork.edges
            .filter(edge => edge.length === 3 && typeof edge[2] === 'number' && edge[2] > VALUE_TOLERANCE && edge[0] && edge[1])
            .forEach((edgeTuple) => {
                const sourceId = String(edgeTuple[0]);
                const targetId = String(edgeTuple[1]);
                if (sourceId === targetId) return; // Skip self-loops

                links.push({
                    source: sourceId,
                    target: targetId,
                    value: edgeTuple[2],
                    baseColor: LINK_COLOR,
                    curvature: 0 // Initialize curvature
                });
                nodesPresentInLinks.add(sourceId); // Add nodes involved in valid links
                nodesPresentInLinks.add(targetId);
            });

        // Assign Curvature for bidirectional links
        const curvatureAssignedIndices = new Set<number>();
        links.forEach((link, currentIndex) => {
            if (curvatureAssignedIndices.has(currentIndex)) return; // Skip if already processed

            const reverseLinkIndex = links.findIndex(
                (revLink, revIndex) =>
                    revLink.source === link.target && // Direct comparison works if IDs are strings
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

        // Process Nodes, filtering by those present in valid links
        const nodes: InternalNodeObject[] = tradingNetwork.nodes
            .filter(nodeIdStr => nodesPresentInLinks.has(String(nodeIdStr))) // Filter nodes
            .map((nodeIdStr: string) => {
                const id = String(nodeIdStr);
                const baseColor = NODE_COLORS.building;
                const visualSize = BUILDING_ICON_DRAW_SIZE;
                const val = visualSize / 2 + 1; // Physics size slightly larger than half visual
                return { id, baseColor, val, visualSize };
            });

        // Ensure graphData always returns nodes and links arrays
        return { nodes, links };

    }, [tradingNetwork]); // Dependency: raw tradingNetwork data

    const maxLinkValue = useMemo(() => {
        if (!graphData.links || graphData.links.length === 0) return 1;
        return Math.max(...graphData.links.map(l => l.value));
    }, [graphData.links]); // Dependency: the processed links

    const calculateLinkWidth = useCallback((link: InternalLinkObject): number => {
        const scale = Math.max(0, Math.min(1, link.value / maxLinkValue));
        // Ensure width is at least MIN_LINK_WIDTH
        return MIN_LINK_WIDTH + scale * (MAX_LINK_WIDTH - MIN_LINK_WIDTH);
    }, [maxLinkValue]); // Dependency: the calculated maxLinkValue

    const handleNodeHover = useCallback((node: NodeObject | null) => {
        const newHighlightNodes = new Set<string | number>();
        const newHighlightLinks = new Set<InternalLinkObject>(); // Use InternalLinkObject
        const internalNode = node as InternalNodeObject | null;

        if (internalNode) {
            const nodeId = internalNode.id; // ID is already correct type
            newHighlightNodes.add(nodeId);
            graphData.links.forEach((link) => {
                // Direct comparison should work if node IDs and link source/target are same type
                if (link.source === nodeId || link.target === nodeId) {
                    newHighlightLinks.add(link);
                    newHighlightNodes.add(link.source);
                    newHighlightNodes.add(link.target);
                }
            });
        }
        setHoverNode(internalNode);
        setHighlightNodes(newHighlightNodes);
        setHighlightLinks(newHighlightLinks); // Update with Set<InternalLinkObject>
        setHoverLink(null);
    }, [graphData.links]); // Dependency: graphData.links

    const handleLinkHover = useCallback((link: LinkObject | null) => {
        const newHighlightNodes = new Set<string | number>();
        const newHighlightLinks = new Set<InternalLinkObject>(); // Use InternalLinkObject
        const internalLink = link as InternalLinkObject | null;

        if (internalLink) {
            newHighlightLinks.add(internalLink);
            newHighlightNodes.add(internalLink.source);
            newHighlightNodes.add(internalLink.target);
        }
        setHoverLink(internalLink);
        setHighlightNodes(newHighlightNodes);
        setHighlightLinks(newHighlightLinks); // Update with Set<InternalLinkObject>
        setHoverNode(null);
    }, []); // No external dependencies needed here

    /**
     * Custom drawing function using ctx.drawImage for building icons.
     */
    const drawNode = useCallback((node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const internalNode = node as InternalNodeObject;
        const nodeId = internalNode.id;
        const visualSize = internalNode.visualSize;
        const isHighlighted = highlightNodes.has(nodeId);
        const nodeX = internalNode.x ?? 0; // Use nullish coalescing for safety
        const nodeY = internalNode.y ?? 0;

        const imgToDraw = isHighlighted ? buildingImageHighlight : buildingImageNormal;
        if (imgToDraw?.complete && imgToDraw.naturalWidth > 0) {
            ctx.drawImage(
                imgToDraw,
                nodeX - visualSize / 2, // Center the image
                nodeY - visualSize / 2,
                visualSize, // Draw at the node's visualSize
                visualSize
            );
        } else {
             // Fallback or do nothing if image not ready
             // console.warn("Building image not ready for node:", nodeId);
        }

        // --- Draw Node Label (Optional) ---
        // Consider drawing labels only when zoomed in or for highlighted nodes
        const labelThresholdScale = 5; // Adjust scale at which labels appear
        const isHovered = hoverNode?.id === nodeId;
        if (isHighlighted || isHovered || globalScale > labelThresholdScale) {
            const labelYOffset = (visualSize / 2) + 8 / globalScale; // Offset below the node/icon
            const fontSize = Math.max(6, 12 / globalScale); // Dynamic font size
            ctx.font = `${fontSize}px Sans-Serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top'; // Align text baseline to the top, below the node
            ctx.fillStyle = isHighlighted ? NODE_COLORS.highlight : 'rgba(50, 50, 50, 0.9)';
            ctx.fillText(String(nodeId), nodeX, nodeY + labelYOffset);
        }
    }, [highlightNodes, hoverNode, buildingImageNormal, buildingImageHighlight]);

    // Zoom to fit effect
    useEffect(() => {
         if (fgRef.current && graphData.nodes.length > 0) {
            const timer = setTimeout(() => {
                // Adjust padding as needed
                fgRef.current?.zoomToFit(600, 10); // 600ms duration, 60px padding
            }, 500); // Slightly longer delay to allow layout to settle more
            return () => clearTimeout(timer);
        }
    }, [graphData.nodes]); // Depend only on nodes array presence


    // --- Render Logic ---
    if (!buildingImageNormal || !buildingImageHighlight) {
         // Optionally show a loading state until images are ready
         return (
              <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', background: '#f9fafb' }}>
                 <p>Loading assets...</p>
             </div>
         );
    }
    if (graphData.nodes.length === 0 && graphData.links.length === 0 && tradingNetwork) {
         return (
              <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                 <p>No trading data to display (or all trades below tolerance).</p>
             </div>
         );
    }
     if (!tradingNetwork) {
         return (
             <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                 <p>Loading network data...</p>
             </div>
         );
     }


    return (
        <div style={{ position: 'relative', width, height, border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden', background: '#f9fafb' }}>
             <ForceGraph2D
                ref={fgRef}
                graphData={graphData}
                width={width}
                height={height}
                // Node Configuration
                nodeId="id"
                nodeVal="val" // Use 'val' for physics size calculation
                nodeCanvasObject={drawNode}
                nodeCanvasObjectMode={() => "replace"} // Important for custom drawing
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

                    // Use maxLinkValue calculated earlier (guaranteed >= 1)
                    if (w <= 0) { // Handles tolerance filtering implicitly
                        return 0;
                    }

                    const weightProportion = w / maxLinkValue;

                    const calculatedParticles = weightProportion * MAX_PARTICLES_VISUAL;

                    return Math.max(MIN_PARTICLES_FOR_NON_ZERO, Math.round(calculatedParticles));
                }}
                linkDirectionalParticleWidth={3} // Adjust particle size if needed
                linkDirectionalParticleSpeed={0.006} // Adjust particle speed (default is 0.01)
                onLinkHover={handleLinkHover}
                 // Physics & Interaction Configuration
                enableZoomInteraction={true}
                enablePanInteraction={true}
                enableNodeDrag={true}
                cooldownTicks={150} // Adjust as needed
                warmupTicks={50}
                // d3Force={(forceName: string) => {
                //     console.log(`>>> d3Force called for: ${forceName}`);
                //     if (forceName === 'link') return d3.forceLink().id((d: any) => d.id).distance(LINK_DISTANCE); // Use d.id
                //     if (forceName === 'charge') return d3.forceManyBody().strength(CHARGE_STRENGTH);
                //     if (forceName === 'center') return d3.forceCenter().strength(CENTER_STRENGTH);
                // }}

            />
            {/* Tooltip Display */}
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
