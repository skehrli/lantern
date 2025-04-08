// src/components/TradingNetworkGraph.tsx
import React, { useEffect, useRef, useMemo, useState } from 'react';
import ForceGraph2D, { NodeObject, LinkObject, ForceGraphMethods } from 'react-force-graph-2d';
import * as d3 from 'd3-force'; // Import d3-force for detailed configuration

// --- Interface for the actual API response format ---
interface ApiTradingNetworkData {
    nodes: string[]; // Array of node IDs
    edges: [string, string, number][]; // Array of [source, target, value] tuples
}

// --- Component Props ---
interface TradingNetworkGraphProps {
    tradingNetwork: ApiTradingNetworkData | null; // Expects the direct API format
    width: number;
    height: number;
}

// --- Helper Functions ---
const formatNumber = (num: number | null | undefined, decimals: number = 1): string => {
    // ... (no change)
    if (num == null || isNaN(num)) {
        return 'N/A';
    }
    const fixedNum = num.toFixed(decimals);
    const parts = fixedNum.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, "'");
    return parts.join('.');
};

// --- Constants for Visuals ---
const NODE_COLORS = {
    building: 'rgba(59, 130, 246, 0.95)', // Slightly more opaque blue
    buildingPV: 'rgba(34, 197, 94, 0.95)', // Slightly more opaque green
    grid: 'rgba(107, 114, 128, 0.95)',   // Slightly more opaque grey
    highlight: 'rgba(239, 68, 68, 1)',
};
const LINK_COLOR = 'rgba(156, 163, 175, 0.5)'; // Slightly more visible links
const LINK_HIGHLIGHT_COLOR = 'rgba(239, 68, 68, 0.9)';
const MIN_NODE_SIZE = 5;
const MAX_NODE_SIZE = 14;
const GRID_NODE_SIZE = 12;
const MIN_LINK_WIDTH = 0; // Slightly thicker minimum link width
const MAX_LINK_WIDTH = 7;   // Slightly thicker maximum link width
// Removed LINK_ARROW constants as they are not needed
const VALUE_TOLERANCE = 0.01;

// --- Constants for Physics ---
// Further adjustments for spreading out:
const CHARGE_STRENGTH = -280; // << INCREASED Repulsion further
const LINK_DISTANCE = 90;     // << INCREASED Link distance further
const CENTER_STRENGTH = 0.01; // << Drastically REDUCED Center pull (very weak)


