import type { SparqlSelectedEdge, SparqlSelectedNode } from "../sparql";
import type { Node as UnistNode, Parent as UnistParent } from "unist";

export interface SelectionAstNode extends UnistParent {
  type: "selectionNode";
  id: string;
  name: string;
  path_array: Array<string>;
  explicit: boolean;
  optional: boolean;
  count: boolean;
  children: Array<SelectionAstNode>;
}

export interface SelectionAst extends UnistParent {
  type: "selectionAst";
  rootId: string | null;
  children: Array<SelectionAstNode>;
  // Backward-compatible alias for existing callers.
  nodes: Array<SelectionAstNode>;
}

function readFieldString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readPathArray(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isEntityReferenceNode(node: SparqlSelectedNode): boolean {
  return readFieldString(node.path?.fields.fieldtype) === "entity_reference";
}

function getNodeName(node: SparqlSelectedNode): string {
  const fromPath = readFieldString(node.path?.fields.name);
  if (fromPath.length > 0) {
    return fromPath;
  }
  return node.sourcePathId || node.displayId;
}

export function buildSelectionAst({
  selectedNodes,
  selectedEdges,
  firstSelectedDisplayNodeId,
  explicitSelectedNodeIds,
  countNodeDisplayIds,
  makeAllEntityReferencesOptional = false,
  makeAllFieldsOptional = false,
}: {
  selectedNodes: Array<SparqlSelectedNode>;
  selectedEdges: Array<SparqlSelectedEdge>;
  firstSelectedDisplayNodeId: string | null;
  explicitSelectedNodeIds: Iterable<string>;
  countNodeDisplayIds: Iterable<string>;
  makeAllEntityReferencesOptional?: boolean;
  makeAllFieldsOptional?: boolean;
}): SelectionAst {
  const selectedNodeById = new Map(
    selectedNodes.map((node) => [node.displayId, node]),
  );
  const explicitSet = new Set(explicitSelectedNodeIds);
  const countSet = new Set(countNodeDisplayIds);
  const inboundReferenceBoundaryTargets = new Set<string>();

  for (const edge of selectedEdges) {
    if (!selectedNodeById.has(edge.sourceDisplayId)) {
      continue;
    }
    if (!selectedNodeById.has(edge.targetDisplayId)) {
      continue;
    }
    if (edge.isEntityReferenceBoundary) {
      inboundReferenceBoundaryTargets.add(edge.targetDisplayId);
    }
  }

  const adjacency = new Map<string, Array<string>>();
  for (const node of selectedNodes) {
    adjacency.set(node.displayId, []);
  }
  for (const edge of selectedEdges) {
    if (!adjacency.has(edge.sourceDisplayId) || !adjacency.has(edge.targetDisplayId)) {
      continue;
    }
    adjacency.get(edge.sourceDisplayId)!.push(edge.targetDisplayId);
  }
  for (const [displayId, children] of adjacency) {
    children.sort((a, b) => a.localeCompare(b));
    adjacency.set(displayId, children);
  }

  const rootId =
    firstSelectedDisplayNodeId && selectedNodeById.has(firstSelectedDisplayNodeId)
      ? firstSelectedDisplayNodeId
      : (Array.from(selectedNodeById.keys()).sort()[0] ?? null);

  const undirectedAdjacency = new Map<string, Array<string>>();
  for (const nodeId of selectedNodeById.keys()) {
    undirectedAdjacency.set(nodeId, []);
  }
  for (const edge of selectedEdges) {
    if (!selectedNodeById.has(edge.sourceDisplayId)) {
      continue;
    }
    if (!selectedNodeById.has(edge.targetDisplayId)) {
      continue;
    }
    undirectedAdjacency.get(edge.sourceDisplayId)!.push(edge.targetDisplayId);
    undirectedAdjacency.get(edge.targetDisplayId)!.push(edge.sourceDisplayId);
  }
  for (const [displayId, neighbors] of undirectedAdjacency) {
    neighbors.sort((a, b) => a.localeCompare(b));
    undirectedAdjacency.set(displayId, neighbors);
  }

  const parentById = new Map<string, string | null>();
  const visitOrder: Array<string> = [];
  const componentRoots: Array<string> = [];
  const visited = new Set<string>();
  const bfsFrom = (startId: string): void => {
    const queue: Array<string> = [startId];
    visited.add(startId);
    parentById.set(startId, null);
    componentRoots.push(startId);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]!;
      visitOrder.push(current);
      const neighbors = undirectedAdjacency.get(current) ?? [];
      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) {
          continue;
        }
        visited.add(neighbor);
        parentById.set(neighbor, current);
        queue.push(neighbor);
      }
    }
  };

  if (rootId) {
    bfsFrom(rootId);
  }
  for (const nodeId of Array.from(selectedNodeById.keys()).sort()) {
    if (!visited.has(nodeId)) {
      bfsFrom(nodeId);
    }
  }

  const nodesById = new Map<string, SelectionAstNode>();
  for (const displayId of visitOrder) {
    const node = selectedNodeById.get(displayId)!;
    const isMultiple = node.path?.multiple === true;
    const optionalFromReferenceBoundary =
      makeAllEntityReferencesOptional &&
      (isEntityReferenceNode(node) ||
        inboundReferenceBoundaryTargets.has(displayId));
    const optional =
      makeAllFieldsOptional || isMultiple || optionalFromReferenceBoundary;

    nodesById.set(displayId, {
      type: "selectionNode",
      id: displayId,
      name: getNodeName(node),
      path_array: readPathArray(node.path?.fields.path_array),
      explicit: explicitSet.has(displayId),
      optional,
      count: countSet.has(displayId),
      children: [],
    });
  }

  for (const [nodeId, parentId] of parentById.entries()) {
    if (!parentId) {
      continue;
    }
    const parent = nodesById.get(parentId);
    const child = nodesById.get(nodeId);
    if (!parent || !child) {
      continue;
    }
    parent.children.push(child);
  }

  const children = componentRoots
    .map((componentRootId) => nodesById.get(componentRootId))
    .filter((node): node is SelectionAstNode => node !== undefined);
  const nodes = visitOrder
    .map((id) => nodesById.get(id))
    .filter((node): node is SelectionAstNode => node !== undefined);

  return {
    type: "selectionAst",
    rootId,
    children,
    nodes,
  };
}
