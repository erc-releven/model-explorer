import type { Scenario } from "../scenario";
import { createSelectedSubgraphAst, type ModelAstNode, type ModelSubgraphAst } from "./ast";
import type { Pathbuilder } from "./pathbuilder";
import { TYPE_PREFIXES } from "./prefixes";

type SparqlAstTransformer = (tree: ModelSubgraphAst) => void;
type SparqlCompiler = (tree: ModelSubgraphAst) => string;
type PrefixEntry = (typeof TYPE_PREFIXES)[number];
export interface SparqlProcessorConfig {
  sparql: Scenario["sparql"];
}

interface SparqlUnifiedProcessor {
  processSync: (tree: ModelSubgraphAst) => string;
  use: (transformer: SparqlAstTransformer) => SparqlUnifiedProcessor;
}

function sanitizeVariableName(id: string): string {
  const normalized = id.replace(/\W/g, "_");
  const prefixed = /^\d/.test(normalized) ? `v_${normalized}` : normalized;

  return prefixed.length > 0 ? prefixed : "v";
}

function createVariableBaseNameFromIdArray(idArray: Array<string>): string {
  const encodedPath = idArray
    .map((part) => {
      if (part === ">") {
        return "down";
      }

      if (part === "<") {
        return "up";
      }

      return part;
    })
    .join("_");

  return sanitizeVariableName(encodedPath);
}

function stringifyPath(path: Array<string>): string {
  return path.join("");
}

function toParentPath(path: Array<string>): Array<string> {
  return path.length > 1 ? path.slice(0, -2) : [];
}

function createShortestUniqueVariableBaseNames(
  idArrays: Array<Array<string>>,
): Map<number, string> {
  const candidatesByIndex = new Map<number, string>();

  for (const [index, idArray] of idArrays.entries()) {
    const pathParts = idArray.map((part) => {
      if (part === ">") {
        return "down";
      }

      if (part === "<") {
        return "up";
      }

      return part;
    });

    let depth = 1;
    let candidate = sanitizeVariableName(pathParts.at(-1) ?? "v");

    while (depth <= pathParts.length) {
      const startIndex = Math.max(0, pathParts.length - depth);
      candidate = sanitizeVariableName(pathParts.slice(startIndex).join("_"));

      const conflicts = idArrays.some((otherIdArray, otherIndex) => {
        if (otherIndex === index) {
          return false;
        }

        const otherParts = otherIdArray.map((part) => {
          if (part === ">") {
            return "down";
          }

          if (part === "<") {
            return "up";
          }

          return part;
        });
        const otherStartIndex = Math.max(0, otherParts.length - depth);
        const otherCandidate = sanitizeVariableName(otherParts.slice(otherStartIndex).join("_"));

        return otherCandidate === candidate;
      });

      if (!conflicts) {
        break;
      }

      depth += 1;
    }

    candidatesByIndex.set(index, candidate.length > 0 ? candidate : `v_${String(index)}`);
  }

  return candidatesByIndex;
}

function walkNodesWithDepth(
  nodes: Array<ModelAstNode>,
  depth: number,
  visitor: (depth: number, node: ModelAstNode) => void,
): void {
  for (const node of nodes) {
    visitor(depth, node);
    walkNodesWithDepth(node.children, depth + 1, visitor);
  }
}

function escapeIriForSparql(iri: string): string {
  return encodeURI(iri).replace(/[<>"{}|^`\\]/g, (character) => {
    return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
  });
}

function isSafePrefixedLocal(localName: string): boolean {
  return /^[A-Z_][\w.-]*$/i.test(localName);
}

function formatIriTerm(
  value: string,
  prefixes: Array<PrefixEntry>,
  usedPrefixes: Set<string>,
): string {
  const isInversePredicate = value.startsWith("^");
  const iriValue = isInversePredicate ? value.slice(1) : value;

  for (const entry of prefixes) {
    if (iriValue.startsWith(entry.iri)) {
      const localName = iriValue.slice(entry.iri.length);

      if (isSafePrefixedLocal(localName)) {
        usedPrefixes.add(entry.prefix);
        const prefixed = `${entry.prefix}:${localName}`;
        return isInversePredicate ? `^${prefixed}` : prefixed;
      }

      const iri = `<${escapeIriForSparql(iriValue)}>`;
      return isInversePredicate ? `^${iri}` : iri;
    }
  }

  const iri = `<${escapeIriForSparql(iriValue)}>`;
  return isInversePredicate ? `^${iri}` : iri;
}