// --- Main Component ---
const TradingNetworkForceGraph: React.FC<TradingNetworkGraphProps> = ({ tradingNetwork, width, height }) => {
    const fgRef = useRef<ForceGraphMethods>();
    const [highlightNodes, setHighlightNodes] = useState<Set<string | number>>(new Set());
    const [highlightLinks, setHighlightLinks] = useState<Set<LinkObject>>(new Set());
    const [hoverNode, setHoverNode] = useState<NodeObject | null>(null);
    const [hoverLink, setHoverLink] = useState<LinkObject | null>(null);

    // Memoize processed graph data (transforms raw API data internally)
    const graphData = useMemo(() => {
        // ... (transformation logic remains the same) ...
        const rawNetwork = tradingNetwork;

        if (!rawNetwork || !rawNetwork.nodes || !rawNetwork.edges) {
            return { nodes: [], links: [] };
        }
        if (rawNetwork.nodes.length === 0 && rawNetwork.edges.length === 0) {
             return { nodes: [], links: [] };
        }

        const links: LinkObject[] = rawNetwork.edges
            .filter(edge => edge.length === 3 && typeof edge[2] === 'number' && edge[2] > VALUE_TOLERANCE)
            .map(edge => ({
                source: String(edge[0]),
                target: String(edge[1]),
                value: edge[2],
                baseColor: LINK_COLOR, // Use updated constant
            }));

        const nodeDegrees: { [key: string]: number } = {};
        links.forEach(link => {
            const sourceId = String(typeof link.source === 'object' ? link.source.id : link.source);
            const targetId = String(typeof link.target === 'object' ? link.target.id : link.target);
            nodeDegrees[sourceId] = (nodeDegrees[sourceId] || 0) + 1;
            nodeDegrees[targetId] = (nodeDegrees[targetId] || 0) + 1;
        });

        const nodes: NodeObject[] = rawNetwork.nodes.map((nodeId: string) => {
             const type = String(nodeId).toLowerCase().includes('grid') ? 'grid' : 'building';
             const isPV = false;
             const baseColor = type === 'grid'
                        ? NODE_COLORS.grid
                        : (isPV ? NODE_COLORS.buildingPV : NODE_COLORS.building);
            const val = type === 'grid'
                 ? GRID_NODE_SIZE
                 : Math.max(MIN_NODE_SIZE, Math.min(MAX_NODE_SIZE, MIN_NODE_SIZE + (nodeDegrees[nodeId] || 0) * 0.7));

            return { id: nodeId, type, isPV, val, baseColor };
        });

        return { nodes, links };

    }, [tradingNetwork]);

    // --- Link Width Calculation ---
    const maxLinkValue = useMemo(() => {
        if (!graphData.links || graphData.links.length === 0) return 1;
        return Math.max(...graphData.links.map(l => l.value), 1);
    }, [graphData.links]);

    const calculateLinkWidth = (link: LinkObject) => {
        if (maxLinkValue <= 0) {
            return MIN_LINK_WIDTH;
        }
        const scale = Math.max(0, Math.min(1, link.value / maxLinkValue));
        return MIN_LINK_WIDTH + scale * (MAX_LINK_WIDTH - MIN_LINK_WIDTH);
    };

    // --- Interaction Handlers (No changes needed) ---
     const handleNodeHover = (node: NodeObject | null) => {
        // ... (no change)
        highlightNodes.clear();
        highlightLinks.clear();
        if (node) {
            highlightNodes.add(node.id as string | number);
            graphData.links.forEach((link: LinkObject) => {
                 const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
                 const targetId = typeof link.target === 'object' ? link.target.id : link.target;
                if (sourceId === node.id || targetId === node.id) {
                    highlightLinks.add(link);
                    highlightNodes.add(sourceId);
                    highlightNodes.add(targetId);
                }
            });
        }
        setHoverNode(node);
        setHighlightNodes(new Set(highlightNodes));
        setHighlightLinks(new Set(highlightLinks));
    };
     const handleLinkHover = (link: LinkObject | null) => {
         // ... (no change)
         highlightNodes.clear();
         highlightLinks.clear();
         if (link) {
             highlightLinks.add(link);
             const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
             const targetId = typeof link.target === 'object' ? link.target.id : link.target;
             highlightNodes.add(sourceId);
             highlightNodes.add(targetId);
         }
         setHoverLink(link);
         setHighlightNodes(new Set(highlightNodes));
         setHighlightLinks(new Set(highlightLinks));
    };

    // --- Node Canvas Object Drawing (No changes needed) ---
    const drawNode = (node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
        // ... (no change from previous version with labels inside)
        const label = node.id;
        const size = node.val || MIN_NODE_SIZE;
        const isHighlighted = highlightNodes.has(node.id as string | number);
        const color = isHighlighted ? NODE_COLORS.highlight : (node.baseColor || NODE_COLORS.building);

        ctx.beginPath();
        ctx.arc(node.x!, node.y!, size, 0, 2 * Math.PI, false);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1 / globalScale;
        ctx.stroke();

        if (isHighlighted) {
            ctx.strokeStyle = NODE_COLORS.highlight;
            ctx.lineWidth = 2.5 / globalScale;
            ctx.stroke();
        }

        const labelThreshold = 3;
        if (size > labelThreshold) {
            const fontSize = Math.min(14, 10 / globalScale);
            ctx.font = `bold ${fontSize}px Sans-Serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.fillText(String(label), node.x!, node.y!);
        }
    };

    // --- Center graph on initial load/data change ---
     useEffect(() => {
        if (fgRef.current && graphData.nodes.length > 0) {
             setTimeout(() => {
                // Zoom with slightly more padding now that graph should be wider
                fgRef.current?.zoomToFit(500, 80); // Increased padding slightly
             }, 150); // Keep delay
        }
    }, [graphData, width, height]);

    // --- Render ---
    if (!tradingNetwork || !tradingNetwork.nodes || tradingNetwork.nodes.length === 0) {
        // ... (no change)
        return (
            <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
                <p>No trading network data available for visualization.</p>
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
                // --- Node Styling ---
                nodeId="id"
                nodeVal="val"
                nodeCanvasObject={drawNode}
                nodeCanvasObjectMode={() => 'after'}
                onNodeHover={handleNodeHover}
                 // --- Link Styling ---
                linkSource="source"
                linkTarget="target"
                linkColor={(link) => highlightLinks.has(link as LinkObject) ? LINK_HIGHLIGHT_COLOR : (link.baseColor || LINK_COLOR)}
                linkWidth={(link) => highlightLinks.has(link as LinkObject) ? calculateLinkWidth(link as LinkObject) * 1.3 : calculateLinkWidth(link as LinkObject)}
                linkDirectionalArrowLength={0} // << REMOVED Arrows
                // linkDirectionalArrowRelPos={LINK_ARROW_REL_POS} // Not needed
                // linkDirectionalArrowColor={...} // Not needed
                onLinkHover={handleLinkHover}
                 // --- Physics & Interaction ---
                enableZoomInteraction={true}
                enablePanInteraction={false}
                enableNodeDrag={true}
                cooldownTicks={250} // << INCREASED settling time further
                warmupTicks={60}
                 // Configure forces for spreading - using updated constants
                d3Force={(forceName: string, forceFn?: any) => {
                    if (forceName === 'link') {
                         return (d3 as any).forceLink()
                           .id((d: any) => d.id)
                           .distance(LINK_DISTANCE); // Use constant
                     }
                    if (forceName === 'charge') {
                         return (d3 as any).forceManyBody().strength(CHARGE_STRENGTH); // Use constant
                     }
                    if (forceName === 'center') {
                         return (d3 as any).forceCenter().strength(CENTER_STRENGTH); // Use constant (now very weak)
                     }
                 }}
                  onEngineStop={() => {
                     // Optional: Could re-zoom here if needed
                     // fgRef.current?.zoomToFit(600, 80);
                  }}
            />
            {/* Tooltip Display (No changes needed) */}
            {(hoverNode || hoverLink) && (
                <div style={{
                    // ... (style remains the same)
                    position: 'absolute',
                    bottom: '10px',
                    right: '10px',
                    background: 'rgba(40, 40, 40, 0.9)',
                    color: 'white',
                    padding: '8px 12px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    maxWidth: '250px',
                    pointerEvents: 'none',
                    boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
                    zIndex: 10,
                    textAlign: 'right',
                }}>
                   {/* ... (content remains the same) */}
                   {hoverNode && (
                        <div>
                            <div style={{ fontWeight: 'bold' }}>Node: {hoverNode.id}</div>
                            <div>Type: {String(hoverNode.type)}</div>
                        </div>
                    )}
                    {hoverLink && !hoverNode && (
                         <div>
                             <div style={{ fontWeight: 'bold' }}>Trade</div>
                             <div>{`From: ${typeof hoverLink.source === 'object' ? hoverLink.source.id : hoverLink.source}`}</div>
                             <div>{`To: ${typeof hoverLink.target === 'object' ? hoverLink.target.id : hoverLink.target}`}</div>
                             <div>{`Amount: ${formatNumber(hoverLink.value)} kWh`}</div>
                         </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default TradingNetworkForceGraph;
