import { Parser } from "sparqljs";

import { TYPE_PREFIXES } from "./prefixes";
import {
  buildBehindCountSubgraphs,
  buildPathTokenPrefixFromSegments,
  buildPrefixVarLookupKey,
  computeDisplayDepths,
  computeReferenceBoundaryContext,
  getSharedTokenPrefixLength,
  isEntityReferenceNode,
  readFieldString,
  readPathArray,
  readPathSegments,
  toVarSafeFragment,
} from "./sparql-helpers";

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

function buildSelectAst({
  selectedNodes,
  selectedEdges,
  firstSelectedDisplayNodeId,
  projectedDisplayNodeIds,
  makeAllFieldsOptional = false,
  makeAllEntityReferencesOptional = false,
  includeFullPrefixConstraintsWhenCentralNotTopModel = false,
}: {
  selectedNodes: Array<SparqlSelectedNode>;
  selectedEdges: Array<SparqlSelectedEdge>;
  firstSelectedDisplayNodeId: string | null;
  projectedDisplayNodeIds?: Set<string>;
  makeAllFieldsOptional?: boolean;
  makeAllEntityReferencesOptional?: boolean;
  includeFullPrefixConstraintsWhenCentralNotTopModel?: boolean;
}): {
  ast: SelectQueryAst;
  triplesWithDepth: Array<TripleWithDepth>;
  orderedEmissions: Array<TripleEmission>;
  transitionCommentsByEmissionId: Map<string, Array<string>>;
  selectProjections: Array<SelectProjection>;
  optionalChainByDisplayId: Map<string, Array<string>>;
  resolvedSelectVariableByDisplayId: Map<string, string>;
  centralDisplayId: string | null;
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
  const centralDisplayId = preferredStartId;
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

  function appendDisplayId(displayId: string): void {
    if (orderedSet.has(displayId)) {
      return;
    }
    orderedSet.add(displayId);
    orderedDisplayIds.push(displayId);
  }

  const downstreamBranchDepthMemo = new Map<string, number>();
  function getDownstreamBranchDepth(
    nodeId: string,
    inProgress: Set<string> = new Set<string>(),
  ): number {
    const memoized = downstreamBranchDepthMemo.get(nodeId);
    if (memoized !== undefined) {
      return memoized;
    }
    if (inProgress.has(nodeId)) {
      // Defensive cycle break; treat cyclical paths as very deep.
      return Number.POSITIVE_INFINITY;
    }
    inProgress.add(nodeId);
    const children = Array.from(outgoing.get(nodeId) ?? []);
    if (children.length === 0) {
      inProgress.delete(nodeId);
      downstreamBranchDepthMemo.set(nodeId, 0);
      return 0;
    }
    let maxDepth = 0;
    for (const childId of children) {
      const childDepth = getDownstreamBranchDepth(childId, inProgress);
      if (childDepth > maxDepth) {
        maxDepth = childDepth;
      }
    }
    inProgress.delete(nodeId);
    const depth = maxDepth + 1;
    downstreamBranchDepthMemo.set(nodeId, depth);
    return depth;
  }

  const getSortedChildren = (currentId: string): Array<string> =>
    Array.from(outgoing.get(currentId) ?? []).sort((a, b) => {
      const depthA = getDownstreamBranchDepth(a);
      const depthB = getDownstreamBranchDepth(b);
      if (depthA !== depthB) {
        return depthA - depthB;
      }
      return a.localeCompare(b);
    });
  const getSortedParents = (currentId: string): Array<string> =>
    Array.from(incoming.get(currentId) ?? []).sort();

  function visitFullGraphDfs(
    currentId: string,
    priority: "upstream" | "downstream",
    blockedNodeIds: Set<string> | null = null,
  ): void {
    if (blockedNodeIds?.has(currentId)) {
      return;
    }
    appendDisplayId(currentId);
    const parents = getSortedParents(currentId);
    const children = getSortedChildren(currentId);
    const primary = priority === "upstream" ? parents : children;
    const secondary = priority === "upstream" ? children : parents;

    for (const parentId of priority === "upstream" ? primary : secondary) {
      if (blockedNodeIds?.has(parentId)) {
        continue;
      }
      if (currentId !== preferredStartId && !parentByDisplayId.has(currentId)) {
        parentByDisplayId.set(currentId, parentId);
      }
      if (!orderedSet.has(parentId)) {
        visitFullGraphDfs(parentId, priority, blockedNodeIds);
      }
    }
    for (const childId of priority === "upstream" ? secondary : primary) {
      if (blockedNodeIds?.has(childId)) {
        continue;
      }
      if (!parentByDisplayId.has(childId)) {
        parentByDisplayId.set(childId, currentId);
      }
      if (!orderedSet.has(childId)) {
        visitFullGraphDfs(childId, priority, blockedNodeIds);
      }
    }
  }

  if (preferredStartId) {
    const centralParents = getSortedParents(preferredStartId);
    const upstreamStartParentId = centralParents[0] ?? null;
    if (upstreamStartParentId) {
      visitFullGraphDfs(
        upstreamStartParentId,
        "upstream",
        new Set<string>([preferredStartId]),
      );
    }
    appendDisplayId(preferredStartId);
    visitFullGraphDfs(preferredStartId, "downstream");
  }

  // Fallback for disconnected/remaining selected nodes.
  for (const rootId of roots) {
    if (!orderedSet.has(rootId)) {
      visitFullGraphDfs(rootId, "downstream");
    }
  }
  for (const displayId of [...allDisplayIds].sort()) {
    if (!orderedSet.has(displayId)) {
      visitFullGraphDfs(displayId, "downstream");
    }
  }

  const optionalChainByDisplayId = new Map<string, Array<string>>();
  const optionalChainMemo = new Map<string, Array<string>>();
  const optionalChainInProgress = new Set<string>();
  const entityReferenceBoundaryTransitionKeys = new Set<string>(
    selectedEdges
      .filter((edge) => edge.isEntityReferenceBoundary)
      .map((edge) => `${edge.sourceDisplayId}=>${edge.targetDisplayId}`),
  );
  const isMultipleNode = (displayId: string): boolean => {
    if (displayId === centralDisplayId) {
      return false;
    }
    const node = selectedNodeByDisplayId.get(displayId);
    if (!node) {
      return false;
    }
    if (makeAllFieldsOptional) {
      return true;
    }
    if (makeAllEntityReferencesOptional) {
      const parentId = parentByDisplayId.get(displayId);
      if (
        parentId &&
        entityReferenceBoundaryTransitionKeys.has(`${parentId}=>${displayId}`)
      ) {
        return true;
      }
    }
    return node.path?.multiple === true;
  };
  const getOptionalChain = (displayId: string): Array<string> => {
    const memoized = optionalChainMemo.get(displayId);
    if (memoized) {
      return memoized;
    }
    if (optionalChainInProgress.has(displayId)) {
      return [];
    }
    optionalChainInProgress.add(displayId);
    const parentId = parentByDisplayId.get(displayId) ?? null;
    const parentChain = parentId ? getOptionalChain(parentId) : [];
    const chain = isMultipleNode(displayId)
      ? [...parentChain, displayId]
      : [...parentChain];
    optionalChainInProgress.delete(displayId);
    optionalChainMemo.set(displayId, chain);
    return chain;
  };
  for (const displayId of orderedDisplayIds) {
    optionalChainByDisplayId.set(displayId, getOptionalChain(displayId));
  }

  const sourceIdOccurrences = new Map<string, number>();
  const preferredSelectVariableByDisplayId = new Map<string, string>();
  const variableBaseByDisplayId = new Map<string, string>();

  const getNodeNamingSource = (displayId: string): string => {
    const node = selectedNodeByDisplayId.get(displayId);
    const explicitName = readFieldString(node?.path?.fields.name);
    return explicitName.length > 0
      ? explicitName
      : (node?.sourcePathId ?? displayId);
  };
  const getVariableBaseForDisplayId = (displayId: string): string => {
    const cached = variableBaseByDisplayId.get(displayId);
    if (cached) {
      return cached;
    }
    const node = selectedNodeByDisplayId.get(displayId);
    if (!node) {
      const fallback = toVarSafeFragment(displayId);
      variableBaseByDisplayId.set(displayId, fallback);
      return fallback;
    }
    const currentNodeBase = toVarSafeFragment(getNodeNamingSource(displayId));
    const entityReferenceAncestorParts: Array<string> = [];
    let current = parentByDisplayId.get(displayId);
    while (current) {
      const ancestor = selectedNodeByDisplayId.get(current);
      if (ancestor && isEntityReferenceNode(ancestor)) {
        entityReferenceAncestorParts.push(
          toVarSafeFragment(getNodeNamingSource(current)),
        );
      }
      current = parentByDisplayId.get(current);
    }
    const parts =
      entityReferenceAncestorParts.length > 0
        ? [...entityReferenceAncestorParts.reverse(), currentNodeBase]
        : [currentNodeBase];
    const base = toVarSafeFragment(parts.join("_"));
    variableBaseByDisplayId.set(displayId, base);
    return base;
  };

  for (const displayId of orderedDisplayIds) {
    const node = selectedNodeByDisplayId.get(displayId);
    if (!node) {
      continue;
    }

    const base = getVariableBaseForDisplayId(displayId);
    const count = sourceIdOccurrences.get(base) ?? 0;
    sourceIdOccurrences.set(base, count + 1);
    const variableName = count === 0 ? base : `${base}_${String(count + 1)}`;
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
  const emittedPrefixVarByBoundaryAndTokens = new Map<string, string>();
  let emissionCounter = 0;
  const recordEmission = ({
    emissionId,
    key,
    depth,
    ownerDisplayId,
  }: {
    emissionId: string;
    key: string;
    depth: number;
    ownerDisplayId: string | null;
  }): void => {
    emissionOrder.push({
      id: emissionId,
      key,
      depth,
      ownerDisplayId,
    });
    if (ownerDisplayId && !firstEmissionIdByDisplayId.has(ownerDisplayId)) {
      firstEmissionIdByDisplayId.set(ownerDisplayId, emissionId);
    }
  };

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
      recordEmission({
        emissionId,
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
      recordEmission({
        emissionId,
        key,
        depth: normalizedDepth,
        ownerDisplayId,
      });
      return { key, isNew: false, emissionId };
    }
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
  const formatEntityReferenceTransitionComment = (
    sourceDisplayId: string,
    targetDisplayId: string,
  ): string => {
    const entityReferenceName = getNodeName(sourceDisplayId);
    const parentDisplayId = parentByDisplayId.get(sourceDisplayId);
    const parentName = parentDisplayId
      ? getNodeName(parentDisplayId)
      : entityReferenceName;
    return `# ${parentName} == (${entityReferenceName}) >> ${getNodeName(targetDisplayId)}`;
  };
  const transitionMetaByKey = new Map<string, SparqlSelectedEdge>();
  for (const edge of selectedEdges) {
    const key = `${edge.sourceDisplayId}=>${edge.targetDisplayId}`;
    const existing = transitionMetaByKey.get(key);
    const existingBridge = existing?.bridgePredicateIri?.trim() ?? "";
    const nextBridge = edge.bridgePredicateIri?.trim() ?? "";
    if (!existing || (existingBridge.length === 0 && nextBridge.length > 0)) {
      transitionMetaByKey.set(key, edge);
    }
  }
  const emittedBridgeTransitionKeys = new Set<string>();

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

  const shouldUseOwnerScopedPrefixKeys = ({
    ownerDisplayId,
    boundaryContext,
  }: {
    ownerDisplayId: string;
    boundaryContext: string;
  }): boolean => {
    if (includeFullPrefixConstraintsWhenCentralNotTopModel) {
      return true;
    }
    if (!boundaryContext.includes("|ref:")) {
      return false;
    }
    // When full prefix constraints are disabled, drop central-node ref-boundary
    // prefixes that are already implied by its direct parent.
    if (
      ownerDisplayId === centralDisplayId &&
      parentByDisplayId.has(ownerDisplayId)
    ) {
      return false;
    }
    return true;
  };

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
    onResolvedStepVar,
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
    onResolvedStepVar?: (
      resolvedStepIndex: number,
      variableName: string,
    ) => void;
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

    const useOwnerScopedPrefixKeys = shouldUseOwnerScopedPrefixKeys({
      ownerDisplayId,
      boundaryContext,
    });

    if (stepIndex + 1 < classes.length) {
      const nextClassRaw = classes[stepIndex + 1];
      const nextClass = nextClassRaw.replace(/^\^/, "");
      const nextPrefixTokens = [...nextTokenPrefix, nextClassRaw];
      const nextPrefixKey = useOwnerScopedPrefixKeys
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
      onResolvedStepVar?.(stepIndex + 1, nextVarName);

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

    const valuePrefixKey = useOwnerScopedPrefixKeys
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
    onResolvedStepVar?.(stepIndex + 1, valueVarName);
    return valueVarName;
  }

  for (const displayId of orderedDisplayIds) {
    const node = selectedNodeByDisplayId.get(displayId);
    if (!node) {
      continue;
    }

    const pathSegments = readPathSegments(node.path);
    const { pathArray, classes, predicates } = pathSegments;
    if (pathArray.length === 0) {
      continue;
    }
    if (classes.length === 0) {
      continue;
    }
    let emittedClasses = classes;
    let emittedPredicates = predicates;
    if (
      !includeFullPrefixConstraintsWhenCentralNotTopModel &&
      displayId === centralDisplayId
    ) {
      const parentDisplayId = parentByDisplayId.get(displayId);
      const parentNode =
        parentDisplayId !== undefined
          ? selectedNodeByDisplayId.get(parentDisplayId)
          : undefined;
      const parentPathArray = readPathArray(parentNode?.path);
      const sharedTokenPrefixLength = getSharedTokenPrefixLength(
        parentPathArray,
        pathArray,
      );
      const trimStepCount = Math.min(
        predicates.length,
        Math.floor(sharedTokenPrefixLength / 2),
      );
      if (trimStepCount > 0) {
        emittedClasses = classes.slice(trimStepCount);
        emittedPredicates = predicates.slice(trimStepCount);
      }
    }

    const selectedVarName =
      preferredSelectVariableByDisplayId.get(displayId) ??
      getVariableBaseForDisplayId(displayId);
    const sourceVarBase = getVariableBaseForDisplayId(displayId);
    const displayDepth = depthByDisplayId.get(displayId) ?? 0;
    const boundaryContext = boundaryContextByDisplayId.get(displayId) ?? "root";
    const useOwnerScopedPrefixKeys = shouldUseOwnerScopedPrefixKeys({
      ownerDisplayId: displayId,
      boundaryContext,
    });

    const parentDisplayId = parentByDisplayId.get(displayId);
    const rootClass = emittedClasses[0].replace(/^\^/, "");
    const rootPrefixKey = useOwnerScopedPrefixKeys
      ? `${boundaryContext}|class:${rootClass}|owner:${displayId}`
      : `${boundaryContext}|class:${rootClass}`;
    let rootVarName = getOrCreatePrefixVar(
      rootPrefixKey,
      `${sourceVarBase}_root`,
      "root",
    );
    let initialStepIndex = 0;
    let shouldEmitRootClassConstraint = true;
    let pathClassesForEmission = emittedClasses;
    let pathPredicatesForEmission = emittedPredicates;

    if (parentDisplayId) {
      const parentNode = selectedNodeByDisplayId.get(parentDisplayId);
      const parentResolvedVar =
        resolvedSelectVariableByDisplayId.get(parentDisplayId);
      if (
        parentNode &&
        isEntityReferenceNode(parentNode) &&
        parentResolvedVar &&
        emittedClasses[0] === classes[0]
      ) {
        const parentSegments = readPathSegments(parentNode.path);
        const parentClasses = parentSegments.classes;
        const parentTerminalClass =
          parentClasses[parentClasses.length - 1]?.replace(/^\^/, "") ?? "";
        if (parentTerminalClass !== "" && parentTerminalClass === rootClass) {
          rootVarName = parentResolvedVar;
        }
      }

      const parentSegments = readPathSegments(parentNode?.path);
      const parentPathArray = parentSegments.pathArray;
      const parentPredicates = parentSegments.predicates;
      if (parentResolvedVar && parentPathArray.length > 0) {
        const sharedTokenPrefixLength = getSharedTokenPrefixLength(
          parentPathArray,
          pathArray,
        );
        if (
          parentPredicates.length > 0 &&
          sharedTokenPrefixLength >= parentPathArray.length
        ) {
          rootVarName = parentResolvedVar;
          initialStepIndex = parentPredicates.length;
          shouldEmitRootClassConstraint = false;
          pathClassesForEmission = classes;
          pathPredicatesForEmission = predicates;
        }
      }
    }

    if (includeFullPrefixConstraintsWhenCentralNotTopModel) {
      for (let step = pathPredicatesForEmission.length; step >= 0; step -= 1) {
        const tokenPrefix = buildPathTokenPrefixFromSegments({
          classes: pathClassesForEmission,
          predicates: pathPredicatesForEmission,
          stepIndex: step,
        });
        const key = buildPrefixVarLookupKey(boundaryContext, tokenPrefix);
        const existingVar = emittedPrefixVarByBoundaryAndTokens.get(key);
        if (!existingVar) {
          continue;
        }
        rootVarName = existingVar;
        initialStepIndex = step;
        shouldEmitRootClassConstraint = false;
        break;
      }
    }

    const registerResolvedStepVar = (
      resolvedStepIndex: number,
      variableName: string,
    ): void => {
      const tokenPrefix = buildPathTokenPrefixFromSegments({
        classes: pathClassesForEmission,
        predicates: pathPredicatesForEmission,
        stepIndex: resolvedStepIndex,
      });
      const key = buildPrefixVarLookupKey(boundaryContext, tokenPrefix);
      if (!emittedPrefixVarByBoundaryAndTokens.has(key)) {
        emittedPrefixVarByBoundaryAndTokens.set(key, variableName);
      }
    };

    if (shouldEmitRootClassConstraint) {
      addTriple(
        v(rootVarName),
        iri(RDF_TYPE_IRI),
        iri(rootClass),
        displayDepth,
        displayId,
      );
    }
    registerResolvedStepVar(initialStepIndex, rootVarName);

    const resolvedVar =
      initialStepIndex >= pathPredicatesForEmission.length
        ? rootVarName
        : emitPathRecursively({
            baseVarName: rootVarName,
            tokenPrefix: buildPathTokenPrefixFromSegments({
              classes: pathClassesForEmission,
              predicates: pathPredicatesForEmission,
              stepIndex: initialStepIndex,
            }),
            classes: pathClassesForEmission,
            predicates: pathPredicatesForEmission,
            stepIndex: initialStepIndex,
            displayDepth,
            boundaryContext,
            selectedVarName,
            sourceVarBase,
            ownerDisplayId: displayId,
            onResolvedStepVar: registerResolvedStepVar,
          });
    resolvedSelectVariableByDisplayId.set(displayId, resolvedVar);

    if (parentDisplayId) {
      const transitionKey = `${parentDisplayId}=>${displayId}`;
      const transitionMeta = transitionMetaByKey.get(transitionKey);
      const rawBridgePredicate =
        transitionMeta?.bridgePredicateIri?.trim() ?? "";
      const parentResolvedVar =
        resolvedSelectVariableByDisplayId.get(parentDisplayId) ?? null;
      const isEntityReferenceTransition =
        transitionMeta?.isEntityReferenceBoundary === true ||
        isEntityReferenceNode(selectedNodeByDisplayId.get(parentDisplayId));

      if (rawBridgePredicate.length > 0 && parentResolvedVar) {
        const isInverse = rawBridgePredicate.startsWith("^");
        const bridgePredicateIri = rawBridgePredicate.replace(/^\^/, "");
        const bridgeDepth = depthByDisplayId.get(displayId) ?? 0;
        const bridgeTriple = addTriple(
          v(isInverse ? resolvedVar : parentResolvedVar),
          iri(bridgePredicateIri),
          v(isInverse ? parentResolvedVar : resolvedVar),
          bridgeDepth,
          displayId,
        );
        addTransitionComment(
          bridgeTriple.emissionId,
          isEntityReferenceTransition
            ? formatEntityReferenceTransitionComment(parentDisplayId, displayId)
            : `# ${getNodeName(parentDisplayId)} ->> ${getNodeName(displayId)}`,
        );
        emittedBridgeTransitionKeys.add(transitionKey);
      } else {
        const anchorEmissionId = firstEmissionIdByDisplayId.get(displayId);
        if (anchorEmissionId) {
          addTransitionComment(
            anchorEmissionId,
            isEntityReferenceTransition
              ? formatEntityReferenceTransitionComment(
                  parentDisplayId,
                  displayId,
                )
              : `# ${getNodeName(parentDisplayId)} -> ${getNodeName(displayId)}`,
          );
        }
      }
    }
  }

  for (const edge of selectedEdges) {
    const transitionKey = `${edge.sourceDisplayId}=>${edge.targetDisplayId}`;
    if (emittedBridgeTransitionKeys.has(transitionKey)) {
      continue;
    }

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
    const isEntityReferenceTransition =
      edge.isEntityReferenceBoundary ||
      isEntityReferenceNode(selectedNodeByDisplayId.get(edge.sourceDisplayId));
    addTransitionComment(
      bridgeTriple.emissionId,
      isEntityReferenceTransition
        ? formatEntityReferenceTransitionComment(
            edge.sourceDisplayId,
            edge.targetDisplayId,
          )
        : `# ${getNodeName(edge.sourceDisplayId)} ->> ${getNodeName(edge.targetDisplayId)}`,
    );
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
    if (projectedDisplayNodeIds && !projectedDisplayNodeIds.has(displayId)) {
      continue;
    }
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
    centralDisplayId: preferredStartId,
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
  centralDisplayId: string | null,
  excludedTripleKeys: Set<string> = new Set<string>(),
  includeCentralNodeComment = true,
  omitClassConstraints = false,
  disregardTypesOfNonRootNodes = false,
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
    const targetChain =
      emission.ownerDisplayId !== null &&
      emission.ownerDisplayId !== centralDisplayId
        ? (optionalChainByDisplayId.get(emission.ownerDisplayId) ?? [])
        : [];
    const dedupedTargetChain = targetChain.filter(
      (displayId, index) => index === 0 || displayId !== targetChain[index - 1],
    );
    const isDuplicateTripleEmission =
      excludedTripleKeys.has(tripleEntry.key) ||
      seenRenderedTripleKeys.has(tripleEntry.key);

    const indent = "  ".repeat(emission.depth + 1);
    const comments = transitionCommentsByEmissionId.get(emission.id) ?? [];
    const centralComments = includeCentralNodeComment
      ? comments.filter(isCentralNodeComment)
      : [];
    const regularComments = comments.filter(
      (comment) => !isCentralNodeComment(comment),
    );

    let sharedChainLength = 0;
    while (
      sharedChainLength < openOptionals.length &&
      sharedChainLength < dedupedTargetChain.length &&
      openOptionals[sharedChainLength].rootDisplayId ===
        dedupedTargetChain[sharedChainLength]
    ) {
      sharedChainLength += 1;
    }
    const optionalCloseTarget = sharedChainLength;
    while (openOptionals.length > optionalCloseTarget) {
      const closing = openOptionals.pop()!;
      whereLines.push(`${"  ".repeat(closing.depth + 1)}}`);
    }

    for (const comment of regularComments) {
      whereLines.push("");
      whereLines.push(`${indent}${comment}`);
    }
    if (centralComments.length > 0) {
      for (const comment of centralComments) {
        whereLines.push("");
        whereLines.push(comment);
      }
    }

    if (isDuplicateTripleEmission) {
      continue;
    }

    for (let i = sharedChainLength; i < dedupedTargetChain.length; i += 1) {
      openOptionals.push({
        rootDisplayId: dedupedTargetChain[i],
        depth: emission.depth,
      });
      whereLines.push(`${indent}OPTIONAL {`);
    }
    seenRenderedTripleKeys.add(tripleEntry.key);
    const tripleLine = `${indent}${renderTerm(row.subject, ast.prefixes)} ${renderTerm(row.predicate, ast.prefixes)} ${renderTerm(row.object, ast.prefixes)} .`;
    const isClassConstraint =
      row.predicate.termType === "NamedNode" &&
      row.predicate.value === RDF_TYPE_IRI;
    const isRootModelTypeConstraint =
      row.subject.termType === "Variable" &&
      row.subject.value.endsWith("_root");
    const shouldCommentOutClassConstraint =
      isClassConstraint &&
      (omitClassConstraints ||
        (disregardTypesOfNonRootNodes && !isRootModelTypeConstraint));
    whereLines.push(
      shouldCommentOutClassConstraint
        ? `${indent}# ${tripleLine.trimStart()}`
        : tripleLine,
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
  centralDisplayId: string | null,
  extraSelectProjections: Array<SelectProjection>,
  extraWhereBlocks: Array<Array<string>>,
  extraUsedPrefixes: Set<string>,
  omitClassConstraints = false,
  disregardTypesOfNonRootNodes = false,
  namedGraphInput = "",
  queryLimit = 100,
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
    centralDisplayId,
    new Set<string>(),
    true,
    omitClassConstraints,
    disregardTypesOfNonRootNodes,
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

  const normalizedLimit =
    Number.isFinite(queryLimit) && queryLimit > 0
      ? Math.trunc(queryLimit)
      : 100;
  const namedGraph = namedGraphInput.trim();
  const fromNamedLine = namedGraph.length > 0 ? `FROM <${namedGraph}>` : null;

  return [
    ...prefixLines,
    "",
    "SELECT DISTINCT",
    ...selectLines,
    ...(fromNamedLine ? [fromNamedLine] : []),
    "WHERE {",
    ...whereLines,
    "}",
    ...(orderByVariableName
      ? [`ORDER BY ${orderByDirection}(?${orderByVariableName})`]
      : []),
    `LIMIT ${String(normalizedLimit)}`,
  ].join("\n");
}

export function generateSparqlQuery({
  firstSelectedDisplayNodeId,
  selectedNodes,
  selectedEdges,
  projectedNodeDisplayIds,
  countNodeDisplayIds,
  includeZeroCountResults: _includeZeroCountResults = false,
  includeFullPrefixConstraintsWhenCentralNotTopModel = false,
  makeAllFieldsOptional = false,
  makeAllEntityReferencesOptional = false,
  omitClassConstraints = false,
  disregardTypesOfNonRootNodes = false,
  namedGraphInput = "",
  queryLimit = 100,
  orderByVariableName,
  orderByDirection = "DESC",
}: {
  firstSelectedDisplayNodeId: string | null;
  selectedNodes: Array<SparqlSelectedNode>;
  selectedEdges: Array<SparqlSelectedEdge>;
  projectedNodeDisplayIds?: Array<string>;
  countNodeDisplayIds: Array<string>;
  includeZeroCountResults?: boolean;
  includeFullPrefixConstraintsWhenCentralNotTopModel?: boolean;
  makeAllFieldsOptional?: boolean;
  makeAllEntityReferencesOptional?: boolean;
  omitClassConstraints?: boolean;
  disregardTypesOfNonRootNodes?: boolean;
  namedGraphInput?: string;
  queryLimit?: number;
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
  const projectedOuterNodeIds = new Set(
    (
      projectedNodeDisplayIds ?? selectedNodes.map((node) => node.displayId)
    ).filter((displayId) => outerNodeIds.has(displayId)),
  );
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
    centralDisplayId,
  } = buildSelectAst({
    selectedNodes: outerNodes,
    selectedEdges: outerEdges,
    firstSelectedDisplayNodeId,
    projectedDisplayNodeIds: projectedOuterNodeIds,
    makeAllFieldsOptional,
    makeAllEntityReferencesOptional,
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
      makeAllFieldsOptional,
      makeAllEntityReferencesOptional,
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
      subBuild.centralDisplayId,
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
      omitClassConstraints,
      disregardTypesOfNonRootNodes,
    );
    for (const prefix of subWhere.usedPrefixes) {
      extraUsedPrefixes.add(prefix);
    }

    const parentName =
      nodeNameByDisplayId.get(boundaryParentId ?? "") ?? boundaryParentId;
    const countName = nodeNameByDisplayId.get(countId) ?? countId;
    const boundaryComment = `# ${parentName ?? ""} -> ${countName}`;
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
            "   OPTIONAL {",
            selectLine,
            "    WHERE {",
            ...remappedWhereLines.map((line) => `    ${line}`),
            "    }",
            ...(groupByLine ? [groupByLine.replace(/^ {4}/, "      ")] : []),
            "    }",
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
    centralDisplayId,
    extraSelectProjections,
    extraWhereBlocks,
    extraUsedPrefixes,
    omitClassConstraints,
    disregardTypesOfNonRootNodes,
    namedGraphInput,
    queryLimit,
    orderByVariableName,
    orderByDirection,
  );
  parser.parse(query);

  return `${header}\n${query}`;
}
