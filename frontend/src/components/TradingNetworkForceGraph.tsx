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
        // console.log("TradingNetwork prop received:", tradingNetwork); // Less verbose logging
        setIsLayoutPhaseComplete(false);
        fixAppliedRef.current = false;
        engineTicksRef.current = 0;
        setClickedNodeId(null);
        setVisibleNodes(new Set());
        setHighlightLinks(new Set());
        // console.log("Resetting state for new data.");
        if (fgRef.current) {
            fgRef.current.zoomToFit(0, ZOOM_OUT_PADDING);
        }
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
        if (!tradingNetwork?.nodes || !tradingNetwork?.edges || (tradingNetwork.nodes.length === 0 && tradingNetwork.edges.length === 0)) {
            // console.log("No valid data, setting empty graph.");
            setInternalGraphData({ nodes: [], links: [] });
            return;
        }

        // console.log("Processing new tradingNetwork prop into internalGraphData...");
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
                // Adjust node physics size slightly based on degree, if needed later
                // const degree = links.filter(l => l.source === id || l.target === id).length;
                const val = visualSize / 2 + 1; // Base val
                return { id, baseColor, val, visualSize };
            });

        // console.log("Setting new internalGraphData:", { nodes: nodes.length, links: links.length });
        setInternalGraphData({ nodes, links });
    }, [tradingNetwork]);

    const maxLinkValue = useMemo(() => {
        if (!internalGraphData.links || internalGraphData.links.length === 0) return 1;
        return Math.max(1, ...internalGraphData.links.map(l => l.value));
    }, [internalGraphData.links]);

    const calculateLinkWidth = useCallback((link: InternalLinkObject): number => {
        if (!maxLinkValue || maxLinkValue <= 0) return MIN_LINK_WIDTH;
        const scale = Math.max(0, Math.min(1, link.value / maxLinkValue));
        return MIN_LINK_WIDTH + scale * (MAX_LINK_WIDTH - MIN_LINK_WIDTH);
    }, [maxLinkValue]);

    // --- Interaction Handlers ---

    const updateHighlightsAndVisibility = useCallback((node: InternalNodeObject | null) => {
        const newHighlightLinks = new Set<InternalLinkObject>();
        const newVisibleNodes = new Set<string | number>();

        if (node) {
            const nodeId = node.id;
            newVisibleNodes.add(nodeId);
            internalGraphData.links.forEach((link) => {
                // Resolve IDs correctly in case source/target are node objects already
                const sourceObj = link.source as NodeObject;
                const targetObj = link.target as NodeObject;
                const sourceId = sourceObj?.id ?? link.source;
                const targetId = targetObj?.id ?? link.target;

                if (sourceId === nodeId || targetId === nodeId) {
                    newHighlightLinks.add(link);
                    const neighborId = sourceId === nodeId ? targetId : sourceId;
                    newVisibleNodes.add(String(neighborId)); // Ensure consistent type
                }
            });
        }
        setHighlightLinks(newHighlightLinks);
        setVisibleNodes(newVisibleNodes);
        // console.log("Visible nodes set:", Array.from(newVisibleNodes));

    }, [internalGraphData.links]); // Depends only on link data

    // --- MOVED handleBackgroundClick Definition BEFORE handleNodeClick ---
    const handleBackgroundClick = useCallback(() => {
        // console.log("Background/Deselect clicked, clearing focus.");
        setClickedNodeId(null);
        setHighlightLinks(new Set());
        setVisibleNodes(new Set());
    }, []); // No dependencies needed, setters are stable

    const handleNodeClick = useCallback((node: NodeObject | null) => {
        const internalNode = node as InternalNodeObject | null;
        if (internalNode) {
            // If clicking the already selected node, deselect it (treat as background click)
            if (internalNode.id === clickedNodeId) {
                 handleBackgroundClick(); // Now defined and initialized
                 return;
            }
            // Otherwise, select the new node
            setClickedNodeId(internalNode.id);
            updateHighlightsAndVisibility(internalNode);
            // console.log("Node clicked, setting focus:", internalNode.id);
        } else {
             // Clicked on background (or null node passed)
             handleBackgroundClick(); // Now defined and initialized
        }
    }, [clickedNodeId, updateHighlightsAndVisibility, handleBackgroundClick]); // Dependencies are correct

    // --- Node Drawing ---
    const drawNode = useCallback((node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
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
            ctx.drawImage(
                imgToDraw,
                nodeX - visualSize / 2,
                nodeY - visualSize / 2,
                visualSize,
                visualSize
            );
        } else {
            // Fallback drawing if image not loaded
            ctx.fillStyle = internalNode.baseColor;
            ctx.beginPath();
            ctx.arc(nodeX, nodeY, visualSize / 2, 0, 2 * Math.PI, false);
            ctx.fill();
        }

        // Restore alpha before drawing label
        ctx.globalAlpha = originalAlpha;

        // --- Label Drawing ---
        const labelThresholdScale = 5; // Only show labels when zoomed in enough OR node is highlighted
        if (isFullyVisible && (globalScale > labelThresholdScale)) {
             const baseFontSize = 12; // Base font size at scale 1
             const minFontSize = 6;  // Minimum readable font size
             const fontSize = Math.max(minFontSize, baseFontSize / globalScale); // Adjust font size based on zoom

             ctx.font = `${fontSize}px Sans-Serif`;
             ctx.textAlign = 'center';
             ctx.textBaseline = 'top'; // Align text top to position below node
        }
    }, [clickedNodeId, visibleNodes, buildingImageNormal]); // Dependencies for drawing


    // --- Engine Tick Handler to Fix Positions ---
    const handleEngineTick = useCallback(() => {
        engineTicksRef.current += 1;
        const currentTicks = engineTicksRef.current;

        // Check if layout is not complete, fix hasn't been applied, time is right, and nodes exist
        if (
            !isLayoutPhaseComplete &&
            !fixAppliedRef.current &&
            currentTicks >= ENGINE_TICKS_BEFORE_FIX &&
            internalGraphData.nodes.length > 0
        ) {
            // console.log(`Engine tick ${currentTicks}: Met conditions (>= ${ENGINE_TICKS_BEFORE_FIX}), attempting to fix node positions.`);
            fixAppliedRef.current = true; // Assume we will fix, reset if coords missing

            const currentNodes = internalGraphData.nodes;
            let allNodesHaveCoords = true;

            // Validate coordinates BEFORE updating state
            for (const node of currentNodes) {
                if (typeof node.x !== 'number' || typeof node.y !== 'number') {
                    console.warn(`Node ${node.id} has invalid coordinates (x:${node.x}, y:${node.y}) at fixing time. Delaying fix.`);
                    allNodesHaveCoords = false;
                    fixAppliedRef.current = false; // Reset flag to try again next tick
                    break;
                }
            }

            // If all coordinates are valid, update the state to fix positions
            if (allNodesHaveCoords) {
                // console.log("All nodes have valid coordinates. Applying fx/fy based on current positions.");
                setInternalGraphData(prevData => {
                    // Check again inside updater as a safeguard
                    if (prevData.nodes.length === 0) {
                        console.warn("Attempted to fix positions, but nodes array is empty in state updater.");
                        return prevData;
                    }
                    const updatedNodes = prevData.nodes.map(node => ({
                        ...node,
                        // Use validated x/y from the earlier check
                        fx: node.x,
                        fy: node.y,
                    }));
                    return { ...prevData, nodes: updatedNodes };
                });
                setIsLayoutPhaseComplete(true); // Mark layout as complete
                // console.log("Layout phase marked as complete.");
            }
        }
    }, [isLayoutPhaseComplete, internalGraphData.nodes]); // Depends on layout state and node data


    // --- Effect to Handle Zooming on Focus Change ---
    useEffect(() => {
        const fg = fgRef.current;
        // Only zoom if graph exists, layout is done, and dimensions are valid
        if (!fg || !isLayoutPhaseComplete || width <= 0 || height <= 0) {
            return;
        }

        if (clickedNodeId !== null) {
            // Find the nodes to include in the bounding box (clicked + neighbors)
            const nodesToConsider = internalGraphData.nodes.filter(n => visibleNodes.has(n.id));

            if (nodesToConsider.length > 0) {
                let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                let validCoordsFound = false;

                // Calculate bounds using FIXED coordinates (fx/fy)
                nodesToConsider.forEach(node => {
                    if (typeof node.fx === 'number' && typeof node.fy === 'number') {
                        minX = Math.min(minX, node.fx);
                        maxX = Math.max(maxX, node.fx);
                        minY = Math.min(minY, node.fy);
                        maxY = Math.max(maxY, node.fy);
                        validCoordsFound = true;
                    } else {
                         // This shouldn't happen often after layout phase is complete
                         console.warn(`Node ${node.id} missing fixed coordinates (fx/fy) during zoom calculation.`);
                    }
                });

                if (validCoordsFound) {
                    const centerX = (minX + maxX) / 2;
                    const centerY = (minY + maxY) / 2;

                    // Calculate box dimensions, ensuring non-zero for single nodes
                    const boxWidth = (nodesToConsider.length <= 1 || maxX === minX) ? 0 : maxX - minX;
                    const boxHeight = (nodesToConsider.length <= 1 || maxY === minY) ? 0 : maxY - minY;

                    // Add padding and ensure minimum dimensions
                    const paddedWidth = Math.max(NEIGHBOR_ZOOM_PADDING * 2, boxWidth + 2 * NEIGHBOR_ZOOM_PADDING); // Ensure min width based on padding
                    const paddedHeight = Math.max(NEIGHBOR_ZOOM_PADDING * 2, boxHeight + 2 * NEIGHBOR_ZOOM_PADDING); // Ensure min height based on padding

                    // Determine required zoom level to fit padded box
                    const zoomX = width / paddedWidth;
                    const zoomY = height / paddedHeight;
                    const targetZoom = Math.min(zoomX, zoomY); // Fit entirely within view

                    // console.log(`Zooming to fit neighbors. Center: (${centerX.toFixed(1)}, ${centerY.toFixed(1)}), Box: ${boxWidth.toFixed(1)}x${boxHeight.toFixed(1)}, Target Zoom: ${targetZoom.toFixed(2)}`);
                    fg.centerAt(centerX, centerY, ZOOM_TRANSITION_MS);
                    fg.zoom(targetZoom, ZOOM_TRANSITION_MS);

                } else {
                     // Fallback if coordinates were missing
                     console.warn("Could not calculate neighbor bounds due to missing fixed coordinates. Centering on clicked node.");
                     const nodeToFocus = internalGraphData.nodes.find(n => n.id === clickedNodeId);
                      if (nodeToFocus && typeof nodeToFocus.fx === 'number' && typeof nodeToFocus.fy === 'number') {
                          fg.centerAt(nodeToFocus.fx, nodeToFocus.fy, ZOOM_TRANSITION_MS);
                          fg.zoom(1.5, ZOOM_TRANSITION_MS); // Arbitrary zoom level
                      } else {
                           console.warn(`Could not find node ${clickedNodeId} or its fixed position for fallback focus.`);
                           fg.zoomToFit(ZOOM_TRANSITION_MS, ZOOM_OUT_PADDING); // Last resort: zoom out
                      }
                }
            } else {
                 console.warn("Clicked node ID is set, but no nodes found in visibleNodes set for zooming.");
                 fg.zoomToFit(ZOOM_TRANSITION_MS, ZOOM_OUT_PADDING);
            }
        } else {
             // No node clicked, zoom out to fit everything
             // console.log("Focus cleared, zooming out to fit graph.");
             fg.zoomToFit(ZOOM_TRANSITION_MS, ZOOM_OUT_PADDING);
        }
    }, [clickedNodeId, isLayoutPhaseComplete, internalGraphData.nodes, visibleNodes, width, height]);


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
                nodeVal="val" // Used for physics repulsion strength, adjust if needed
                nodeCanvasObject={drawNode}
                nodeCanvasObjectMode={() => "replace"} // Use our custom drawing entirely
                onNodeClick={handleNodeClick}
                onBackgroundClick={handleBackgroundClick}
                // Link Configuration
                linkSource="source"
                linkTarget="target"
                linkColor={(linkInput: LinkObject) => {
                    const link = linkInput as InternalLinkObject;
                    if (!clickedNodeId) return link.baseColor; // Default when nothing selected
                    if (!highlightLinks.has(link)) return LINK_COLOR_FADED; // Fade non-relevant links

                    // Determine color based on direction relative to clicked node
                    const sourceId = typeof link.source === 'object' && link.source?.id !== undefined ? link.source.id : link.source;
                    const targetId = typeof link.target === 'object' && link.target?.id !== undefined ? link.target.id : link.target;

                    if (String(sourceId) === String(clickedNodeId)) return LINK_COLOR_OUTGOING;
                    if (String(targetId) === String(clickedNodeId)) return LINK_COLOR_INCOMING;
                    // Should not happen if highlightLinks is correct, but include fallback
                    return LINK_COLOR_HIGHLIGHT;
                }}
                linkWidth={link => calculateLinkWidth(link as InternalLinkObject)}
                linkCurvature={(link) => (link as InternalLinkObject).curvature || 0}
                // Particle Configuration
                linkDirectionalParticles={(linkInput: LinkObject) => {
                    const link = linkInput as InternalLinkObject;
                    // No particles on faded links
                    if (clickedNodeId && !highlightLinks.has(link)) return 0;
                    // Calculate particles based on value
                    const w = link.value || 0;
                    if (w <= 0 || !maxLinkValue || maxLinkValue <= 0) return 0; // No particles for zero/invalid value
                    const weightProportion = w / maxLinkValue;
                    const calculatedParticles = weightProportion * MAX_PARTICLES_VISUAL;
                    // Ensure at least min particles if value > 0, up to max
                    return calculatedParticles > 0 ? Math.max(MIN_PARTICLES_FOR_NON_ZERO, Math.round(calculatedParticles)) : 0;
                }}
                linkDirectionalParticleWidth={(link) => highlightLinks.has(link as InternalLinkObject)
                                                        ? PARTICLE_WIDTH_HIGHLIGHT // Wider particles for highlighted links
                                                        : PARTICLE_WIDTH_DEFAULT
                                                    }
                linkDirectionalParticleColor={(linkInput: LinkObject) => {
                    const link = linkInput as InternalLinkObject;
                     // Particles only shown on highlighted links when a node is clicked,
                     // so we only need to determine outgoing/incoming color here.
                    if (!clickedNodeId || !highlightLinks.has(link)) {
                        // Technically particles should be 0 here, but set a fallback color.
                        return PARTICLE_COLOR_DEFAULT;
                    }

                    const sourceId = typeof link.source === 'object' && link.source?.id !== undefined ? link.source.id : link.source;
                    const targetId = typeof link.target === 'object' && link.target?.id !== undefined ? link.target.id : link.target;

                    if (String(sourceId) === String(clickedNodeId)) return PARTICLE_COLOR_OUTGOING;
                    if (String(targetId) === String(clickedNodeId)) return PARTICLE_COLOR_INCOMING;
                    // Fallback, should ideally not be reached
                    return PARTICLE_COLOR_HIGHLIGHT;
                }}
                linkDirectionalParticleSpeed={(linkInput: LinkObject) => {
                    const link = linkInput as InternalLinkObject;
                    // Use minimum speed if max value is invalid or link has no value
                    if (!maxLinkValue || maxLinkValue <= 0 || !link.value || link.value <= 0) {
                         return PARTICLE_MIN_SPEED;
                    }
                    // Calculate proportion of max value (0 to 1)
                    const proportion = Math.max(0, Math.min(1, link.value / maxLinkValue));
                    // Linear interpolation between min and max speed
                    const speed = PARTICLE_MIN_SPEED + proportion * (PARTICLE_MAX_SPEED - PARTICLE_MIN_SPEED);
                    return speed;
                }}
                 // Physics & Interaction Configuration
                enableZoomInteraction={false}
                enablePanInteraction={false}
                enableNodeDrag={!isLayoutPhaseComplete} // Allow dragging only during layout phase
                warmupTicks={INITIAL_WARMUP_TICKS} // Initial simulation steps
                cooldownTicks={Infinity} // Keep simulation running for particles/interaction
                onEngineTick={handleEngineTick} // Hook into simulation steps for fixing layout
            />
        </div>
    );
};

export default TradingNetworkForceGraph;
