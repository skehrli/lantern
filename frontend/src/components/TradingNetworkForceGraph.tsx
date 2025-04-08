import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import ForceGraph2D, { NodeObject, LinkObject, ForceGraphMethods } from 'react-force-graph-2d';
import * as d3 from 'd3-force';

// --- Component Props ---
// Describes the expected input data format from the API/parent component
interface ApiTradingNetworkData {
    nodes: string[]; // Array of node IDs
    edges: [string, string, number][]; // Array of [sourceId, targetId, value]
}

interface TradingNetworkGraphProps {
    tradingNetwork: ApiTradingNetworkData | null;
    width: number;
    height: number;
}

// --- Internal Data Structures ---
// Extends the base LinkObject to include properties needed for styling
interface InternalLinkObject extends LinkObject {
    value: number;      // Original trade value
    baseColor: string;
    curvature: number; // Curvature for rendering arcs
}

// Extends the base NodeObject for styling and typing
interface InternalNodeObject extends NodeObject {
    type: 'building' | 'grid';
    baseColor: string;
    val: number; // Size value
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
    building: 'rgba(59, 130, 246, 0.95)', // Blue for buildings
    grid: 'rgba(107, 114, 128, 0.95)',   // Grey for the grid node
    highlight: 'rgba(239, 68, 68, 1)',   // Red for highlighted nodes/links
};
const LINK_COLOR = 'rgba(156, 163, 175, 0.5)'; // Default link color
const LINK_HIGHLIGHT_COLOR = 'rgba(239, 68, 68, 0.9)'; // Highlighted link color
const MIN_NODE_SIZE = 5;
const MAX_NODE_SIZE = 14;
const GRID_NODE_SIZE = 12;
const MIN_LINK_WIDTH = 0.6;
const MAX_LINK_WIDTH = 7;
const VALUE_TOLERANCE = 0.01; // Ignore trades below this value
const LINK_ARROW_LENGTH = 5;
const LINK_ARROW_REL_POS = 1; // Place arrow at the target end
const BIDIRECTIONAL_LINK_CURVATURE = 0.25; // Curvature for paired links

// Physics Simulation
const CHARGE_STRENGTH = -280; // Repulsion force between nodes
const LINK_DISTANCE = 90;     // Preferred distance between linked nodes
const CENTER_STRENGTH = 0.01; // Pull towards the center (weak)
const COLLIDE_PADDING = 2;    // Padding for node collision detection

