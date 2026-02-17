import type { SparqlPathNode, SparqlSelectedEdge, SparqlSelectedNode } from "./sparql";

export interface PathSegments {
  pathArray: Array<string>;
  classes: Array<string>;
  predicates: Array<string>;
}

export function readFieldString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readPathArray(path: SparqlPathNode | undefined): Array<string> {
  const raw = path?.fields.path_array;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
}

export function splitPathArray(pathArray: Array<string>): PathSegments {
  return {
    pathArray,
    classes: pathArray.filter((_, index) => index % 2 === 0),
    predicates: pathArray.filter((_, index) => index % 2 === 1),
  };
}

export function readPathSegments(path: SparqlPathNode | undefined): PathSegments {
  return splitPathArray(readPathArray(path));
}

export function getSharedTokenPrefixLength(
  leftPathArray: Array<string>,
  rightPathArray: Array<string>,
): number {
  let length = 0;
  const maxLength = Math.min(leftPathArray.length, rightPathArray.length);
  while (
    length < maxLength &&
    leftPathArray[length] === rightPathArray[length]
  ) {
    length += 1;
  }
  return length;
}

export function buildPathTokenPrefixFromSegments({
  classes,
  predicates,
  stepIndex,
}: {
  classes: Array<string>;
  predicates: Array<string>;
  stepIndex: number;
}): Array<string> {
  if (classes.length === 0) {
    return [];
  }
  const tokens: Array<string> = [classes[0]];
  const clampedStepIndex = Math.max(0, Math.min(stepIndex, predicates.length));
  for (let i = 0; i < clampedStepIndex; i += 1) {
    tokens.push(predicates[i], classes[i + 1]);
  }
  return tokens;
}

export function buildPrefixVarLookupKey(
  boundaryContext: string,
  tokenPrefix: Array<string>,
): string {
  return `${boundaryContext}|${tokenPrefix.join("|")}`;
}

export function toVarSafeFragment(value: string | null | undefined): string {
  const safe = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (safe.length === 0) {
    return "path";
  }
  if (/^\d/.test(safe)) {
    return `p_${safe}`;
  }
  return safe;
}

export function isEntityReferenceNode(
  node: SparqlSelectedNode | undefined,
): boolean {
  if (!node?.path) {
    return false;
  }
  return readFieldString(node.path.fields.fieldtype) === "entity_reference";
}

export function computeDisplayDepths({
  selectedNodes,
  selectedEdges,
  firstSelectedDisplayNodeId,
}: {
  selectedNodes: Array<SparqlSelectedNode>;
  selectedEdges: Array<SparqlSelectedEdge>;
  firstSelectedDisplayNodeId: string | null;
}): Map<string, number> {
  const nodeIds = new Set(selectedNodes.map((node) => node.displayId));
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();

  for (const nodeId of nodeIds) {
    outgoing.set(nodeId, new Set());
    incoming.set(nodeId, new Set());
  }

  for (const edge of selectedEdges) {
    if (
      !nodeIds.has(edge.sourceDisplayId) ||
      !nodeIds.has(edge.targetDisplayId)
    ) {
      continue;
    }
    outgoing.get(edge.sourceDisplayId)!.add(edge.targetDisplayId);
    incoming.get(edge.targetDisplayId)!.add(edge.sourceDisplayId);
  }

  const depthByDisplayId = new Map<string, number>();
  const startId =
    firstSelectedDisplayNodeId && nodeIds.has(firstSelectedDisplayNodeId)
      ? firstSelectedDisplayNodeId
      : selectedNodes[0]?.displayId;

  if (startId) {
    const queue: Array<string> = [startId];
    depthByDisplayId.set(startId, 0);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentDepth = depthByDisplayId.get(current) ?? 0;

      const parents = Array.from(incoming.get(current) ?? []).sort();
      for (const parent of parents) {
        if (depthByDisplayId.has(parent)) {
          continue;
        }
        depthByDisplayId.set(parent, currentDepth - 1);
        queue.push(parent);
      }

      const children = Array.from(outgoing.get(current) ?? []).sort();
      for (const child of children) {
        if (depthByDisplayId.has(child)) {
          continue;
        }
        depthByDisplayId.set(child, currentDepth + 1);
        queue.push(child);
      }
    }
  }

  for (const nodeId of Array.from(nodeIds).sort()) {
    if (!depthByDisplayId.has(nodeId)) {
      depthByDisplayId.set(nodeId, 0);
    }
  }

  let minDepth = 0;
  for (const depth of depthByDisplayId.values()) {
    if (depth < minDepth) {
      minDepth = depth;
    }
  }
  if (minDepth < 0) {
    const shift = -minDepth;
    for (const nodeId of depthByDisplayId.keys()) {
      depthByDisplayId.set(nodeId, (depthByDisplayId.get(nodeId) ?? 0) + shift);
    }
  }

  return depthByDisplayId;
}

