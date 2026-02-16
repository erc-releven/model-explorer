import { Parser } from "sparqljs";

import { TYPE_PREFIXES } from "./prefixes";

type PathFieldValue =
  | string
  | Array<PathFieldValue>
  | { [key: string]: PathFieldValue };
type PathFields = Record<string, PathFieldValue>;

export interface SparqlPathNode {
  id: string;
  multiple?: boolean;
  fields: PathFields;
}

export interface SparqlSelectedNode {
  displayId: string;
  sourcePathId: string;
  path: SparqlPathNode | undefined;
}

export interface SparqlSelectedEdge {
  sourceDisplayId: string;
  targetDisplayId: string;
  bridgePredicateIri?: string;
  isEntityReferenceBoundary?: boolean;
}

interface VariableTerm {
  termType: "Variable";
  value: string;
}
interface NamedNodeTerm {
  termType: "NamedNode";
  value: string;
}
type Term = VariableTerm | NamedNodeTerm;

interface Triple {
  subject: Term;
  predicate: Term;
  object: Term;
}

interface SelectQueryAst {
  type: "query";
  queryType: "SELECT";
  variables: Array<VariableTerm>;
  distinct: boolean;
  where: Array<{ type: "bgp"; triples: Array<Triple> }>;
  prefixes: Record<string, string>;
}

const RDF_TYPE_IRI = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

interface TripleWithDepth {
  key: string;
  triple: Triple;
  depth: number;
}

interface TripleEmission {
  id: string;
  key: string;
  depth: number;
  ownerDisplayId: string | null;
}

interface SelectProjection {
  variableName: string;
  depth: number;
  coalesceToZero?: boolean;
  sourceVariableName?: string;
  isCentral?: boolean;
}

interface RenderWhereSectionResult {
  whereLines: Array<string>;
  usedPrefixes: Set<string>;
}

function readFieldString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function v(name: string): VariableTerm {
  return { termType: "Variable", value: name };
}

function iri(value: string): NamedNodeTerm {
  return { termType: "NamedNode", value };
}

function triple(subject: Term, predicate: Term, object: Term): Triple {
  return { subject, predicate, object };
}

function termKey(term: Term): string {
  return `${term.termType}:${term.value}`;
}

function tripleKeyFromTriple(value: Triple): string {
  return `${termKey(value.subject)}|${termKey(value.predicate)}|${termKey(value.object)}`;
}

function remapVariableInTermMap(
  term: Term,
  variableMap: Map<string, string>,
): Term {
  if (term.termType !== "Variable") {
    return term;
  }
  const replacement = variableMap.get(term.value);
  if (!replacement) {
    return term;
  }
  return v(replacement);
}

function readPathArray(path: SparqlPathNode | undefined): Array<string> {
  const raw = path?.fields.path_array;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
}

