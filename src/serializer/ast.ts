import type { Parent } from "unist";

import type { NodeState, Scenario } from "../scenario";
import { createGraphFromScenario } from "./graph";
import type { Pathbuilder, PathbuilderPath } from "./pathbuilder";

interface AstNodeData {
  enteredThroughEntityReference: boolean;
  id: string;
  id_array: Array<string>;
  parentEdgeEntityReferencePath?: PathbuilderPath;
  selectedEntityReferenceNode: boolean;
  targetPath: PathbuilderPath;
  selected: NodeState["selected"];
}

export interface ModelAstNode extends Parent {
  children: Array<ModelAstNode>;
  data: AstNodeData;
  type: "modelNode";
}

export interface ModelSubgraphAst extends Parent {
  children: Array<ModelAstNode>;
  data: {
    edge_count: number;
    node_count: number;
    selected_count: number;
  };
  type: "selectedSubgraph";
}

function stringifyPath(path: Array<string>): string {
  return path.join("");
}

function toParentPath(path: Array<string>): Array<string> {
  return path.length > 1 ? path.slice(0, -2) : [];
}

function makeEdgeId(left: string, right: string): string {
  return left < right ? `${left}<->${right}` : `${right}<->${left}`;
}

function hasEntityReferenceTraversal(
  pathbuilder: null | Pathbuilder,
  idArray: Array<string>,
): boolean {
  if (pathbuilder == null) {
    return false;
  }

  for (let index = 2; index < idArray.length; index += 2) {
    const pathId = idArray[index];

    if (pathId == null) {
      continue;
    }

    if (pathbuilder.getPathById(pathId)?.entity_reference != null) {
      return true;
    }
  }

  return false;
}

function isSelectedEntityReferenceNode(
  pathbuilder: null | Pathbuilder,
  idArray: Array<string>,
): boolean {
  if (pathbuilder == null || idArray.length < 3) {
    return false;
  }

  const lastPathId = idArray.at(-1);

  if (lastPathId == null) {
    return false;
  }

  return pathbuilder.getPathById(lastPathId)?.entity_reference != null;
}

function buildGraph(edges: Array<{ source: string; target: string; id: string }>): {
  adjacency: Map<string, Array<string>>;
  edgeNodesById: Map<string, [string, string]>;
} {
  const adjacency = new Map<string, Array<string>>();
  const edgeNodesById = new Map<string, [string, string]>();

  for (const edge of edges) {
    const parentNeighbors = adjacency.get(edge.source) ?? [];
    parentNeighbors.push(edge.target);
    adjacency.set(edge.source, parentNeighbors);

    const childNeighbors = adjacency.get(edge.target) ?? [];
    childNeighbors.push(edge.source);
    adjacency.set(edge.target, childNeighbors);

    edgeNodesById.set(makeEdgeId(edge.source, edge.target), [edge.source, edge.target]);
  }

  return { adjacency, edgeNodesById };
}

function findPathEdges(
  adjacency: Map<string, Array<string>>,
  sourceId: string,
  targetId: string,
): Set<string> {
  const queue = [sourceId];
  const visited = new Set([sourceId]);
  const previousByNode = new Map<string, string>();

  while (queue.length > 0) {
    const nodeId = queue.shift()!;

    if (nodeId === targetId) {
      break;
    }

    const neighbors = adjacency.get(nodeId) ?? [];

    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) {
        continue;
      }

      visited.add(neighbor);
      previousByNode.set(neighbor, nodeId);
      queue.push(neighbor);
    }
  }

  const edgeIds = new Set<string>();
  let cursor = targetId;

  while (cursor !== sourceId) {
    const previous = previousByNode.get(cursor);

    if (previous == null) {
      break;
    }

    edgeIds.add(makeEdgeId(previous, cursor));
    cursor = previous;
  }

  return edgeIds;
}