function getCommonPrefixLength(left: Array<string>, right: Array<string>): number {
  const minLength = Math.min(left.length, right.length);
  let index = 0;

  while (index < minLength && left[index] === right[index]) {
    index += 1;
  }

  return index;
}

function getTraversalIndentLevel(idArray: Array<string>): number {
  let depth = 0;

  for (let index = 1; index < idArray.length; index += 2) {
    const marker = idArray[index];

    if (marker === ">") {
      depth += 1;
      continue;
    }

    if (marker === "<") {
      depth -= 1;
    }
  }

  return depth;
}

function getTraversalDirectionBetweenNodes(
  fromNode: ModelAstNode,
  toNode: ModelAstNode,
): "down" | "up" | undefined {
  const fromPath = fromNode.data.id_array;
  const toPath = toNode.data.id_array;
  const commonPrefixLength = getCommonPrefixLength(fromPath, toPath);

  if (toPath.length === fromPath.length + 2 && commonPrefixLength === fromPath.length) {
    return toPath[fromPath.length] === "<" ? "up" : "down";
  }

  if (fromPath.length === toPath.length + 2 && commonPrefixLength === toPath.length) {
    return fromPath[toPath.length] === ">" ? "up" : "down";
  }

  return undefined;
}

function createLogicalParentByNodeId(
  allNodes: Array<{ depth: number; node: ModelAstNode }>,
): Map<string, string> {
  const nodeIds = new Set(allNodes.map(({ node }) => stringifyPath(node.data.id_array)));
  const logicalParentByNodeId = new Map<string, string>();

  for (const { node } of allNodes) {
    const nodeId = stringifyPath(node.data.id_array);
    let parentPath = toParentPath(node.data.id_array);

    while (parentPath.length > 0) {
      const parentNodeId = stringifyPath(parentPath);

      if (nodeIds.has(parentNodeId)) {
        logicalParentByNodeId.set(nodeId, parentNodeId);
        break;
      }

      parentPath = toParentPath(parentPath);
    }
  }

  return logicalParentByNodeId;
}

function createNodeVariableMaps(tree: ModelSubgraphAst): {
  allNodes: Array<{ depth: number; node: ModelAstNode }>;
  nodeVariableById: Map<string, string>;
  selectedVariables: Array<{ depth: number; variable: string }>;
} {
  const allNodes: Array<{ depth: number; node: ModelAstNode }> = [];
  walkNodesWithDepth(tree.children, 0, (depth, node) => {
    allNodes.push({ depth, node });
  });

  const shortestBaseNames = createShortestUniqueVariableBaseNames(
    allNodes.map(({ node }) => node.data.id_array),
  );
  const nodeVariableById = new Map<string, string>();
  const seenCountsByName = new Map<string, number>();
  const selectedVariables: Array<{ depth: number; variable: string }> = [];

  for (const [index, entry] of allNodes.entries()) {
    const { depth, node } = entry;
    const variableBaseName =
      shortestBaseNames.get(index) ?? createVariableBaseNameFromIdArray(node.data.id_array);
    const seenCount = seenCountsByName.get(variableBaseName) ?? 0;
    const variableLabel =
      seenCount === 0 ? `?${variableBaseName}` : `?${variableBaseName}_${String(seenCount)}`;
    const nodeId = stringifyPath(node.data.id_array);

    seenCountsByName.set(variableBaseName, seenCount + 1);
    nodeVariableById.set(nodeId, variableLabel);

    if (node.data.selected != null) {
      selectedVariables.push({
        depth,
        variable: node.data.selected === "count" ? `${variableLabel}_count` : variableLabel,
      });
    }
  }

  return { allNodes, nodeVariableById, selectedVariables };
}