// --- Main Component ---
const TradingNetworkForceGraph: React.FC<TradingNetworkGraphProps> = ({ tradingNetwork, width, height }) => {
    const fgRef = useRef<ForceGraphMethods>();
    const [highlightNodes, setHighlightNodes] = useState<Set<string | number>>(new Set());
    const [highlightLinks, setHighlightLinks] = useState<Set<LinkObject>>(new Set());
    const [hoverNode, setHoverNode] = useState<InternalNodeObject | null>(null);
    const [hoverLink, setHoverLink] = useState<InternalLinkObject | null>(null);

    /**
     * Memoized processing of raw API data into a format suitable for ForceGraph2D,
     * including calculation of node sizes and link curvatures.
     */
    const graphData = useMemo(() => {
        if (!tradingNetwork?.nodes || !tradingNetwork?.edges || (tradingNetwork.nodes.length === 0 && tradingNetwork.edges.length === 0)) {
            return { nodes: [], links: [] };
        }

        // 1. Process Links: Filter, create objects, and identify pairs for curvature
        const links: InternalLinkObject[] = [];
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
                    curvature: 0, // Initialize curvature
                });
            });

        // 2. Assign Curvature: Assign the same positive curvature to bidirectional pairs
        const curvatureAssignedIndices = new Set<number>();
        links.forEach((link, currentIndex) => {
            if (curvatureAssignedIndices.has(currentIndex)) return; // Skip if already processed

            const sourceId = String(link.source);
            const targetId = String(link.target);

            const reverseLinkIndex = links.findIndex(
                (revLink, revIndex) =>
                    String(revLink.source) === targetId &&
                    String(revLink.target) === sourceId &&
                    !curvatureAssignedIndices.has(revIndex)
            );

            if (reverseLinkIndex !== -1) {
                // Assign the same positive curvature to both links in the pair
                links[currentIndex].curvature = BIDIRECTIONAL_LINK_CURVATURE;
                links[reverseLinkIndex].curvature = BIDIRECTIONAL_LINK_CURVATURE;

                curvatureAssignedIndices.add(currentIndex);
                curvatureAssignedIndices.add(reverseLinkIndex);
            }
        });

        // 3. Process Nodes: Calculate degrees and determine node properties
        const nodeDegrees: Record<string, number> = {};
        links.forEach(link => {
            const sourceId = String(link.source);
            const targetId = String(link.target);
            nodeDegrees[sourceId] = (nodeDegrees[sourceId] || 0) + 1;
            nodeDegrees[targetId] = (nodeDegrees[targetId] || 0) + 1;
        });

        const nodes: InternalNodeObject[] = tradingNetwork.nodes.map((nodeIdStr: string) => {
            const id = String(nodeIdStr);
            const type = id.toLowerCase().includes('grid') ? 'grid' : 'building';
            const baseColor = type === 'grid' ? NODE_COLORS.grid : NODE_COLORS.building;
            const val = type === 'grid'
                ? GRID_NODE_SIZE
                : Math.max(MIN_NODE_SIZE, Math.min(MAX_NODE_SIZE, MIN_NODE_SIZE + (nodeDegrees[id] || 0) * 0.7));
            return { id, type, baseColor, val };
        });

        // 4. Filter Nodes (Optional): Remove nodes that have no links
        const linkedNodeIds = new Set<string>(Object.keys(nodeDegrees));
        const filteredNodes = nodes.filter(node => linkedNodeIds.has(String(node.id)));
        // If you want to display nodes from the input list even if they have no trades, use `nodes` instead of `filteredNodes`.

        return { nodes: filteredNodes, links };

    }, [tradingNetwork]);

    /**
     * Memoized calculation of the maximum link value for scaling link widths linearly.
     */
    const maxLinkValue = useMemo(() => {
        if (!graphData.links || graphData.links.length === 0) return 1;
        // Ensure the minimum value considered is 1 to avoid division issues with very small values
        return Math.max(...graphData.links.map(l => l.value), 1);
    }, [graphData.links]);

    /**
     * Calculates the visual width of a link based on its value, scaled linearly.
     */
    const calculateLinkWidth = useCallback((link: InternalLinkObject): number => {
        // Prevent division by zero or negative scale if maxLinkValue is somehow non-positive
        if (maxLinkValue <= 0) return MIN_LINK_WIDTH;

        const scale = Math.max(0, Math.min(1, link.value / maxLinkValue));
        // Ensure a minimum visible width even for very small values (but larger than 0)
        return Math.max(0.1, MIN_LINK_WIDTH + scale * (MAX_LINK_WIDTH - MIN_LINK_WIDTH));
    }, [maxLinkValue]);

    /**
     * Handles node hover events to highlight the node and its connected links/neighbors.
     */
    const handleNodeHover = useCallback((node: NodeObject | null) => {
        const newHighlightNodes = new Set<string | number>();
        const newHighlightLinks = new Set<LinkObject>();
        const internalNode = node as InternalNodeObject | null;

        if (internalNode) {
            const nodeId = String(internalNode.id);
            newHighlightNodes.add(nodeId);
            graphData.links.forEach((link) => {
                const sourceId = String(link.source);
                const targetId = String(link.target);
                if (sourceId === nodeId || targetId === nodeId) {
                    newHighlightLinks.add(link);
                    newHighlightNodes.add(sourceId);
                    newHighlightNodes.add(targetId);
                }
            });
        }
        setHoverNode(internalNode);
        setHighlightNodes(newHighlightNodes);
        setHighlightLinks(newHighlightLinks);
        setHoverLink(null); // Clear link hover when hovering node
    }, [graphData.links]); // Depends on graphData.links

    /**
     * Handles link hover events to highlight the link and its connected nodes.
     */
    const handleLinkHover = useCallback((link: LinkObject | null) => {
        const newHighlightNodes = new Set<string | number>();
        const newHighlightLinks = new Set<LinkObject>();
        const internalLink = link as InternalLinkObject | null;

        if (internalLink) {
            newHighlightLinks.add(internalLink);
            const sourceId = String(internalLink.source);
            const targetId = String(internalLink.target);
            newHighlightNodes.add(sourceId);
            newHighlightNodes.add(targetId);
        }
        setHoverLink(internalLink);
        setHighlightNodes(newHighlightNodes);
        setHighlightLinks(newHighlightLinks);
        setHoverNode(null); // Clear node hover when hovering link
    }, []); // No external dependencies needed here

    /**
     * Custom drawing function for nodes, rendered on the canvas.
     */
    const drawNode = useCallback((node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const internalNode = node as InternalNodeObject; // Assume node passed will conform
        const nodeId = String(internalNode.id);
        const label = nodeId;
        const size = internalNode.val || MIN_NODE_SIZE;
        const isHighlighted = highlightNodes.has(nodeId);
        const color = isHighlighted ? NODE_COLORS.highlight : (internalNode.baseColor || NODE_COLORS.building);

        // Draw main node circle
        ctx.beginPath();
        ctx.arc(node.x!, node.y!, size, 0, 2 * Math.PI, false);
        ctx.fillStyle = color;
        ctx.fill();

        // Draw outline
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1 / globalScale;
        ctx.stroke();

        // Draw thicker highlight outline if needed
        if (isHighlighted) {
            ctx.strokeStyle = NODE_COLORS.highlight;
            ctx.lineWidth = 2.5 / globalScale;
            ctx.stroke();
        }

        // Draw label inside node if large enough
        const labelThreshold = 3;
        if (size > labelThreshold) {
            const fontSize = Math.min(14, Math.max(8, size * 0.6)) / globalScale; // Responsive font size
            ctx.font = `bold ${fontSize}px Sans-Serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'; // White text
            ctx.fillText(String(label), node.x!, node.y!);
        }
    }, [highlightNodes]); // Depends on highlightNodes for styling

    /**
     * Effect to zoom and center the graph when data changes.
     */
    useEffect(() => {
        if (fgRef.current && graphData.nodes.length > 0) {
            // Use a short timeout to allow the physics engine to stabilize slightly
            const timer = setTimeout(() => {
                fgRef.current?.zoomToFit(400, 60); // Adjust duration and padding as needed
            }, 150);
            return () => clearTimeout(timer); // Cleanup timer on unmount or data change
        }
    }, [graphData]); // Re-run when graphData object reference changes

    // --- Render Logic ---
    if (!graphData.nodes.length) {
        return (
            <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                <p>{!tradingNetwork ? "Loading trading data..." : "No trading network data available."}</p>
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
                nodeVal="val" // Use calculated size property
                nodeCanvasObject={drawNode}
                nodeCanvasObjectMode={() => 'after'} // Draw labels on top
                onNodeHover={handleNodeHover}
                 // Link Configuration
                linkSource="source"
                linkTarget="target"
                linkColor={(link) => highlightLinks.has(link as LinkObject) ? LINK_HIGHLIGHT_COLOR : (link as InternalLinkObject).baseColor || LINK_COLOR}
                linkWidth={(link) => {
                    const baseWidth = calculateLinkWidth(link as InternalLinkObject);
                    return highlightLinks.has(link as LinkObject) ? baseWidth * 1.3 : baseWidth;
                 }}
                linkCurvature={(link) => (link as InternalLinkObject).curvature || 0}
                linkDirectionalArrowLength={LINK_ARROW_LENGTH}
                linkDirectionalArrowRelPos={LINK_ARROW_REL_POS}
                onLinkHover={handleLinkHover}
                 // Physics & Interaction Configuration
                enableZoomInteraction={true}
                enablePanInteraction={true}
                enableNodeDrag={true}
                cooldownTicks={200} // Adjust settling time if needed
                warmupTicks={50}    // Initial layout ticks
                d3Force={(forceName: string) => {
                    // Standard forces for layout
                    if (forceName === 'link') return d3.forceLink().id((d: any) => String(d.id)).distance(LINK_DISTANCE);
                    if (forceName === 'charge') return d3.forceManyBody().strength(CHARGE_STRENGTH);
                    if (forceName === 'center') return d3.forceCenter().strength(CENTER_STRENGTH);
                    if (forceName === 'collide') return d3.forceCollide().radius((d: NodeObject) => ((d as InternalNodeObject).val || MIN_NODE_SIZE) + COLLIDE_PADDING);
                 }}
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
                        <div>
                            <div style={{ fontWeight: 'bold' }}>Node: {String(hoverNode.id)}</div>
                            <div>Type: {hoverNode.type}</div>
                        </div>
                    )}
                    {hoverLink && !hoverNode && (
                         <div>
                             <div style={{ fontWeight: 'bold' }}>Trade</div>
                             <div>From: {String(hoverLink.source)}</div>
                             <div>To: {String(hoverLink.target)}</div>
                             <div>Amount: {formatNumber(hoverLink.value)} kWh</div>
                         </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default TradingNetworkForceGraph;