export function createSelectedSubgraphAst(
  modelState: Scenario,
  pathbuilder: null | Pathbuilder,
): ModelSubgraphAst {
  const noopExpand = (_idPath: Array<string>) => void 0;
  const noopSelect = (_idPath: Array<string>, _count: boolean) => void 0;
  const graph = createGraphFromScenario(
    modelState,
    pathbuilder,
    noopExpand,
    noopExpand,
    noopSelect,
    noopExpand,
    noopExpand,
  );
  const graphNodes = graph.nodes;
  const parentEntityReferencePathByEdgeId = new Map<string, PathbuilderPath>();

  for (const edge of graph.edges) {
    const edgeData = edge.data as { entityReferencePath?: PathbuilderPath } | undefined;

    if (edgeData?.entityReferencePath == null) {
      continue;
    }

    parentEntityReferencePathByEdgeId.set(
      `${edge.source}->${edge.target}`,
      edgeData.entityReferencePath,
    );
  }
  const graphNodeById = new Map(graphNodes.map((node) => [node.id, node]));
  const firstSelectedScenarioNode = modelState.nodes.find((node) => node.selected != null);
  const firstSelectedNodeId =
    firstSelectedScenarioNode == null ? undefined : stringifyPath(firstSelectedScenarioNode.id);
  const selectedNodeIds = graphNodes
    .filter((node) => node.data.selected != null)
    .map((node) => node.id);
  const selectedNodeIdSet = new Set(selectedNodeIds);
  const hasSelectedRootModelType = graphNodes.some((node) => {
    return node.data.selected != null && node.data.id_array.length === 1;
  });

  const { adjacency, edgeNodesById } = buildGraph(graph.edges);
  const includedEdgeIds = new Set<string>();
  const includedNodeIds = new Set<string>(selectedNodeIds);

  for (const [sourceIndex, sourceId] of selectedNodeIds.entries()) {
    for (
      let targetIndex = sourceIndex + 1;
      targetIndex < selectedNodeIds.length;
      targetIndex += 1
    ) {
      const targetId = selectedNodeIds[targetIndex]!;
      const pathEdges = findPathEdges(adjacency, sourceId, targetId);

      for (const edgeId of pathEdges) {
        includedEdgeIds.add(edgeId);
        const edgeNodes = edgeNodesById.get(edgeId);

        if (edgeNodes != null) {
          includedNodeIds.add(edgeNodes[0]);
          includedNodeIds.add(edgeNodes[1]);
        }
      }
    }
  }

  for (const selectedNodeId of selectedNodeIds) {
    const selectedNode = graphNodeById.get(selectedNodeId);

    if (selectedNode == null) {
      continue;
    }

    let parentPath = toParentPath(selectedNode.data.id_array);

    while (parentPath.length > 0) {
      const parentNodeId = stringifyPath(parentPath);

      if (!graphNodeById.has(parentNodeId)) {
        break;
      }

      includedNodeIds.add(parentNodeId);
      parentPath = toParentPath(parentPath);
    }
  }

  const includedNodes = graphNodes.filter((node) => includedNodeIds.has(node.id));
  const astNodeById = new Map<string, ModelAstNode>();

  for (const node of includedNodes) {
    astNodeById.set(node.id, {
      children: [],
      data: {
        enteredThroughEntityReference: hasEntityReferenceTraversal(pathbuilder, node.data.id_array),
        id: node.id,
        id_array: node.data.id_array,
        parentEdgeEntityReferencePath: undefined,
        selectedEntityReferenceNode: isSelectedEntityReferenceNode(
          pathbuilder,
          node.data.id_array,
        ),
        selected: node.data.selected,
        targetPath: node.data.targetPath,
      },
      type: "modelNode",
    });
  }

  const preferredRootNodeIds = hasSelectedRootModelType
    ? selectedNodeIds.filter((nodeId) => {
        return (graphNodeById.get(nodeId)?.data.id_array.length ?? 0) === 1;
      })
    : firstSelectedNodeId != null && astNodeById.has(firstSelectedNodeId)
      ? [firstSelectedNodeId]
      : [];
  const visitedNodeIds = new Set<string>();
  const roots: Array<ModelAstNode> = [];

  function attachConnectedComponent(rootNodeId: string): void {
    if (visitedNodeIds.has(rootNodeId)) {
      return;
    }

    const rootAstNode = astNodeById.get(rootNodeId);

    if (rootAstNode == null) {
      return;
    }

    roots.push(rootAstNode);
    visitedNodeIds.add(rootNodeId);

    const queue = [rootNodeId];

    while (queue.length > 0) {
      const currentNodeId = queue.shift()!;
      const currentAstNode = astNodeById.get(currentNodeId);

      if (currentAstNode == null) {
        continue;
      }

      const neighbors = [...(adjacency.get(currentNodeId) ?? [])].sort((left, right) => {
        return left.localeCompare(right);
      });

      for (const neighborNodeId of neighbors) {
        if (!includedNodeIds.has(neighborNodeId) || visitedNodeIds.has(neighborNodeId)) {
          continue;
        }

        const neighborAstNode = astNodeById.get(neighborNodeId);

        if (neighborAstNode == null) {
          continue;
        }

        neighborAstNode.data.parentEdgeEntityReferencePath =
          parentEntityReferencePathByEdgeId.get(`${currentNodeId}->${neighborNodeId}`) ??
          parentEntityReferencePathByEdgeId.get(`${neighborNodeId}->${currentNodeId}`);
        currentAstNode.children.push(neighborAstNode);
        visitedNodeIds.add(neighborNodeId);
        queue.push(neighborNodeId);
      }
    }
  }

  for (const rootNodeId of preferredRootNodeIds) {
    attachConnectedComponent(rootNodeId);
  }

  const remainingRootNodeIds = includedNodes
    .map((node) => node.id)
    .filter((nodeId) => !visitedNodeIds.has(nodeId))
    .sort((left, right) => left.localeCompare(right));

  for (const rootNodeId of remainingRootNodeIds) {
    attachConnectedComponent(rootNodeId);
  }

  roots.sort((left, right) => {
    const leftPreferredIndex = preferredRootNodeIds.indexOf(left.data.id);
    const rightPreferredIndex = preferredRootNodeIds.indexOf(right.data.id);

    if (leftPreferredIndex !== -1 || rightPreferredIndex !== -1) {
      if (leftPreferredIndex === -1) {
        return 1;
      }

      if (rightPreferredIndex === -1) {
        return -1;
      }

      return leftPreferredIndex - rightPreferredIndex;
    }

    return left.data.id.localeCompare(right.data.id);
  });

  for (const astNode of astNodeById.values()) {
    astNode.children.sort((left, right) => left.data.id.localeCompare(right.data.id));
  }

  return {
    children: roots,
    data: {
      edge_count: includedEdgeIds.size,
      node_count: includedNodeIds.size,
      selected_count: selectedNodeIdSet.size,
    },
    type: "selectedSubgraph",
  };
}