function compileAstToSparql(
  tree: ModelSubgraphAst,
  prefixes: Array<PrefixEntry>,
  config: SparqlProcessorConfig,
): string {
  interface WhereStatementEntry {
    line: string;
    nodeId: string;
  }

  const shouldDisregardNonRootNodeTypes = config.sparql.disregardTypesOfNonRootNodes;
  const shouldCountDistinct = config.sparql.countDistinct;
  const shouldMakeAllFieldsOptional = config.sparql.makeAllFieldsOptional;
  const shouldMakeEntityReferenceSubtreesOptional = config.sparql.makeEntityReferencesOptional;
  const shouldIncludeZeroCountResults = config.sparql.includeZeroCountResults;
  const { allNodes, nodeVariableById } = createNodeVariableMaps(tree);
  const indentLevelByNodeId = new Map(
    allNodes.map(({ node }) => [
      stringifyPath(node.data.id_array),
      getTraversalIndentLevel(node.data.id_array),
    ]),
  );
  const minIndentLevel = allNodes.reduce((minValue, { node }) => {
    const nodeId = stringifyPath(node.data.id_array);
    const indentLevel = indentLevelByNodeId.get(nodeId) ?? 0;

    return Math.min(minValue, indentLevel);
  }, 0);
  const normalizedIndentDepthByNodeId = new Map(
    allNodes.map(({ node }) => {
      const nodeId = stringifyPath(node.data.id_array);
      const indentLevel = indentLevelByNodeId.get(nodeId) ?? 0;

      return [nodeId, indentLevel - minIndentLevel];
    }),
  );
  const whereStatements: Array<WhereStatementEntry> = [];
  const nodeVisitOrder = new Map<string, number>();
  let nextNodeVisitIndex = 0;
  const usedPrefixes = new Set<string>();
  const nodeById = new Map(allNodes.map(({ node }) => [stringifyPath(node.data.id_array), node]));
  const parentByNodeId = createLogicalParentByNodeId(allNodes);

  function isUpwardChildNode(node: ModelAstNode, parent: ModelAstNode | undefined): boolean {
    if (parent == null) {
      return false;
    }

    return getTraversalDirectionBetweenNodes(parent, node) === "up";
  }

  function getEffectiveNodePathArray(
    node: ModelAstNode,
    parent: ModelAstNode | undefined,
  ): Array<string> {
    const parentEdgeEntityReferencePathArray = node.data.parentEdgeEntityReferencePath?.path_array;

    if (parent != null && parentEdgeEntityReferencePathArray != null) {
      return parentEdgeEntityReferencePathArray;
    }

    return node.data.targetPath.path_array;
  }

  interface NodeSerializationContext {
    pathArray?: Array<string>;
    variable: string;
  }

  function emitNodeStatements(
    node: ModelAstNode,
    parent: ModelAstNode | undefined,
    nodePathArray: Array<string>,
    nodeOwnStatementStart: number,
    parentContext: NodeSerializationContext | undefined,
    upwardLinkVariable: undefined | string,
    upwardTerminalVariable: undefined | string,
  ): void {
    const nodeId = stringifyPath(node.data.id_array);
    if (!nodeVisitOrder.has(nodeId)) {
      nodeVisitOrder.set(nodeId, nextNodeVisitIndex);
      nextNodeVisitIndex += 1;
    }
    const nodeVariable = nodeVariableById.get(nodeId);
    const nodeDepth = normalizedIndentDepthByNodeId.get(nodeId) ?? 0;

    if (nodeVariable == null) {
      return;
    }

    const isUpwardEdge = isUpwardChildNode(node, parent);
    const inheritedStartIndex =
      parentContext?.pathArray == null
        ? 0
        : getCommonPrefixLength(parentContext.pathArray, nodePathArray);
    const startIndex =
      parent == null
        ? Math.min(Math.max(0, inheritedStartIndex), nodePathArray.length)
        : Math.min(
            Math.max(0, Math.max(nodeOwnStatementStart, inheritedStartIndex)),
            nodePathArray.length,
          );
    const predicateIndexes: Array<number> = [];

    for (let pathIndex = startIndex; pathIndex < nodePathArray.length; pathIndex += 1) {
      if (pathIndex % 2 === 1) {
        predicateIndexes.push(pathIndex);
      }
    }

    const parentVariable = parentContext?.variable ?? nodeVariable;
    const parentNodeTerminalClass = parent?.data.targetPath.path_array.at(-1);
    const hasSharedTerminalTypeWithParent =
      isUpwardEdge &&
      nodePathArray.length > 0 &&
      parentNodeTerminalClass != null &&
      nodePathArray.at(-1) === parentNodeTerminalClass;
    const terminalVariable = isUpwardEdge
      ? (upwardTerminalVariable ?? parentVariable)
      : nodeVariable;
    const upwardInitialVariable = upwardLinkVariable ?? nodeVariable;
    let currentVariable = isUpwardEdge ? upwardInitialVariable : parentVariable;
    let predicateCursor = 0;
    let emittedStatements = 0;

    for (let pathIndex = startIndex; pathIndex < nodePathArray.length; pathIndex += 1) {
      const pathElement = nodePathArray[pathIndex]!;
      const indent = "  ".repeat(nodeDepth + 1);
      const pathTerm = formatIriTerm(pathElement, prefixes, usedPrefixes);

      if (pathIndex % 2 === 0) {
        if (hasSharedTerminalTypeWithParent && pathIndex === nodePathArray.length - 1) {
          continue;
        }

        const typeSubjectVariable =
          pathIndex === nodePathArray.length - 1 ? nodeVariable : currentVariable;
        const typeStatement = `${typeSubjectVariable} a ${pathTerm} .`;
        const shouldCommentTypeStatement = shouldDisregardNonRootNodeTypes && pathIndex > 0;

        whereStatements.push({
          line: shouldCommentTypeStatement
            ? `${indent}# ${typeStatement}`
            : `${indent}${typeStatement}`,
          nodeId,
        });
        emittedStatements += 1;
        continue;
      }

      const isLastPredicate = predicateIndexes[predicateIndexes.length - 1] === pathIndex;
      const nextVariable = isLastPredicate
        ? terminalVariable
        : `${nodeVariable}_p${String(predicateCursor)}`;

      whereStatements.push({
        line: `${indent}${currentVariable} ${pathTerm} ${nextVariable} .`,
        nodeId,
      });
      emittedStatements += 1;
      currentVariable = nextVariable;
      predicateCursor += 1;
    }

    if (
      emittedStatements === 0 &&
      isUpwardEdge &&
      parentContext != null &&
      parentVariable !== nodeVariable
    ) {
      const indent = "  ".repeat(nodeDepth + 1);
      whereStatements.push({
        line: `${indent}BIND(${parentVariable} AS ${nodeVariable})`,
        nodeId,
      });
    }
  }

  function emitNodeWithOrderedEdges(
    node: ModelAstNode,
    parent: ModelAstNode | undefined,
    parentContext: NodeSerializationContext | undefined,
  ): undefined | string {
    const incomingParentVariable = parentContext?.variable;
    const nodeId = stringifyPath(node.data.id_array);
    const nodeVariable = nodeVariableById.get(nodeId);
    const nodePathArray = getEffectiveNodePathArray(node, parent);
    const nodeOwnStatementStart =
      parent != null && node.data.parentEdgeEntityReferencePath != null
        ? node.data.parentEdgeEntityReferencePath.first_own_statement
        : node.data.targetPath.first_own_statement;
    const nodeContext =
      nodeVariable == null
        ? undefined
        : {
            pathArray: nodePathArray,
            variable: nodeVariable,
          };
    const upwardChildren = node.children.filter((child) => isUpwardChildNode(child, node));
    const downwardChildren = node.children.filter((child) => !isUpwardChildNode(child, node));
    let nextParentContext = parentContext;
    const shouldWrapInOptional =
      parent != null &&
      (shouldMakeAllFieldsOptional ||
        (shouldMakeEntityReferenceSubtreesOptional &&
          node.data.parentEdgeEntityReferencePath != null));
    const optionalIndent = "  ".repeat((normalizedIndentDepthByNodeId.get(nodeId) ?? 0) + 1);

    if (shouldWrapInOptional) {
      whereStatements.push({
        line: `${optionalIndent}OPTIONAL {`,
        nodeId,
      });
    }

    let upwardLinkVariable: undefined | string;
    for (const upwardChild of upwardChildren) {
      const upwardChildPathArray = getEffectiveNodePathArray(upwardChild, node);
      const upwardParentContext = nodeVariable == null ? undefined : { variable: nodeVariable };
      const upwardVariable = emitNodeWithOrderedEdges(upwardChild, node, upwardParentContext);

      if (upwardVariable != null && upwardChild.data.parentEdgeEntityReferencePath == null) {
        upwardLinkVariable = upwardVariable;
        if (node.data.parentEdgeEntityReferencePath == null) {
          nextParentContext = {
            pathArray: upwardChildPathArray,
            variable: upwardVariable,
          };
        }
      }
    }

    emitNodeStatements(
      node,
      parent,
      nodePathArray,
      nodeOwnStatementStart,
      nextParentContext,
      upwardLinkVariable,
      incomingParentVariable,
    );

    for (const downwardChild of downwardChildren) {
      emitNodeWithOrderedEdges(downwardChild, node, nodeContext);
    }

    if (shouldWrapInOptional) {
      whereStatements.push({
        line: `${optionalIndent}}`,
        nodeId,
      });
    }

    return nodeVariable;
  }

  const orderedRoots = [...tree.children].sort((left, right) => {
    if (left.data.id_array.length !== right.data.id_array.length) {
      return left.data.id_array.length - right.data.id_array.length;
    }

    return left.data.id.localeCompare(right.data.id);
  });

  for (const root of orderedRoots) {
    emitNodeWithOrderedEdges(root, undefined, undefined);
  }

  const firstWhereIndexByNodeId = new Map<string, number>();
  const firstWhereIndentByNodeId = new Map<string, string>();
  for (const [index, statement] of whereStatements.entries()) {
    if (!firstWhereIndexByNodeId.has(statement.nodeId)) {
      firstWhereIndexByNodeId.set(statement.nodeId, index);
      firstWhereIndentByNodeId.set(statement.nodeId, /^\s*/.exec(statement.line)?.[0] ?? "");
    }
  }
  const nodeIdsInWhereOrder = allNodes
    .map(({ node }) => stringifyPath(node.data.id_array))
    .sort((leftNodeId, rightNodeId) => {
      const leftIndex = firstWhereIndexByNodeId.get(leftNodeId) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = firstWhereIndexByNodeId.get(rightNodeId) ?? Number.MAX_SAFE_INTEGER;

      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }

      const leftVisit = nodeVisitOrder.get(leftNodeId) ?? Number.MAX_SAFE_INTEGER;
      const rightVisit = nodeVisitOrder.get(rightNodeId) ?? Number.MAX_SAFE_INTEGER;

      if (leftVisit !== rightVisit) {
        return leftVisit - rightVisit;
      }

      return leftNodeId.localeCompare(rightNodeId);
    });
  const selectedNodeIdsInWhereOrder = nodeIdsInWhereOrder.filter((nodeId) => {
    return nodeById.get(nodeId)?.data.selected != null;
  });
  const selectVariables = nodeIdsInWhereOrder.map((nodeId) => {
    const node = nodeById.get(nodeId);
    const variable = nodeVariableById.get(nodeId) ?? "?v";
    const indentDepth = normalizedIndentDepthByNodeId.get(nodeId) ?? 0;
    const whereIndent = firstWhereIndentByNodeId.get(nodeId);
    const isSelected = node?.data.selected != null;

    return {
      commentedOut: !isSelected,
      variable: node?.data.selected === "count" ? `${variable}_count` : variable,
      indentDepth,
      indent: whereIndent ?? "  ".repeat(indentDepth + 1),
    };
  });
  const selectClause =
    selectedNodeIdsInWhereOrder.length === 0
      ? "SELECT *"
      : `SELECT\n${selectVariables
          .map(({ commentedOut, indent, variable }) => {
            const commentedIndent = indent.length >= 1 ? indent.slice(0, -1) : "";

            return commentedOut
              ? `${commentedIndent}#${variable}`
              : `${indent}${variable}`;
          })
          .join("\n")}`;

  const countNodeIds = allNodes
    .filter(({ node }) => node.data.selected === "count")
    .map(({ node }) => stringifyPath(node.data.id_array));

  function getExplicitAnchorNodeId(countNodeId: string): undefined | string {
    let cursor = parentByNodeId.get(countNodeId);

    while (cursor != null) {
      const node = nodeById.get(cursor);

      if (node?.data.selected === "value") {
        return cursor;
      }

      cursor = parentByNodeId.get(cursor);
    }

    return undefined;
  }

  function isDescendantOrSame(nodeId: string, ancestorNodeId: string): boolean {
    let cursor: undefined | string = nodeId;

    while (cursor != null) {
      if (cursor === ancestorNodeId) {
        return true;
      }

      cursor = parentByNodeId.get(cursor);
    }

    return false;
  }

  function getImplicitRootNodeIdForCount(countNodeId: string): undefined | string {
    const otherSelectedNodeIds = selectedNodeIdsInWhereOrder.filter(
      (nodeId) => nodeId !== countNodeId,
    );

    if (otherSelectedNodeIds.length === 0) {
      return countNodeId;
    }

    let cursor: undefined | string = countNodeId;

    while (cursor != null) {
      if (otherSelectedNodeIds.every((nodeId) => isDescendantOrSame(nodeId, cursor!))) {
        return cursor;
      }

      cursor = parentByNodeId.get(cursor);
    }

    return undefined;
  }

  function getPathNodeIdsFromAnchorToCount(
    anchorNodeId: string,
    countNodeId: string,
    includeAnchorNode: boolean,
  ): Array<string> {
    const pathFromCount: Array<string> = [];
    let cursor: undefined | string = countNodeId;

    while (cursor != null) {
      pathFromCount.push(cursor);

      if (cursor === anchorNodeId) {
        break;
      }

      cursor = parentByNodeId.get(cursor);
    }

    if (pathFromCount[pathFromCount.length - 1] !== anchorNodeId) {
      return [];
    }

    pathFromCount.reverse();

    if (anchorNodeId === countNodeId) {
      return pathFromCount;
    }

    return includeAnchorNode ? pathFromCount : pathFromCount.slice(1);
  }

  function getPathNodeIdsFromRootToNode(nodeId: string): Array<string> {
    const path: Array<string> = [];
    let cursor: undefined | string = nodeId;

    while (cursor != null) {
      path.push(cursor);
      cursor = parentByNodeId.get(cursor);
    }

    path.reverse();
    return path;
  }

  const countWrappers = countNodeIds
    .map((countNodeId) => {
      const explicitAnchorNodeId = getExplicitAnchorNodeId(countNodeId);
      const implicitRootNodeId =
        explicitAnchorNodeId == null ? getImplicitRootNodeIdForCount(countNodeId) : undefined;
      const anchorNodeId = explicitAnchorNodeId ?? implicitRootNodeId ?? countNodeId;
      const hasAnchor = anchorNodeId !== countNodeId;
      const anchorVariable = hasAnchor ? nodeVariableById.get(anchorNodeId) : undefined;
      const countVariable = nodeVariableById.get(countNodeId);
      const isLoneImplicitCountSelection =
        explicitAnchorNodeId == null &&
        implicitRootNodeId === countNodeId &&
        selectedNodeIdsInWhereOrder.filter((nodeId) => nodeId !== countNodeId).length === 0;

      if (countVariable == null || (hasAnchor && anchorVariable == null)) {
        return null;
      }

      const pathNodeIds = isLoneImplicitCountSelection
        ? getPathNodeIdsFromRootToNode(countNodeId)
        : getPathNodeIdsFromAnchorToCount(anchorNodeId, countNodeId, !hasAnchor);

      if (pathNodeIds.length === 0) {
        return null;
      }

      const pathNodeIdSet = new Set(pathNodeIds);
      const statementIndexes = whereStatements
        .map((statement, index) => {
          return pathNodeIdSet.has(statement.nodeId) ? index : undefined;
        })
        .filter((index): index is number => index != null);

      if (statementIndexes.length === 0) {
        return null;
      }

      return {
        anchorVariable,
        countVariable,
        hasAnchor,
        statementIndexes,
      };
    })
    .filter(
      (
        wrapper,
      ): wrapper is {
        anchorVariable: string | undefined;
        countVariable: string;
        hasAnchor: boolean;
        statementIndexes: Array<number>;
      } => wrapper != null,
    )
    .sort((left, right) => {
      const leftStart = left.statementIndexes[0] ?? 0;
      const rightStart = right.statementIndexes[0] ?? 0;

      if (leftStart !== rightStart) {
        return leftStart - rightStart;
      }

      return right.statementIndexes.length - left.statementIndexes.length;
    });

  const wrappersByStartIndex = new Map<
    number,
    Array<{
      anchorVariable: string | undefined;
      countVariable: string;
      hasAnchor: boolean;
      statementIndexes: Array<number>;
    }>
  >();
  for (const wrapper of countWrappers) {
    const startIndex = wrapper.statementIndexes[0];

    if (startIndex == null) {
      continue;
    }

    const wrappersAtStart = wrappersByStartIndex.get(startIndex);

    if (wrappersAtStart == null) {
      wrappersByStartIndex.set(startIndex, [wrapper]);
      continue;
    }

    wrappersAtStart.push(wrapper);
  }
  const coveredStatementIndexes = new Set<number>(
    countWrappers.flatMap((wrapper) => wrapper.statementIndexes),
  );
  const whereLines: Array<string> = [];

  for (const [statementIndex, statement] of whereStatements.entries()) {
    const wrappers = wrappersByStartIndex.get(statementIndex);

    if (wrappers != null) {
      for (const wrapper of wrappers) {
        const originalLines = wrapper.statementIndexes.map((index) => {
          return whereStatements[index]!.line;
        });
        const indent = /^\s*/.exec(originalLines[0]!)?.[0] ?? "";
        const anchorVariable = wrapper.anchorVariable;
        const optionalPrefix =
          shouldIncludeZeroCountResults && wrapper.hasAnchor ? "OPTIONAL " : "";

        whereLines.push(
          wrapper.hasAnchor
            ? `${indent}${optionalPrefix}{ SELECT ${anchorVariable ?? ""} (COUNT(${shouldCountDistinct ? "DISTINCT " : ""}${wrapper.countVariable}) AS ${wrapper.countVariable}_count) WHERE {`
            : `${indent}SELECT (COUNT(${shouldCountDistinct ? "DISTINCT " : ""}${wrapper.countVariable}) AS ${wrapper.countVariable}_count) WHERE {`,
        );
        whereLines.push(...originalLines);
        whereLines.push(
          wrapper.hasAnchor ? `${indent}} GROUP BY ${anchorVariable ?? ""} }` : `${indent}}`,
        );
      }
    }

    if (coveredStatementIndexes.has(statementIndex)) {
      continue;
    }

    whereLines.push(statement.line);
  }

  const whereClause =
    whereLines.length === 0 ? "WHERE { }" : `WHERE {\n${whereLines.join("\n")}\n}`;
  const prefixStatements = prefixes
    .filter((prefix) => usedPrefixes.has(prefix.prefix))
    .map((prefix) => `PREFIX ${prefix.prefix}: <${prefix.iri}>`);
  const prefixBlock = prefixStatements.join("\n");
  const normalizedNamedGraph = config.sparql.namedGraph.trim();
  const fromClause =
    normalizedNamedGraph.length > 0 ? `\nFROM <${escapeIriForSparql(normalizedNamedGraph)}>` : "";
  const orderByVariable = config.sparql.orderBy?.[0]?.trim() ?? "";
  const orderByDirection = config.sparql.orderBy?.[1] ?? "ASC";
  const orderByClause =
    orderByVariable === ""
      ? ""
      : `\nORDER BY ${orderByDirection === "DESC" ? "DESC" : "ASC"}(?${orderByVariable})`;
  const limitValue =
    typeof config.sparql.limit === "number" && Number.isInteger(config.sparql.limit)
      ? config.sparql.limit
      : undefined;
  const limitClause = limitValue == null ? "" : `\nLIMIT ${String(Math.max(0, limitValue))}`;

  return `${prefixBlock.length > 0 ? `${prefixBlock}\n\n` : ""}${selectClause}${fromClause}\n${whereClause}${orderByClause}${limitClause}`;
}

export function createSparqlProcessor(
  prefixes: Array<PrefixEntry> = TYPE_PREFIXES,
  config: SparqlProcessorConfig,
): SparqlUnifiedProcessor {
  const transforms: Array<SparqlAstTransformer> = [];
  const compiler: SparqlCompiler = (tree) => compileAstToSparql(tree, prefixes, config);

  return {
    processSync(tree: ModelSubgraphAst): string {
      for (const transform of transforms) {
        transform(tree);
      }

      return compiler(tree);
    },
    use(transformer: SparqlAstTransformer): SparqlUnifiedProcessor {
      transforms.push(transformer);
      return this;
    },
  };
}

export function serializeScenarioToSparql(
  scenario: Scenario,
  pathbuilder: null | Pathbuilder,
): string {
  const ast = createSelectedSubgraphAst(scenario, pathbuilder);

  return createSparqlProcessor(TYPE_PREFIXES, {
    sparql: scenario.sparql,
  }).processSync(ast);
}

export function getSelectedVariableNames(
  modelState: Scenario,
  pathbuilder: null | Pathbuilder,
): Array<string> {
  const ast = createSelectedSubgraphAst(modelState, pathbuilder);
  const { selectedVariables } = createNodeVariableMaps(ast);

  return selectedVariables.map(({ variable }) => variable);
}
