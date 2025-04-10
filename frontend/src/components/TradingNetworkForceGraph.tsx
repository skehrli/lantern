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
    x?: number; // Need x/y for initial layout before fixing
    y?: number;
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
    building: 'rgba(59, 130, 246, 0.95)', // Standard blue
    labelHighlight: 'rgba(239, 68, 68, 1)', // Red for highlighted labels
    labelDefault: 'rgba(50, 50, 50, 0.9)',
};
const LINK_COLOR_BASE = 'rgba(156, 163, 175, 0.4)';

const LINK_COLOR_HIGHLIGHT = 'rgba(251, 146, 60, 1)'; // Vibrant orange for highlighted links
const LINK_COLOR_FADED = 'rgba(200, 200, 200, 0.2)'; // Very faded grey for non-neighbor links
const LINK_COLOR_OUTGOING = 'rgba(76, 175, 80, 0.75)'; // Muted Green (e.g., Material Green 500)
const LINK_COLOR_INCOMING = 'rgba(211, 47, 47, 0.75)'; // Muted Red (e.g., Material Red 700)
const PARTICLE_COLOR_OUTGOING = LINK_COLOR_OUTGOING;
const PARTICLE_COLOR_INCOMING = LINK_COLOR_INCOMING;

const PARTICLE_COLOR_DEFAULT = NODE_COLORS.building;
const PARTICLE_COLOR_HIGHLIGHT = LINK_COLOR_HIGHLIGHT;

const NODE_FADE_OPACITY = 0.2;
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
const PARTICLE_WIDTH_HIGHLIGHT = 5;

// Interaction Configuration
const ZOOM_TRANSITION_MS = 500;
const ZOOM_OUT_PADDING = 4; // Padding for general zoomToFit (pixels)
const NEIGHBOR_ZOOM_PADDING = 20; // Padding around neighbors box (in graph units)

// --- Helper to create SVG Data URI ---
const createSvgDataUri = (svgString: string): string => {
    const encodedSvg = btoa(unescape(encodeURIComponent(svgString)));
    return `data:image/svg+xml;base64,${encodedSvg}`;
};