export function computeReferenceBoundaryContext({
  selectedNodes,
  selectedEdges,
  firstSelectedDisplayNodeId,
}: {
  selectedNodes: Array<SparqlSelectedNode>;
  selectedEdges: Array<SparqlSelectedEdge>;
  firstSelectedDisplayNodeId: string | null;
}): Map<string, string> {
  const nodeIds = new Set(selectedNodes.map((node) => node.displayId));
  const nodeByDisplayId = new Map(
    selectedNodes.map((node) => [node.displayId, node]),
  );
  const outgoing = new Map<string, Array<string>>();
  const incomingCount = new Map<string, number>();

  for (const nodeId of nodeIds) {
    outgoing.set(nodeId, []);
    incomingCount.set(nodeId, 0);
  }

  for (const edge of selectedEdges) {
    if (
      !nodeIds.has(edge.sourceDisplayId) ||
      !nodeIds.has(edge.targetDisplayId)
    ) {
      continue;
    }
    outgoing.get(edge.sourceDisplayId)!.push(edge.targetDisplayId);
    incomingCount.set(
      edge.targetDisplayId,
      (incomingCount.get(edge.targetDisplayId) ?? 0) + 1,
    );
  }

  for (const [nodeId, children] of outgoing.entries()) {
    children.sort();
    outgoing.set(nodeId, children);
  }

  const roots = Array.from(nodeIds)
    .filter((nodeId) => (incomingCount.get(nodeId) ?? 0) === 0)
    .sort();
  const preferredRoot =
    firstSelectedDisplayNodeId && nodeIds.has(firstSelectedDisplayNodeId)
      ? firstSelectedDisplayNodeId
      : null;
  if (preferredRoot) {
    const index = roots.indexOf(preferredRoot);
    if (index > 0) {
      roots.splice(index, 1);
      roots.unshift(preferredRoot);
    } else if (index === -1) {
      roots.unshift(preferredRoot);
    }
  }

  const contextByNodeId = new Map<string, string>();
  const queue: Array<string> = [];

  for (const rootId of roots) {
    if (!contextByNodeId.has(rootId)) {
      contextByNodeId.set(rootId, "root");
      queue.push(rootId);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const parentContext = contextByNodeId.get(current) ?? "root";
    const currentNode = nodeByDisplayId.get(current);
    const crossesReferenceBoundary = isEntityReferenceNode(currentNode);
    const nextBaseContext = crossesReferenceBoundary
      ? `${parentContext}|ref:${toVarSafeFragment(current)}`
      : parentContext;

    for (const child of outgoing.get(current) ?? []) {
      if (!contextByNodeId.has(child)) {
        contextByNodeId.set(child, nextBaseContext);
        queue.push(child);
      }
    }
  }

  for (const nodeId of Array.from(nodeIds).sort()) {
    if (!contextByNodeId.has(nodeId)) {
      contextByNodeId.set(nodeId, `root|orphan:${toVarSafeFragment(nodeId)}`);
    }
  }

  return contextByNodeId;
}

export function buildBehindCountSubgraphs({
  selectedNodes,
  selectedEdges,
  firstSelectedDisplayNodeId,
  countNodeDisplayIds,
}: {
  selectedNodes: Array<SparqlSelectedNode>;
  selectedEdges: Array<SparqlSelectedEdge>;
  firstSelectedDisplayNodeId: string | null;
  countNodeDisplayIds: Array<string>;
}): {
  excludedFromOuter: Set<string>;
  descendantsByCountNodeId: Map<string, Set<string>>;
  parentByCountNodeId: Map<string, string>;
} {
  const selectedIds = new Set(selectedNodes.map((node) => node.displayId));
  const adjacency = new Map<string, Set<string>>();
  for (const id of selectedIds) {
    adjacency.set(id, new Set<string>());
  }
  for (const edge of selectedEdges) {
    if (
      !selectedIds.has(edge.sourceDisplayId) ||
      !selectedIds.has(edge.targetDisplayId)
    ) {
      continue;
    }
    adjacency.get(edge.sourceDisplayId)!.add(edge.targetDisplayId);
    adjacency.get(edge.targetDisplayId)!.add(edge.sourceDisplayId);
  }

  const startId =
    firstSelectedDisplayNodeId && selectedIds.has(firstSelectedDisplayNodeId)
      ? firstSelectedDisplayNodeId
      : (selectedNodes[0]?.displayId ?? null);
  if (!startId) {
    return {
      excludedFromOuter: new Set<string>(),
      descendantsByCountNodeId: new Map(),
      parentByCountNodeId: new Map(),
    };
  }

  const children = new Map<string, Array<string>>();
  const parentByNodeId = new Map<string, string>();
  const connected = new Set<string>([startId]);
  const queue: Array<string> = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const sortedNeighbors = Array.from(adjacency.get(current) ?? []).sort();
    for (const neighbor of sortedNeighbors) {
      if (connected.has(neighbor)) {
        continue;
      }
      connected.add(neighbor);
      parentByNodeId.set(neighbor, current);
      const list = children.get(current) ?? [];
      list.push(neighbor);
      children.set(current, list);
      queue.push(neighbor);
    }
  }

  const excludedFromOuter = new Set<string>();
  const descendantsByCountNodeId = new Map<string, Set<string>>();
  const parentByCountNodeId = new Map<string, string>();

  for (const countId of countNodeDisplayIds) {
    if (!selectedIds.has(countId) || !connected.has(countId)) {
      continue;
    }
    const descendants = new Set<string>([countId]);
    excludedFromOuter.add(countId);
    const parentId = parentByNodeId.get(countId);
    if (parentId) {
      parentByCountNodeId.set(countId, parentId);
    }
    const stack = [...(children.get(countId) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (descendants.has(current)) {
        continue;
      }
      descendants.add(current);
      excludedFromOuter.add(current);
      for (const child of children.get(current) ?? []) {
        stack.push(child);
      }
    }
    descendantsByCountNodeId.set(countId, descendants);
  }

  return { excludedFromOuter, descendantsByCountNodeId, parentByCountNodeId };
}