function toVarSafeFragment(value: string | null | undefined): string {
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

function computeDisplayDepths({
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

function isEntityReferenceNode(node: SparqlSelectedNode | undefined): boolean {
  if (!node?.path) {
    return false;
  }
  return readFieldString(node.path.fields.fieldtype) === "entity_reference";
}

function computeReferenceBoundaryContext({
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

function buildSelectAst({
  selectedNodes,
  selectedEdges,
  firstSelectedDisplayNodeId,
  includeFullPrefixConstraintsWhenCentralNotTopModel = false,
}: {
  selectedNodes: Array<SparqlSelectedNode>;
  selectedEdges: Array<SparqlSelectedEdge>;
  firstSelectedDisplayNodeId: string | null;
  includeFullPrefixConstraintsWhenCentralNotTopModel?: boolean;
}): {
  ast: SelectQueryAst;
  triplesWithDepth: Array<TripleWithDepth>;
  orderedEmissions: Array<TripleEmission>;
  transitionCommentsByEmissionId: Map<string, Array<string>>;
  selectProjections: Array<SelectProjection>;
  optionalChainByDisplayId: Map<string, Array<string>>;
  resolvedSelectVariableByDisplayId: Map<string, string>;
} {
  const selectedNodeByDisplayId = new Map(
    selectedNodes.map((node) => [node.displayId, node]),
  );
  const depthByDisplayId = computeDisplayDepths({
    selectedNodes,
    selectedEdges,
    firstSelectedDisplayNodeId,
  });
  const boundaryContextByDisplayId = computeReferenceBoundaryContext({
    selectedNodes,
    selectedEdges,
    firstSelectedDisplayNodeId,
  });
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  const incomingCount = new Map<string, number>();
  const allDisplayIds = selectedNodes.map((node) => node.displayId);

  for (const displayId of allDisplayIds) {
    outgoing.set(displayId, new Set());
    incoming.set(displayId, new Set());
    incomingCount.set(displayId, 0);
  }

  for (const edge of selectedEdges) {
    if (
      !selectedNodeByDisplayId.has(edge.sourceDisplayId) ||
      !selectedNodeByDisplayId.has(edge.targetDisplayId)
    ) {
      continue;
    }
    outgoing.get(edge.sourceDisplayId)!.add(edge.targetDisplayId);
    incoming.get(edge.targetDisplayId)!.add(edge.sourceDisplayId);
    incomingCount.set(
      edge.targetDisplayId,
      (incomingCount.get(edge.targetDisplayId) ?? 0) + 1,
    );
  }

  const preferredStartId =
    firstSelectedDisplayNodeId &&
    selectedNodeByDisplayId.has(firstSelectedDisplayNodeId)
      ? firstSelectedDisplayNodeId
      : (selectedNodes[0]?.displayId ?? null);
  const roots = allDisplayIds
    .filter((displayId) => (incomingCount.get(displayId) ?? 0) === 0)
    .sort();
  if (preferredStartId) {
    const preferredRootIndex = roots.indexOf(preferredStartId);
    if (preferredRootIndex > 0) {
      roots.splice(preferredRootIndex, 1);
      roots.unshift(preferredStartId);
    } else if (preferredRootIndex === -1) {
      roots.unshift(preferredStartId);
    }
  }

  const orderedDisplayIds: Array<string> = [];
  const orderedSet = new Set<string>();
  const parentByDisplayId = new Map<string, string>();
  const upstreamTransitionKeys = new Set<string>();

  function appendDisplayId(displayId: string): void {
    if (orderedSet.has(displayId)) {
      return;
    }
    orderedSet.add(displayId);
    orderedDisplayIds.push(displayId);
  }

  function visitDownstreamDfs(currentId: string): void {
    appendDisplayId(currentId);
    const children = Array.from(outgoing.get(currentId) ?? []).sort();
    for (const childId of children) {
      if (!parentByDisplayId.has(childId)) {
        parentByDisplayId.set(childId, currentId);
      }
      if (!orderedSet.has(childId)) {
        visitDownstreamDfs(childId);
      }
    }
  }

  if (preferredStartId) {
    // Upstream traversal in postorder => ancestors first, selected node last.
    const upstreamVisited = new Set<string>();
    const upstreamPostOrder: Array<string> = [];

    function visitUpstreamPostOrder(currentId: string): void {
      if (upstreamVisited.has(currentId)) {
        return;
      }
      upstreamVisited.add(currentId);

      const parents = Array.from(incoming.get(currentId) ?? []).sort();
      for (const parentId of parents) {
        if (!parentByDisplayId.has(currentId)) {
          parentByDisplayId.set(currentId, parentId);
        }
        upstreamTransitionKeys.add(`${parentId}=>${currentId}`);
        visitUpstreamPostOrder(parentId);
      }

      upstreamPostOrder.push(currentId);
    }

    visitUpstreamPostOrder(preferredStartId);
    for (const upstreamId of upstreamPostOrder) {
      if (upstreamId === preferredStartId) {
        continue;
      }
      appendDisplayId(upstreamId);
    }

    appendDisplayId(preferredStartId);
    visitDownstreamDfs(preferredStartId);
  }

  // Fallback for disconnected/remaining selected nodes.
  for (const rootId of roots) {
    if (!orderedSet.has(rootId)) {
      visitDownstreamDfs(rootId);
    }
  }
  for (const displayId of [...allDisplayIds].sort()) {
    if (!orderedSet.has(displayId)) {
      visitDownstreamDfs(displayId);
    }
  }

  const optionalChainByDisplayId = new Map<string, Array<string>>();
  const optionalChainMemo = new Map<string, Array<string>>();
  const optionalChainInProgress = new Set<string>();
  const centralDisplayId = preferredStartId;
  const isMultipleNode = (displayId: string): boolean =>
    selectedNodeByDisplayId.get(displayId)?.path?.multiple === true;
  const getOptionalChain = (displayId: string): Array<string> => {
    const memoized = optionalChainMemo.get(displayId);
    if (memoized) {
      return memoized;
    }
    if (optionalChainInProgress.has(displayId)) {
      return [];
    }
    if (displayId === centralDisplayId) {
      optionalChainMemo.set(displayId, []);
      return [];
    }
    optionalChainInProgress.add(displayId);
    const parentId = parentByDisplayId.get(displayId) ?? null;
    const parentChain = parentId ? getOptionalChain(parentId) : [];
    // Keep a single OPTIONAL boundary per branch: once an ancestor is optional,
    // descendants stay in that same OPTIONAL instead of nesting redundant OPTIONALs.
    const chain =
      parentChain.length > 0
        ? [...parentChain]
        : isMultipleNode(displayId)
          ? [displayId]
          : [];
    optionalChainInProgress.delete(displayId);
    optionalChainMemo.set(displayId, chain);
    return chain;
  };
  for (const displayId of orderedDisplayIds) {
    optionalChainByDisplayId.set(displayId, getOptionalChain(displayId));
  }

  const sourceIdOccurrences = new Map<string, number>();
  const preferredSelectVariableByDisplayId = new Map<string, string>();

  for (const displayId of orderedDisplayIds) {
    const node = selectedNodeByDisplayId.get(displayId);
    if (!node) {
      continue;
    }

    const base = toVarSafeFragment(node.sourcePathId);
    const count = sourceIdOccurrences.get(base) ?? 0;
    sourceIdOccurrences.set(base, count + 1);
    const variableName =
      count === 0 ? `${base}_node` : `${base}_node_${String(count + 1)}`;
    preferredSelectVariableByDisplayId.set(displayId, variableName);
  }

  const triples: Array<Triple> = [];
  const triplesWithDepth: Array<TripleWithDepth> = [];
  const tripleByKey = new Map<string, TripleWithDepth>();
  const emissionOrder: Array<TripleEmission> = [];
  const prefixVarByKey = new Map<string, string>();
  const resolvedSelectVariableByDisplayId = new Map<string, string>();
  const firstEmissionIdByDisplayId = new Map<string, string>();
  const transitionCommentsByEmissionId = new Map<string, Array<string>>();
  const nodeNameByDisplayId = new Map<string, string>();
  let emissionCounter = 0;

  function addTriple(
    subject: Term,
    predicate: Term,
    object: Term,
    depth: number,
    ownerDisplayId: string | null,
  ): { key: string; isNew: boolean; emissionId: string } {
    const subjectKey = `${subject.termType}:${subject.value}`;
    const predicateKey = `${predicate.termType}:${predicate.value}`;
    const objectKey = `${object.termType}:${object.value}`;
    const key = `${subjectKey}|${predicateKey}|${objectKey}`;
    const normalizedDepth = Math.max(0, depth);
    const emissionId = `e${String(emissionCounter)}`;
    emissionCounter += 1;

    if (!tripleByKey.has(key)) {
      const nextTriple = triple(subject, predicate, object);
      const next: TripleWithDepth = {
        key,
        triple: nextTriple,
        depth: normalizedDepth,
      };
      triples.push(nextTriple);
      triplesWithDepth.push(next);
      tripleByKey.set(key, next);
      emissionOrder.push({
        id: emissionId,
        key,
        depth: normalizedDepth,
        ownerDisplayId,
      });
      return { key, isNew: true, emissionId };
    } else {
      const existing = tripleByKey.get(key)!;
      if (normalizedDepth < existing.depth) {
        existing.depth = normalizedDepth;
      }
      emissionOrder.push({
        id: emissionId,
        key,
        depth: normalizedDepth,
        ownerDisplayId,
      });
      return { key, isNew: false, emissionId };
    }
  }

  function moveEmissionBefore(
    emissionId: string,
    anchorEmissionId: string,
  ): void {
    if (emissionId === anchorEmissionId) {
      return;
    }
    const emissionIndex = emissionOrder.findIndex(
      (entry) => entry.id === emissionId,
    );
    const anchorIndex = emissionOrder.findIndex(
      (entry) => entry.id === anchorEmissionId,
    );
    if (emissionIndex < 0 || anchorIndex < 0) {
      return;
    }

    const [entry] = emissionOrder.splice(emissionIndex, 1);
    const nextAnchorIndex = emissionOrder.findIndex(
      (candidate) => candidate.id === anchorEmissionId,
    );
    if (nextAnchorIndex < 0) {
      emissionOrder.push(entry);
      return;
    }
    emissionOrder.splice(nextAnchorIndex, 0, entry);
  }

  const getNodeName = (displayId: string): string => {
    const cached = nodeNameByDisplayId.get(displayId);
    if (cached) {
      return cached;
    }
    const node = selectedNodeByDisplayId.get(displayId);
    const explicitName = readFieldString(node?.path?.fields.name);
    const raw =
      explicitName.length > 0
        ? explicitName
        : (node?.sourcePathId ?? displayId);
    const normalized = raw.length > 0 ? raw : displayId;
    nodeNameByDisplayId.set(displayId, normalized);
    return normalized;
  };

  function addTransitionComment(
    anchorEmissionId: string,
    comment: string,
  ): void {
    if (!transitionCommentsByEmissionId.has(anchorEmissionId)) {
      transitionCommentsByEmissionId.set(anchorEmissionId, []);
    }
    const entries = transitionCommentsByEmissionId.get(anchorEmissionId)!;
    if (!entries.includes(comment)) {
      entries.push(comment);
    }
  }

  function getOrCreatePrefixVar(
    key: string,
    preferredVarName: string,
    fallbackSuffix: string,
  ): string {
    const existing = prefixVarByKey.get(key);
    if (existing) {
      return existing;
    }

    let candidate = preferredVarName;
    let index = 1;
    const existingVars = new Set(prefixVarByKey.values());
    while (existingVars.has(candidate)) {
      index += 1;
      candidate = `${preferredVarName}_${fallbackSuffix}_${String(index)}`;
    }
    prefixVarByKey.set(key, candidate);
    return candidate;
  }

  function emitPathRecursively({
    baseVarName,
    tokenPrefix,
    classes,
    predicates,
    stepIndex,
    displayDepth,
    boundaryContext,
    selectedVarName,
    sourceVarBase,
    ownerDisplayId,
  }: {
    baseVarName: string;
    tokenPrefix: Array<string>;
    classes: Array<string>;
    predicates: Array<string>;
    stepIndex: number;
    displayDepth: number;
    boundaryContext: string;
    selectedVarName: string;
    sourceVarBase: string;
    ownerDisplayId: string;
  }): string {
    if (stepIndex >= predicates.length) {
      return baseVarName;
    }

    const rawPredicate = predicates[stepIndex];
    const isInverse = rawPredicate.startsWith("^");
    const predicateIri = rawPredicate.replace(/^\^/, "");
    const predicateNode = iri(predicateIri);
    const nextTokenPrefix = [...tokenPrefix, rawPredicate];
    const depth = displayDepth;

    if (stepIndex + 1 < classes.length) {
      const nextClassRaw = classes[stepIndex + 1];
      const nextClass = nextClassRaw.replace(/^\^/, "");
      const nextPrefixTokens = [...nextTokenPrefix, nextClassRaw];
      const nextPrefixKey = includeFullPrefixConstraintsWhenCentralNotTopModel
        ? `${boundaryContext}|classPrefix:${nextPrefixTokens.join("|")}|owner:${ownerDisplayId}`
        : `${boundaryContext}|classPrefix:${nextPrefixTokens.join("|")}`;
      const isTerminalSelectedNode = stepIndex + 1 === classes.length - 1;
      const preferredVarName = isTerminalSelectedNode
        ? selectedVarName
        : `${sourceVarBase}_step_${String(stepIndex + 1)}`;
      const nextVarName = getOrCreatePrefixVar(
        nextPrefixKey,
        preferredVarName,
        `step_${String(stepIndex + 1)}`,
      );

      addTriple(
        v(isInverse ? nextVarName : baseVarName),
        predicateNode,
        v(isInverse ? baseVarName : nextVarName),
        depth,
        ownerDisplayId,
      );
      addTriple(
        v(nextVarName),
        iri(RDF_TYPE_IRI),
        iri(nextClass),
        depth,
        ownerDisplayId,
      );

      return emitPathRecursively({
        baseVarName: nextVarName,
        tokenPrefix: nextPrefixTokens,
        classes,
        predicates,
        stepIndex: stepIndex + 1,
        displayDepth,
        boundaryContext,
        selectedVarName,
        sourceVarBase,
        ownerDisplayId,
      });
    }

    const valuePrefixKey = includeFullPrefixConstraintsWhenCentralNotTopModel
      ? `${boundaryContext}|valuePrefix:${nextTokenPrefix.join("|")}|owner:${ownerDisplayId}`
      : `${boundaryContext}|valuePrefix:${nextTokenPrefix.join("|")}`;
    const valueVarName = getOrCreatePrefixVar(
      valuePrefixKey,
      selectedVarName,
      "value",
    );
    addTriple(
      v(isInverse ? valueVarName : baseVarName),
      predicateNode,
      v(isInverse ? baseVarName : valueVarName),
      depth,
      ownerDisplayId,
    );
    return valueVarName;
  }

  for (const displayId of orderedDisplayIds) {
    const node = selectedNodeByDisplayId.get(displayId);
    if (!node) {
      continue;
    }

    const pathArray = readPathArray(node.path);
    if (pathArray.length === 0) {
      continue;
    }

    const classes = pathArray.filter((_, index) => index % 2 === 0);
    const predicates = pathArray.filter((_, index) => index % 2 === 1);
    if (classes.length === 0) {
      continue;
    }

    const selectedVarName =
      preferredSelectVariableByDisplayId.get(displayId) ??
      `${toVarSafeFragment(node.sourcePathId)}_node`;
    const sourceVarBase = toVarSafeFragment(node.sourcePathId);
    const displayDepth = depthByDisplayId.get(displayId) ?? 0;
    const boundaryContext = boundaryContextByDisplayId.get(displayId) ?? "root";

    const rootClass = classes[0].replace(/^\^/, "");
    const rootPrefixKey = includeFullPrefixConstraintsWhenCentralNotTopModel
      ? `${boundaryContext}|class:${rootClass}|owner:${displayId}`
      : `${boundaryContext}|class:${rootClass}`;
    const rootVarName = getOrCreatePrefixVar(
      rootPrefixKey,
      `${sourceVarBase}_root`,
      "root",
    );
    const rootTriple = addTriple(
      v(rootVarName),
      iri(RDF_TYPE_IRI),
      iri(rootClass),
      displayDepth,
      displayId,
    );
    firstEmissionIdByDisplayId.set(displayId, rootTriple.emissionId);

    const resolvedVar = emitPathRecursively({
      baseVarName: rootVarName,
      tokenPrefix: [classes[0]],
      classes,
      predicates,
      stepIndex: 0,
      displayDepth,
      boundaryContext,
      selectedVarName,
      sourceVarBase,
      ownerDisplayId: displayId,
    });
    resolvedSelectVariableByDisplayId.set(displayId, resolvedVar);
  }

  for (const edge of selectedEdges) {
    const rawBridgePredicate = edge.bridgePredicateIri?.trim() ?? "";
    if (rawBridgePredicate.length === 0) {
      continue;
    }

    const sourceVar = resolvedSelectVariableByDisplayId.get(
      edge.sourceDisplayId,
    );
    const targetVar = resolvedSelectVariableByDisplayId.get(
      edge.targetDisplayId,
    );
    if (!sourceVar || !targetVar) {
      continue;
    }

    const isInverse = rawBridgePredicate.startsWith("^");
    const bridgePredicateIri = rawBridgePredicate.replace(/^\^/, "");
    const bridgeDepth = depthByDisplayId.get(edge.targetDisplayId) ?? 0;
    const bridgeTriple = addTriple(
      v(isInverse ? targetVar : sourceVar),
      iri(bridgePredicateIri),
      v(isInverse ? sourceVar : targetVar),
      bridgeDepth,
      edge.targetDisplayId,
    );

    const childAnchorEmissionId = firstEmissionIdByDisplayId.get(
      edge.targetDisplayId,
    );
    const edgeTransitionKey = `${edge.sourceDisplayId}=>${edge.targetDisplayId}`;
    const edgeArrow = upstreamTransitionKeys.has(edgeTransitionKey)
      ? "<<-"
      : "->>";
    const edgeComment = `# ${getNodeName(edge.sourceDisplayId)} ${edgeArrow} ${getNodeName(edge.targetDisplayId)}`;
    addTransitionComment(bridgeTriple.emissionId, edgeComment);
    if (childAnchorEmissionId) {
      moveEmissionBefore(bridgeTriple.emissionId, childAnchorEmissionId);
    }
  }

  const bridgeTransitionKeys = new Set<string>();
  const entityReferenceTransitionKeys = new Set<string>();
  for (const edge of selectedEdges) {
    const rawBridgePredicate = edge.bridgePredicateIri?.trim() ?? "";
    const transitionKey = `${edge.sourceDisplayId}=>${edge.targetDisplayId}`;
    if (rawBridgePredicate.length === 0) {
      if (edge.isEntityReferenceBoundary) {
        entityReferenceTransitionKeys.add(transitionKey);
      }
      continue;
    }
    bridgeTransitionKeys.add(transitionKey);
    entityReferenceTransitionKeys.add(transitionKey);
  }

  const handledTransitionKeys = new Set<string>();
  const nonBridgeEdgeTransitions = selectedEdges
    .map((edge) => ({
      source: edge.sourceDisplayId,
      target: edge.targetDisplayId,
      key: `${edge.sourceDisplayId}=>${edge.targetDisplayId}`,
    }))
    .filter((transition) => !bridgeTransitionKeys.has(transition.key))
    .sort((a, b) => {
      if (a.source !== b.source) {
        return a.source.localeCompare(b.source);
      }
      return a.target.localeCompare(b.target);
    });

  for (const transition of nonBridgeEdgeTransitions) {
    const anchorEmissionId = firstEmissionIdByDisplayId.get(transition.target);
    if (!anchorEmissionId) {
      continue;
    }

    const isEntityReferenceTransition = entityReferenceTransitionKeys.has(
      transition.key,
    );
    const arrow = isEntityReferenceTransition
      ? upstreamTransitionKeys.has(transition.key)
        ? "<<-"
        : "->>"
      : ">";
    addTransitionComment(
      anchorEmissionId,
      `# ${getNodeName(transition.source)} ${arrow} ${getNodeName(transition.target)}`,
    );
    handledTransitionKeys.add(transition.key);
  }

  for (const [childDisplayId, parentDisplayId] of parentByDisplayId.entries()) {
    const anchorEmissionId = firstEmissionIdByDisplayId.get(childDisplayId);
    if (!anchorEmissionId) {
      continue;
    }

    const transitionKey = `${parentDisplayId}=>${childDisplayId}`;
    if (handledTransitionKeys.has(transitionKey)) {
      continue;
    }
    if (bridgeTransitionKeys.has(transitionKey)) {
      continue;
    }

    const isEntityReferenceTransition =
      entityReferenceTransitionKeys.has(transitionKey);
    const arrow = isEntityReferenceTransition
      ? upstreamTransitionKeys.has(transitionKey)
        ? "<<-"
        : "->>"
      : ">";
    const comment = `# ${getNodeName(parentDisplayId)} ${arrow} ${getNodeName(childDisplayId)}`;
    addTransitionComment(anchorEmissionId, comment);
  }

  if (preferredStartId) {
    const centralAnchorEmissionId =
      firstEmissionIdByDisplayId.get(preferredStartId);
    if (centralAnchorEmissionId) {
      addTransitionComment(
        centralAnchorEmissionId,
        `# >>>> Central node: ${getNodeName(preferredStartId)} <<<<`,
      );
    }
  }

  const prefixes = TYPE_PREFIXES.reduce<Record<string, string>>(
    (acc, entry) => {
      acc[entry.prefix] = entry.iri;
      return acc;
    },
    {},
  );

  const resolvedProjectionVars: Array<SelectProjection> = [];
  for (const displayId of orderedDisplayIds) {
    const variableName = resolvedSelectVariableByDisplayId.get(displayId);
    if (!variableName) {
      continue;
    }
    resolvedProjectionVars.push({
      variableName,
      depth: depthByDisplayId.get(displayId) ?? 0,
      isCentral: displayId === preferredStartId,
    });
  }
  const uniqueProjectionVars: Array<string> = [];
  const selectProjections: Array<SelectProjection> = [];
  const seenProjectionVars = new Set<string>();
  for (const projection of resolvedProjectionVars) {
    if (!seenProjectionVars.has(projection.variableName)) {
      seenProjectionVars.add(projection.variableName);
      uniqueProjectionVars.push(projection.variableName);
      selectProjections.push(projection);
    } else if (projection.isCentral) {
      const existing = selectProjections.find(
        (entry) => entry.variableName === projection.variableName,
      );
      if (existing) {
        existing.isCentral = true;
      }
    }
  }
  const variables = uniqueProjectionVars.map((name) => v(name));

  return {
    ast: {
      type: "query",
      queryType: "SELECT",
      variables,
      distinct: true,
      where: [{ type: "bgp", triples }],
      prefixes,
    },
    triplesWithDepth,
    orderedEmissions: emissionOrder,
    transitionCommentsByEmissionId,
    selectProjections,
    optionalChainByDisplayId,
    resolvedSelectVariableByDisplayId,
  };
}

function toCompactIri(value: string, prefixes: Record<string, string>): string {
  if (value === RDF_TYPE_IRI) {
    return "a";
  }

  for (const entry of TYPE_PREFIXES) {
    const iriPrefix = prefixes[entry.prefix];
    if (iriPrefix && value.startsWith(iriPrefix)) {
      return `${entry.prefix}:${value.slice(iriPrefix.length)}`;
    }
  }
  return `<${value}>`;
}

function findUsedPrefixForIri(
  value: string,
  prefixes: Record<string, string>,
): string | null {
  for (const entry of TYPE_PREFIXES) {
    const iriPrefix = prefixes[entry.prefix];
    if (iriPrefix && value.startsWith(iriPrefix)) {
      return entry.prefix;
    }
  }
  return null;
}

function renderTerm(term: Term, prefixes: Record<string, string>): string {
  if (term.termType === "Variable") {
    return `?${term.value}`;
  }
  return toCompactIri(term.value, prefixes);
}

function isCentralNodeComment(comment: string): boolean {
  return /^#\s*>+\s*Central node:/i.test(comment.trim());
}

function renderWhereSection(
  ast: SelectQueryAst,
  triplesWithDepth: Array<TripleWithDepth>,
  orderedEmissions: Array<TripleEmission>,
  transitionCommentsByEmissionId: Map<string, Array<string>>,
  optionalChainByDisplayId: Map<string, Array<string>>,
  excludedTripleKeys: Set<string> = new Set<string>(),
  includeCentralNodeComment = true,
): RenderWhereSectionResult {
  const byKey = new Map(triplesWithDepth.map((entry) => [entry.key, entry]));
  const whereEmissions = orderedEmissions
    .map((emission) => {
      const tripleEntry = byKey.get(emission.key);
      if (!tripleEntry) {
        return null;
      }
      return { emission, tripleEntry };
    })
    .filter(
      (
        value,
      ): value is { emission: TripleEmission; tripleEntry: TripleWithDepth } =>
        Boolean(value),
    );
  const usedPrefixes = new Set<string>();
  const seenPrefixTripleKeys = new Set<string>();
  for (const { tripleEntry } of whereEmissions) {
    if (excludedTripleKeys.has(tripleEntry.key)) {
      continue;
    }
    if (seenPrefixTripleKeys.has(tripleEntry.key)) {
      continue;
    }
    seenPrefixTripleKeys.add(tripleEntry.key);
    const row = tripleEntry.triple;
    const terms = [row.subject, row.predicate, row.object];
    for (const term of terms) {
      if (term.termType !== "NamedNode") {
        continue;
      }
      const usedPrefix = findUsedPrefixForIri(term.value, ast.prefixes);
      if (usedPrefix) {
        usedPrefixes.add(usedPrefix);
      }
    }
  }
  const whereLines: Array<string> = [];
  const openOptionals: Array<{ rootDisplayId: string; depth: number }> = [];
  const seenRenderedTripleKeys = new Set<string>();
  for (const { emission, tripleEntry } of whereEmissions) {
    const row = tripleEntry.triple;
    const isDuplicateTripleEmission =
      excludedTripleKeys.has(tripleEntry.key) ||
      seenRenderedTripleKeys.has(tripleEntry.key);
    const targetChain =
      emission.ownerDisplayId !== null
        ? (optionalChainByDisplayId.get(emission.ownerDisplayId) ?? [])
        : [];

    const indent = "  ".repeat(emission.depth + 1);
    const comments = transitionCommentsByEmissionId.get(emission.id) ?? [];
    const centralComments = includeCentralNodeComment
      ? comments.filter(isCentralNodeComment)
      : [];
    const regularComments = comments.filter(
      (comment) => !isCentralNodeComment(comment),
    );

    for (const comment of regularComments) {
      whereLines.push("");
      whereLines.push(`${indent}${comment}`);
    }

    if (centralComments.length > 0) {
      let centralLcp = 0;
      while (
        centralLcp < openOptionals.length &&
        centralLcp < targetChain.length &&
        openOptionals[centralLcp].rootDisplayId === targetChain[centralLcp]
      ) {
        centralLcp += 1;
      }
      while (openOptionals.length > centralLcp) {
        const closing = openOptionals.pop()!;
        whereLines.push(`${"  ".repeat(closing.depth + 1)}}`);
      }

      for (const comment of centralComments) {
        whereLines.push("");
        whereLines.push(comment);
      }
    }

    if (isDuplicateTripleEmission) {
      continue;
    }

    let lcp = 0;
    while (
      lcp < openOptionals.length &&
      lcp < targetChain.length &&
      openOptionals[lcp].rootDisplayId === targetChain[lcp]
    ) {
      lcp += 1;
    }
    while (openOptionals.length > lcp) {
      const closing = openOptionals.pop()!;
      whereLines.push(`${"  ".repeat(closing.depth + 1)}}`);
    }
    for (let i = lcp; i < targetChain.length; i += 1) {
      openOptionals.push({
        rootDisplayId: targetChain[i],
        depth: emission.depth,
      });
      whereLines.push(`${indent}OPTIONAL {`);
    }
    seenRenderedTripleKeys.add(tripleEntry.key);
    whereLines.push(
      `${indent}${renderTerm(row.subject, ast.prefixes)} ${renderTerm(row.predicate, ast.prefixes)} ${renderTerm(row.object, ast.prefixes)} .`,
    );
  }
  while (openOptionals.length > 0) {
    const closing = openOptionals.pop()!;
    whereLines.push(`${"  ".repeat(closing.depth + 1)}}`);
  }

  return { whereLines, usedPrefixes };
}

function renderQuery(
  ast: SelectQueryAst,
  triplesWithDepth: Array<TripleWithDepth>,
  orderedEmissions: Array<TripleEmission>,
  transitionCommentsByEmissionId: Map<string, Array<string>>,
  selectProjections: Array<SelectProjection>,
  optionalChainByDisplayId: Map<string, Array<string>>,
  extraSelectProjections: Array<SelectProjection>,
  extraWhereBlocks: Array<Array<string>>,
  extraUsedPrefixes: Set<string>,
  orderByVariableName?: string,
  orderByDirection: "ASC" | "DESC" = "DESC",
): string {
  const selectLines =
    [...selectProjections, ...extraSelectProjections].length > 0
      ? [...selectProjections, ...extraSelectProjections].map(
          (projection) =>
            `${"  ".repeat(projection.depth + 1)}${
              projection.coalesceToZero
                ? `(COALESCE(?${projection.sourceVariableName ?? projection.variableName}, 0) AS ?${projection.variableName})`
                : `?${projection.variableName}`
            }${projection.isCentral ? "  # <<<<< central node" : ""}`,
        )
      : ["  *"];
  const renderedWhere = renderWhereSection(
    ast,
    triplesWithDepth,
    orderedEmissions,
    transitionCommentsByEmissionId,
    optionalChainByDisplayId,
  );
  const allUsedPrefixes = new Set<string>(renderedWhere.usedPrefixes);
  for (const prefix of extraUsedPrefixes) {
    allUsedPrefixes.add(prefix);
  }
  const prefixLines = TYPE_PREFIXES.filter((entry) =>
    allUsedPrefixes.has(entry.prefix),
  ).map((entry) => `PREFIX ${entry.prefix}: <${ast.prefixes[entry.prefix]}>`);
  const whereLines = [...renderedWhere.whereLines];
  for (const block of extraWhereBlocks) {
    if (whereLines.length > 0) {
      whereLines.push("");
    }
    whereLines.push(...block);
  }

  return [
    ...prefixLines,
    "",
    "SELECT DISTINCT",
    ...selectLines,
    "WHERE {",
    ...whereLines,
    "}",
    ...(orderByVariableName
      ? [`ORDER BY ${orderByDirection}(?${orderByVariableName})`]
      : []),
  ].join("\n");
}

function buildBehindCountSubgraphs({
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

export function generateSparqlQuery({
  firstSelectedDisplayNodeId,
  selectedNodes,
  selectedEdges,
  countNodeDisplayIds,
  includeZeroCountResults: _includeZeroCountResults = false,
  includeFullPrefixConstraintsWhenCentralNotTopModel = false,
  orderByVariableName,
  orderByDirection = "DESC",
}: {
  firstSelectedDisplayNodeId: string | null;
  selectedNodes: Array<SparqlSelectedNode>;
  selectedEdges: Array<SparqlSelectedEdge>;
  countNodeDisplayIds: Array<string>;
  includeZeroCountResults?: boolean;
  includeFullPrefixConstraintsWhenCentralNotTopModel?: boolean;
  orderByVariableName?: string;
  orderByDirection?: "ASC" | "DESC";
}): string {
  const fullDepthByDisplayId = computeDisplayDepths({
    selectedNodes,
    selectedEdges,
    firstSelectedDisplayNodeId,
  });
  const { excludedFromOuter, descendantsByCountNodeId, parentByCountNodeId } =
    buildBehindCountSubgraphs({
      selectedNodes,
      selectedEdges,
      firstSelectedDisplayNodeId,
      countNodeDisplayIds,
    });
  const outerNodes = selectedNodes.filter(
    (node) => !excludedFromOuter.has(node.displayId),
  );
  const outerNodeIds = new Set(outerNodes.map((node) => node.displayId));
  const outerEdges = selectedEdges.filter(
    (edge) =>
      outerNodeIds.has(edge.sourceDisplayId) &&
      outerNodeIds.has(edge.targetDisplayId),
  );

  const {
    ast,
    triplesWithDepth,
    orderedEmissions,
    transitionCommentsByEmissionId,
    selectProjections,
    optionalChainByDisplayId,
    resolvedSelectVariableByDisplayId,
  } = buildSelectAst({
    selectedNodes: outerNodes,
    selectedEdges: outerEdges,
    firstSelectedDisplayNodeId,
    includeFullPrefixConstraintsWhenCentralNotTopModel,
  });
  const nodeNameByDisplayId = new Map(
    selectedNodes.map((node) => {
      const explicitName = readFieldString(node.path?.fields.name);
      const fallback = node.sourcePathId || node.displayId;
      return [
        node.displayId,
        explicitName.length > 0 ? explicitName : fallback,
      ];
    }),
  );
  const extraSelectProjections: Array<SelectProjection> = [];
  const extraWhereBlocks: Array<Array<string>> = [];
  const extraUsedPrefixes = new Set<string>();

  for (const [countId, descendantIds] of descendantsByCountNodeId.entries()) {
    const boundaryParentId = parentByCountNodeId.get(countId);
    if (boundaryParentId && !outerNodeIds.has(boundaryParentId)) {
      continue;
    }

    const subNodeIdsForCount = new Set(descendantIds);
    if (boundaryParentId) {
      subNodeIdsForCount.add(boundaryParentId);
    }
    const subNodes = selectedNodes.filter((node) =>
      subNodeIdsForCount.has(node.displayId),
    );
    const subNodeIds = new Set(subNodes.map((node) => node.displayId));
    const subEdges = selectedEdges.filter(
      (edge) =>
        subNodeIds.has(edge.sourceDisplayId) &&
        subNodeIds.has(edge.targetDisplayId),
    );
    const subBuild = buildSelectAst({
      selectedNodes: subNodes,
      selectedEdges: subEdges,
      firstSelectedDisplayNodeId: countId,
      includeFullPrefixConstraintsWhenCentralNotTopModel,
    });
    const outerBoundaryParentVar =
      boundaryParentId !== undefined
        ? resolvedSelectVariableByDisplayId.get(boundaryParentId)
        : null;
    const subCountVar = subBuild.resolvedSelectVariableByDisplayId.get(countId);
    const subBoundaryParentVar =
      boundaryParentId !== undefined
        ? subBuild.resolvedSelectVariableByDisplayId.get(boundaryParentId)
        : null;
    if (!subCountVar) {
      continue;
    }

    const aliasVar = `${subCountVar}_count`;
    const rawAliasVar = `${aliasVar}_raw`;
    const countDepth = fullDepthByDisplayId.get(countId) ?? 0;
    extraSelectProjections.push({
      variableName: aliasVar,
      depth: countDepth,
      coalesceToZero: true,
      sourceVariableName: rawAliasVar,
    });
    const variableMap = new Map<string, string>();
    if (
      subBoundaryParentVar &&
      outerBoundaryParentVar &&
      subBoundaryParentVar !== outerBoundaryParentVar
    ) {
      variableMap.set(subBoundaryParentVar, outerBoundaryParentVar);
    }
    const subWhere = renderWhereSection(
      subBuild.ast,
      subBuild.triplesWithDepth,
      subBuild.orderedEmissions,
      subBuild.transitionCommentsByEmissionId,
      subBuild.optionalChainByDisplayId,
      (() => {
        const outerTripleKeys = new Set(
          triplesWithDepth.map((entry) => entry.key),
        );
        const excludedSubKeys = new Set<string>();
        for (const entry of subBuild.triplesWithDepth) {
          const remappedTriple: Triple = {
            subject: remapVariableInTermMap(entry.triple.subject, variableMap),
            predicate: remapVariableInTermMap(
              entry.triple.predicate,
              variableMap,
            ),
            object: remapVariableInTermMap(entry.triple.object, variableMap),
          };
          const remappedKey = tripleKeyFromTriple(remappedTriple);
          if (outerTripleKeys.has(remappedKey)) {
            excludedSubKeys.add(entry.key);
          }
        }
        return excludedSubKeys;
      })(),
      false,
    );
    for (const prefix of subWhere.usedPrefixes) {
      extraUsedPrefixes.add(prefix);
    }

    const parentName =
      nodeNameByDisplayId.get(boundaryParentId ?? "") ?? boundaryParentId;
    const countName = nodeNameByDisplayId.get(countId) ?? countId;
    const boundaryComment = `# ${parentName ?? ""} > ${countName}`;
    const remappedWhereLines = subWhere.whereLines
      .map((line) => {
        let next = line;
        for (const [fromVar, toVar] of variableMap.entries()) {
          const varRegex = new RegExp(`\\?${fromVar}\\b`, "g");
          next = next.replace(varRegex, `?${toVar}`);
        }
        return next;
      })
      .filter((line) => {
        const trimmed = line.trim();
        if (trimmed === boundaryComment) {
          return false;
        }
        if (trimmed === `# ${parentName ?? ""} ->> ${countName}`) {
          return false;
        }
        if (trimmed === `# ${parentName ?? ""} <<- ${countName}`) {
          return false;
        }
        return true;
      });
    if (remappedWhereLines.length === 0) {
      continue;
    }
    const groupByLine =
      outerBoundaryParentVar && outerBoundaryParentVar.length > 0
        ? `    GROUP BY ?${outerBoundaryParentVar}`
        : null;
    const selectLine =
      outerBoundaryParentVar && outerBoundaryParentVar.length > 0
        ? `    SELECT ?${outerBoundaryParentVar} (COUNT(DISTINCT ?${subCountVar}) AS ?${rawAliasVar})`
        : `    SELECT (COUNT(DISTINCT ?${subCountVar}) AS ?${rawAliasVar})`;
    extraWhereBlocks.push(
      _includeZeroCountResults
        ? [
            `  ${boundaryComment}`,
            "  OPTIONAL {",
            "    {",
            selectLine,
            "      WHERE {",
            ...remappedWhereLines.map((line) => `      ${line}`),
            "      }",
            ...(groupByLine ? [groupByLine.replace(/^ {4}/, "      ")] : []),
            "    }",
            "  }",
          ]
        : [
            `  ${boundaryComment}`,
            "  {",
            selectLine,
            "    WHERE {",
            ...remappedWhereLines.map((line) => `    ${line}`),
            "    }",
            ...(groupByLine ? [groupByLine] : []),
            "  }",
          ],
    );
  }
  const parser = new Parser();

  const header = [
    "# Auto-generated from currently selected graph nodes",
    firstSelectedDisplayNodeId
      ? `# First selected display node: ${firstSelectedDisplayNodeId}`
      : "# First selected display node: (none)",
    selectedNodes.length > 0
      ? `# Selected graph nodes: ${String(selectedNodes.length)}`
      : "# No selected graph nodes found",
    includeFullPrefixConstraintsWhenCentralNotTopModel
      ? "# Full path_array prefix constraints are included per selected node."
      : "# Shared path_array prefixes are deduplicated in WHERE patterns.",
  ].join("\n");

  const query = renderQuery(
    ast,
    triplesWithDepth,
    orderedEmissions,
    transitionCommentsByEmissionId,
    selectProjections,
    optionalChainByDisplayId,
    extraSelectProjections,
    extraWhereBlocks,
    extraUsedPrefixes,
    orderByVariableName,
    orderByDirection,
  );
  parser.parse(query);

  return `${header}\n${query}`;
}