// --- Main Component ---
const TradingNetworkForceGraph: React.FC<TradingNetworkGraphProps> = ({ tradingNetwork, width, height }) => {
    const fgRef = useRef<ForceGraphMethods>();
    // visibleNodes now contains the IDs of the clicked node + its direct neighbors
    const [visibleNodes, setVisibleNodes] = useState<Set<string | number>>(new Set());
    const [highlightLinks, setHighlightLinks] = useState<Set<InternalLinkObject>>(new Set());
    const [clickedNodeId, setClickedNodeId] = useState<string | number | null>(null);

    const [buildingImageNormal, setBuildingImageNormal] = useState<HTMLImageElement | null>(null);

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
        setVisibleNodes(new Set());
        setHighlightLinks(new Set());
        console.log("Resetting state for new data.");
        // Ensure zoom resets if graph data changes while zoomed in
        if (fgRef.current) {
            fgRef.current.zoomToFit(0, ZOOM_OUT_PADDING); // Reset instantly
        }
    }, [tradingNetwork]); // Dependency only on tradingNetwork

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
        const scale = Math.max(0, Math.min(1, link.value / maxLinkValue));
        return MIN_LINK_WIDTH + scale * (MAX_LINK_WIDTH - MIN_LINK_WIDTH);
    }, [maxLinkValue]);

    // --- Interaction Handlers ---

    const updateHighlightsAndVisibility = useCallback((node: InternalNodeObject | null) => {
        const newHighlightLinks = new Set<InternalLinkObject>();
        const newVisibleNodes = new Set<string | number>(); // Nodes to include in zoom calc & keep full opacity

        if (node) {
            const nodeId = node.id;
            newVisibleNodes.add(nodeId); // Clicked node itself is visible
            internalGraphData.links.forEach((link) => {
                const sourceObj = link.source as NodeObject;
                const targetObj = link.target as NodeObject;
                const sourceId = sourceObj.id ?? link.source; // Use ID if object, else raw value
                const targetId = targetObj.id ?? link.target; // Use ID if object, else raw value

                if (sourceId === nodeId || targetId === nodeId) {
                    newHighlightLinks.add(link);
                    // Add the *other* node connected by this link to the visible set
                    const neighborId = sourceId === nodeId ? targetId : sourceId;
                    newVisibleNodes.add(String(neighborId)); // Ensure it's a string or number matching node IDs
                }
            });
        }
        setHighlightLinks(newHighlightLinks);
        setVisibleNodes(newVisibleNodes); // Set the IDs of the clicked node and its neighbors
        console.log("Visible nodes set:", Array.from(newVisibleNodes));

    }, [internalGraphData.links]);

    const handleNodeClick = useCallback((node: NodeObject | null) => {
        const internalNode = node as InternalNodeObject | null;
        if (internalNode) {
            if (internalNode.id === clickedNodeId) {
                 handleBackgroundClick();
                 return;
            }
            setClickedNodeId(internalNode.id);
            updateHighlightsAndVisibility(internalNode);
            console.log("Node clicked, setting focus:", internalNode.id);
        } else {
             handleBackgroundClick();
        }
    }, [clickedNodeId, updateHighlightsAndVisibility]); // Added updateHighlightsAndVisibility

    const handleBackgroundClick = useCallback(() => {
        console.log("Background/Deselect clicked, clearing focus.");
        setClickedNodeId(null);
        setHighlightLinks(new Set());
        setVisibleNodes(new Set()); // Clear visible nodes set
    }, []);

    // --- Node Drawing ---
    const drawNode = useCallback((node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const internalNode = node as InternalNodeObject;
        const nodeId = internalNode.id;
        // Node is fully visible if nothing is clicked OR it's the clicked node or one of its neighbors
        const isFullyVisible = !clickedNodeId || visibleNodes.has(nodeId);
        const isLabelHighlighted = clickedNodeId && visibleNodes.has(nodeId);

        const visualSize = internalNode.visualSize;
        const nodeX = internalNode.x ?? 0;
        const nodeY = internalNode.y ?? 0;

        const originalAlpha = ctx.globalAlpha;
        ctx.globalAlpha = isFullyVisible ? originalAlpha : NODE_FADE_OPACITY;

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
            ctx.fillStyle = internalNode.baseColor;
            ctx.beginPath();
            ctx.arc(nodeX, nodeY, visualSize / 2, 0, 2 * Math.PI, false);
            ctx.fill();
        }

        ctx.globalAlpha = originalAlpha; // Reset alpha for label drawing

        const labelThresholdScale = 5;
        // Only draw label if the node is fully visible
        if (isFullyVisible && (isLabelHighlighted || globalScale > labelThresholdScale)) {
             const fontSize = Math.max(6, 12 / globalScale);
             ctx.font = `${fontSize}px Sans-Serif`;
             ctx.textAlign = 'center';
             ctx.textBaseline = 'top';
             ctx.fillStyle = isLabelHighlighted ? NODE_COLORS.labelHighlight : NODE_COLORS.labelDefault;
        }
    }, [clickedNodeId, visibleNodes, buildingImageNormal]); // Added visibleNodes


    // --- Engine Tick Handler to Fix Positions ---
    const handleEngineTick = useCallback(() => {
        engineTicksRef.current += 1;
        const currentTicks = engineTicksRef.current;

        if (
            !isLayoutPhaseComplete &&
            !fixAppliedRef.current &&
            currentTicks >= ENGINE_TICKS_BEFORE_FIX &&
            internalGraphData.nodes.length > 0
        ) {
            console.log(`Engine tick ${currentTicks}: Met conditions (>= ${ENGINE_TICKS_BEFORE_FIX}), attempting to fix node positions.`);
            fixAppliedRef.current = true; // Set flag immediately

            // Create a temporary copy to avoid race conditions with state updates
            const currentNodes = internalGraphData.nodes;
            let allNodesHaveCoords = true;

            // Check if all nodes have coordinates BEFORE trying to update state
            for (const node of currentNodes) {
                if (typeof node.x !== 'number' || typeof node.y !== 'number') {
                    console.warn(`Node ${node.id} has invalid coordinates (x:${node.x}, y:${node.y}) at fixing time. Delaying fix.`);
                    allNodesHaveCoords = false;
                    fixAppliedRef.current = false; // Reset flag to try again on next tick
                    break;
                }
            }

            if (allNodesHaveCoords) {
                console.log("All nodes have valid coordinates. Applying fx/fy based on current positions.");
                setInternalGraphData(prevData => {
                    // Double-check node array length inside updater
                    if (prevData.nodes.length === 0) {
                        console.warn("Attempted to fix positions, but nodes array is empty in state updater.");
                        return prevData;
                    }
                    const updatedNodes = prevData.nodes.map(node => ({
                        ...node,
                        // Use the already validated x/y from the outer scope check
                        fx: node.x,
                        fy: node.y,
                    }));
                    return { ...prevData, nodes: updatedNodes };
                });
                setIsLayoutPhaseComplete(true);
                console.log("Layout phase marked as complete.");
            }
        }
    }, [isLayoutPhaseComplete, internalGraphData.nodes]); // Keep dependency on internalGraphData.nodes


    // --- Effect to Handle Zooming on Focus Change ---
    useEffect(() => {
        const fg = fgRef.current;
        // Wait for layout completion AND for the graph dimensions to be available
        if (!fg || !isLayoutPhaseComplete || width <= 0 || height <= 0) {
            // console.log(`Zoom effect skipped: fg=${!!fg}, layoutComplete=${isLayoutPhaseComplete}, w=${width}, h=${height}`);
            return;
        }

        if (clickedNodeId !== null) {
            // --- Calculate Bounding Box for Clicked Node + Neighbors ---
            const nodesToConsider = internalGraphData.nodes.filter(n => visibleNodes.has(n.id));

            if (nodesToConsider.length > 0) {
                let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                let validCoordsFound = false;

                nodesToConsider.forEach(node => {
                    // Use FIXED coordinates for zoom calculation
                    if (typeof node.fx === 'number' && typeof node.fy === 'number') {
                        minX = Math.min(minX, node.fx);
                        maxX = Math.max(maxX, node.fx);
                        minY = Math.min(minY, node.fy);
                        maxY = Math.max(maxY, node.fy);
                        validCoordsFound = true;
                    } else {
                         console.warn(`Node ${node.id} missing fixed coordinates (fx/fy) during zoom calculation.`);
                    }
                });

                if (validCoordsFound) {
                    const centerX = (minX + maxX) / 2;
                    const centerY = (minY + maxY) / 2;

                    // Handle case with a single node (or all nodes at the same point)
                    const boxWidth = (nodesToConsider.length === 1 || maxX === minX) ? 0 : maxX - minX;
                    const boxHeight = (nodesToConsider.length === 1 || maxY === minY) ? 0 : maxY - minY;

                    // Ensure minimum dimensions to avoid infinite zoom with padding only
                    const paddedWidth = Math.max(1, boxWidth) + 2 * NEIGHBOR_ZOOM_PADDING;
                    const paddedHeight = Math.max(1, boxHeight) + 2 * NEIGHBOR_ZOOM_PADDING;

                    // Calculate required zoom to fit the padded box
                    // zoom = graphCanvasSize / worldSize
                    const zoomX = width / paddedWidth;
                    const zoomY = height / paddedHeight;
                    const targetZoom = Math.min(zoomX, zoomY); // Use the smaller zoom level to ensure full visibility

                    console.log(`Zooming to fit neighbors. Center: (${centerX.toFixed(1)}, ${centerY.toFixed(1)}), Box: ${boxWidth.toFixed(1)}x${boxHeight.toFixed(1)}, Target Zoom: ${targetZoom.toFixed(2)}`);

                    fg.centerAt(centerX, centerY, ZOOM_TRANSITION_MS);
                    fg.zoom(targetZoom, ZOOM_TRANSITION_MS);

                } else {
                    // Fallback: Center on the clicked node if coords are missing (should be rare after layout complete)
                     console.warn("Could not calculate neighbor bounds due to missing fixed coordinates. Centering on clicked node.");
                     const nodeToFocus = internalGraphData.nodes.find(n => n.id === clickedNodeId);
                      if (nodeToFocus && typeof nodeToFocus.fx === 'number' && typeof nodeToFocus.fy === 'number') {
                          fg.centerAt(nodeToFocus.fx, nodeToFocus.fy, ZOOM_TRANSITION_MS);
                          fg.zoom(1.5, ZOOM_TRANSITION_MS); // Default zoom level if calculation fails
                      } else {
                           console.warn(`Could not find node ${clickedNodeId} or its fixed position for fallback focus.`);
                           fg.zoomToFit(ZOOM_TRANSITION_MS, ZOOM_OUT_PADDING); // Zoom out completely as last resort
                      }
                }

            } else {
                 // This case should ideally not happen if clickedNodeId is set, as visibleNodes should contain at least the clicked node.
                 console.warn("Clicked node ID is set, but no nodes found in visibleNodes set for zooming.");
                 fg.zoomToFit(ZOOM_TRANSITION_MS, ZOOM_OUT_PADDING); // Zoom out if something went wrong
            }

        } else {
             // Zoom out when no node is clicked (and layout is complete)
             console.log("Focus cleared, zooming out to fit graph.");
             fg.zoomToFit(ZOOM_TRANSITION_MS, ZOOM_OUT_PADDING);
        }

    // Dependencies: React to changes in focus, layout completion, the set of visible nodes,
    // the node data itself (for fx/fy), and the graph dimensions.
    }, [clickedNodeId, isLayoutPhaseComplete, internalGraphData.nodes, visibleNodes, width, height]);


    // --- Render Logic ---
    if (!buildingImageNormal) {
         return (<div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', background: '#f9fafb' }}><p>Loading assets...</p></div>);
    }
     if (tradingNetwork === null) {
        return (<div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px' }}><p>Loading network data...</p></div>);
    }
     // Check after processing, before rendering graph
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
                nodeCanvasObject={drawNode}
                nodeCanvasObjectMode={() => "replace"}
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

                    // Check if the link is connected to the clicked node
                    if (!highlightLinks.has(link)) {
                        return LINK_COLOR_FADED;    // Faded color for non-connected links
                    }

                    // --- Link is highlighted, determine direction relative to clickedNodeId ---
                    // Resolve source/target IDs robustly (could be string/number or object)
                    const sourceId = typeof link.source === 'object' && link.source.id !== undefined
                                        ? link.source.id
                                        : link.source;
                    const targetId = typeof link.target === 'object' && link.target.id !== undefined
                                        ? link.target.id
                                        : link.target;

                    if (String(sourceId) === String(clickedNodeId)) {
                        return LINK_COLOR_OUTGOING; // Outgoing from the clicked node
                    } else if (String(targetId) === String(clickedNodeId)) {
                        return LINK_COLOR_INCOMING; // Incoming to the clicked node
                    } else {
                        // This case shouldn't ideally happen if highlightLinks is correctly populated
                        // based on source OR target matching clickedNodeId.
                        console.warn("Highlighted link not directly connected to clicked node?", link, clickedNodeId);
                        return LINK_COLOR_HIGHLIGHT; // Fallback highlight if logic somehow fails
                    }
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
                                                    }
                linkDirectionalParticleColor={(linkInput: LinkObject) => {
                    const link = linkInput as InternalLinkObject;

                    // If no node is clicked or the link isn't highlighted, use default
                    // (Particles will be 0 anyway for faded links, but set a color regardless)
                    if (!clickedNodeId || !highlightLinks.has(link)) {
                        return PARTICLE_COLOR_DEFAULT;
                    }

                    // --- Link is highlighted, determine particle color based on direction ---
                     const sourceId = typeof link.source === 'object' && link.source.id !== undefined
                                        ? link.source.id
                                        : link.source;
                    const targetId = typeof link.target === 'object' && link.target.id !== undefined
                                        ? link.target.id
                                        : link.target;

                    if (String(sourceId) === String(clickedNodeId)) {
                        return PARTICLE_COLOR_OUTGOING; // Outgoing particles
                    } else if (String(targetId) === String(clickedNodeId)) {
                        return PARTICLE_COLOR_INCOMING; // Incoming particles
                    } else {
                        // Fallback
                        return PARTICLE_COLOR_HIGHLIGHT;
                    }
                }}
                linkDirectionalParticleSpeed={0.006}
                 // Physics & Interaction Configuration
                enableZoomInteraction={false}
                enablePanInteraction={false}
                enableNodeDrag={!isLayoutPhaseComplete} // Allow dragging only before layout is fixed
                warmupTicks={INITIAL_WARMUP_TICKS}
                cooldownTicks={Infinity} // Keep engine running (needed for particles, zoom/pan)
                onEngineTick={handleEngineTick} // Handle fixing positions
            />
        </div>
    );
};

export default TradingNetworkForceGraph;
