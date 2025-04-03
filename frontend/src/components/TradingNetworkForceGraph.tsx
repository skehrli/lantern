import React, { useState, useRef, useEffect, useCallback } from 'react';
import ForceGraph2D, { LinkObject, NodeObject } from 'react-force-graph-2d';
import { ResponsiveContainer } from 'recharts';


interface TradingNetwork {
    edges: Array<[string, string, number]>;
    nodes: string[];
}

interface Props {
    tradingNetwork: TradingNetwork;
    width?: number;
    height?: number;
}

interface GraphNode extends NodeObject {
    id: string;
    type: string;
    color?: string;
    size?: number;
    x?: number;
    y?: number;
}

interface SourceObject {
    id: string;
    index: number;
    type: string;
    vx: number;
    vy: number;
    x: number;
    y: number;
    __indexColor: string;
}

interface GraphLink extends LinkObject {
    source: string | GraphNode;
    target: string | GraphNode;
    value: number;
}

interface GraphLinkObject extends LinkObject {
    source: SourceObject;
    target: SourceObject;
    value: number;
}

const TradingNetworkForceGraph: React.FC<Props> = ({
    tradingNetwork
}) => {

    const { edges, nodes } = tradingNetwork;
    const height = 600;

    const graphNodes: GraphNode[] = React.useMemo(() => {
        return nodes.map((nodeId) => {
            let nodeType = "household";
            if (nodeId.includes("grid_in")) nodeType = "Grid Inflow";
            if (nodeId.includes("grid_out")) nodeType = "Grid Outflow";
            return { id: nodeId, type: nodeType };
        });
    }, [nodes]);

    const graphLinks = React.useMemo(() => {
        return edges.map(([source, target, weight]) => ({
            source,
            target,
            value: weight,
        }));
    }, [edges]);


    return (
        <ResponsiveContainer width="100%" height="100%">
            <ForceGraph2D
                nodeId='id'
                linkSource="source"
                linkTarget="target"
                linkDirectionalArrowLength={6}
                linkDirectionalArrowColor={(link: GraphLink) => {
                    const w = link.value || 1;
                    const alpha = Math.min(1, Math.log10(w + 1) / 3);
                    return `rgba(84, 84, 84, ${alpha})`;
                }}
                linkDirectionalParticles={(link: GraphLink) => {
                    const w = link.value || 1;
                    const alpha = Math.min(1, Math.log10(w + 1) / 3);
                    return Math.round(alpha * 10);
                }}
                linkDirectionalArrowRelPos={1}


                enableZoomInteraction={true}
                graphData={{ nodes: graphNodes, links: graphLinks }}
                nodeLabel={(node: GraphNode) => `ID: ${node.id}\nType: ${node.type}`}
                linkLabel={(link: GraphLinkObject) => {
                    console.log("linkLabel", link);
                    if (link.source.id === "grid_in") {
                        return `Grid Input: ${link.value.toFixed(4)}`;
                    } else if (link.target.id === "grid_out") {
                        return `Grid Output: ${link.value.toFixed(4)}`;
                    } else {
                        return `Trade Weight: ${link.value.toFixed(4)}`;
                    }
                }}
                linkWidth={(link: GraphLink) =>
                    Math.max(0.5, Math.log10(link.value + 1))
                }
                linkColor={(link: GraphLink) => {
                    const w = link.value || 1;
                    const alpha = Math.min(1, Math.log10(w + 1) / 3);
                    return `rgba(84, 84, 84, ${alpha})`;
                }}
                nodeCanvasObjectMode={() => "replace"}
                nodeCanvasObject={(node: GraphNode, ctx, globalScale) => {
                    if (node.id !== "grid_in" && node.id !== "grid_out") {
                        const label = "🏠";
                        /* 
                        const fontSize = 10 / globalScale; 
                        ctx.font = `${fontSize}px Sans-Serif`;
                        */
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.fillText(label, node.x ?? 0, node.y ?? 0);
                    } else {
                        const label = node.id === "grid_in" ? "🔌" : "🔋";
                        /* 
                        const fontSize = 16 / globalScale;
                        ctx.font = `${fontSize}px Sans-Serif`; 
                        */
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.fillText(label, node.x ?? 0, node.y ?? 0);
                    }
                }}
            />
        </ResponsiveContainer>
    );
};

export default TradingNetworkForceGraph;
