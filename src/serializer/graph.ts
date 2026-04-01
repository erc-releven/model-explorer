import type { Scenario, SelectedState } from "../scenario";
import type { Pathbuilder, PathbuilderPath } from "./pathbuilder";

export interface PathNodeExpansionOption {
  id: string;
  label: string;
  path: Array<string>;
  visible: boolean;
}

export interface PathNodeData extends Record<string, unknown> {
  bottomExpansionOptions: Array<PathNodeExpansionOption>;
  countDistinct?: number;
  countTotal?: number;
  hasChildren: boolean;
  hasReferences: boolean;
  id_array: Array<string>;
  onSetBottomOptionsVisibility: (
    idPath: Array<string>,
    optionPaths: Array<Array<string>>,
    visible: boolean,
  ) => void;
  onSetTopOptionsVisibility: (
    idPath: Array<string>,
    optionPaths: Array<Array<string>>,
    visible: boolean,
  ) => void;
  onToggleBottomOption: (idPath: Array<string>, optionPath: Array<string>) => void;
  onToggleTopOption: (idPath: Array<string>, optionPath: Array<string>) => void;
  onSelectNode: (idPath: Array<string>, count: boolean) => void;
  row_index: number;
  selected?: SelectedState;
  targetPath: PathbuilderPath;
  topExpansionOptions: Array<PathNodeExpansionOption>;
}

export interface ScenarioGraphNode {
  data: PathNodeData;
  id: string;
  position: { x: number; y: number };
  type: "pathNode";
}

export interface ScenarioGraphEdge {
  data?: { entityReferencePath: PathbuilderPath };
  id: string;
  label?: string;
  source: string;
  sourceHandle: "bottom";
  target: string;
  targetHandle: "top";
}

interface ResolvedScenarioNode {
  nodeState: Scenario["nodes"][number];
  rowIndex: number;
  targetPath: PathbuilderPath;
}

export function stringifyPath(path: Array<string>): string {
  return path.join("");
}

function getDirectParentPath(path: Array<string>): Array<string> {
  return path.length > 1 ? path.slice(0, -2) : [];
}

function getRowIndex(path: Array<string>): number {
  let rowIndex = 0;

  for (let index = 1; index < path.length; index += 2) {
    if (path[index] === ">") {
      rowIndex += 1;
      continue;
    }

    if (path[index] === "<") {
      rowIndex -= 1;
    }
  }

  return rowIndex;
}

function countTraversalSteps(path: Array<string>): number {
  return path.filter((part) => part === ">" || part === "<").length;
}

export function resolveTargetPathForNodePath(
  pathbuilder: Pathbuilder,
  nodePath: Array<string>,
): PathbuilderPath | undefined {
  const rootId = nodePath[0];

  if (rootId == null) {
    return undefined;
  }

  let currentPath = pathbuilder.getPathById(rootId);

  if (currentPath == null) {
    return undefined;
  }

  for (let index = 1; index < nodePath.length; index += 2) {
    const direction = nodePath[index];
    const segment = nodePath[index + 1];

    if (direction == null || segment == null) {
      return undefined;
    }

    if (direction === ">") {
      const childPath = currentPath.children[segment] as PathbuilderPath | undefined;

      if (childPath == null) {
        return undefined;
      }

      const entityReference = childPath.entity_reference;

      if (entityReference == null) {
        currentPath = childPath;
        continue;
      }

      currentPath = pathbuilder.getPathByType(entityReference) ?? childPath;
      continue;
    }

    if (direction !== "<") {
      return undefined;
    }

    if (currentPath.references.includes(segment)) {
      const referencePath = pathbuilder.getPathById(segment);

      if (referencePath == null) {
        return undefined;
      }

      currentPath =
        referencePath.group == null
          ? referencePath
          : (pathbuilder.getPathById(referencePath.group) ?? referencePath);
      continue;
    }

    if (currentPath.group === segment) {
      currentPath = pathbuilder.getPathById(segment) ?? currentPath;
      continue;
    }

    return undefined;
  }

  return currentPath;
}

function isDirectVisibleExtension(
  visiblePathKeys: Set<string>,
  nodePath: Array<string>,
  directPath: Array<string>,
): boolean {
  return (
    directPath.length === nodePath.length + 2 &&
    countTraversalSteps(directPath) === countTraversalSteps(nodePath) + 1 &&
    visiblePathKeys.has(stringifyPath(directPath))
  );
}

function getTopExpansionOptions(
  pathbuilder: Pathbuilder,
  visiblePathKeys: Set<string>,
  nodePath: Array<string>,
  targetPath: PathbuilderPath,
): Array<PathNodeExpansionOption> {
  const optionPaths =
    targetPath.references.length > 0
      ? targetPath.references.map((referenceId) => [...nodePath, "<", referenceId])
      : idPathReachedFromBelow(nodePath) && targetPath.group != null
        ? [[...nodePath, "<", targetPath.group]]
        : [];

  return optionPaths
    .map((path) => {
      const optionTargetPath = resolveTargetPathForNodePath(pathbuilder, path);

      if (optionTargetPath == null) {
        return undefined;
      }

      return {
        id: stringifyPath(path),
        label: optionTargetPath.name,
        path,
        visible: isDirectVisibleExtension(visiblePathKeys, nodePath, path),
      };
    })
    .filter((option): option is PathNodeExpansionOption => option != null);
}

function getBottomExpansionOptions(
  visiblePathKeys: Set<string>,
  nodePath: Array<string>,
  targetPath: PathbuilderPath,
): Array<PathNodeExpansionOption> {
  return Object.values(targetPath.children).map((childPath) => {
    const path = [...nodePath, ">", childPath.id];

    return {
      id: stringifyPath(path),
      label: childPath.name,
      path,
      visible: isDirectVisibleExtension(visiblePathKeys, nodePath, path),
    };
  });
}

function idPathReachedFromBelow(nodePath: Array<string>): boolean {
  return nodePath.at(-2) === "<";
}

function createPathNode(
  path: Array<string>,
  pathbuilderPath: PathbuilderPath,
  bottomExpansionOptions: Array<PathNodeExpansionOption>,
  onSetBottomOptionsVisibility: (
    idPath: Array<string>,
    optionPaths: Array<Array<string>>,
    visible: boolean,
  ) => void,
  onToggleBottomOption: (idPath: Array<string>, optionPath: Array<string>) => void,
  onSelectNode: (idPath: Array<string>, count: boolean) => void,
  onSetTopOptionsVisibility: (
    idPath: Array<string>,
    optionPaths: Array<Array<string>>,
    visible: boolean,
  ) => void,
  onToggleTopOption: (idPath: Array<string>, optionPath: Array<string>) => void,
  selected: SelectedState | undefined,
  rowIndex: number,
  topExpansionOptions: Array<PathNodeExpansionOption>,
): ScenarioGraphNode {
  return {
    data: {
      bottomExpansionOptions,
      hasChildren: Object.keys(pathbuilderPath.children).length > 0,
      hasReferences: pathbuilderPath.references.length > 0,
      id_array: path,
      onSetBottomOptionsVisibility,
      onSetTopOptionsVisibility,
      onToggleBottomOption,
      onToggleTopOption,
      onSelectNode,
      row_index: rowIndex,
      selected,
      targetPath: pathbuilderPath,
      topExpansionOptions,
    },
    id: stringifyPath(path),
    position: { x: 0, y: rowIndex * 160 },
    type: "pathNode",
  };
}

function createEdgeForNode(
  nodePath: Array<string>,
  nodeTargetPath: PathbuilderPath,
  parentPath: Array<string>,
  parentTargetPath: PathbuilderPath,
  pathbuilder: Pathbuilder,
): ScenarioGraphEdge | undefined {
  const direction = nodePath.at(-2);
  const segment = nodePath.at(-1);

  if (direction == null || segment == null) {
    return undefined;
  }

  if (direction === ">") {
    const childPath = parentTargetPath.children[segment];

    if (childPath == null) {
      return undefined;
    }

    return {
      data: childPath.entity_reference == null ? undefined : { entityReferencePath: childPath },
      id: `${stringifyPath(parentPath)}->${stringifyPath(nodePath)}`,
      label: childPath.entity_reference == null ? undefined : childPath.name,
      source: stringifyPath(parentPath),
      sourceHandle: "bottom",
      target: stringifyPath(nodePath),
      targetHandle: "top",
    };
  }

  if (direction !== "<") {
    return undefined;
  }

  if (parentTargetPath.references.includes(segment)) {
    const referencePath = pathbuilder.getPathById(segment);

    return {
      data: referencePath == null ? undefined : { entityReferencePath: referencePath },
      id: `${stringifyPath(nodePath)}->${stringifyPath(parentPath)}`,
      label: referencePath?.name,
      source: stringifyPath(nodePath),
      sourceHandle: "bottom",
      target: stringifyPath(parentPath),
      targetHandle: "top",
    };
  }

  if (nodeTargetPath.id === segment || parentTargetPath.group === segment) {
    return {
      id: `${stringifyPath(nodePath)}->${stringifyPath(parentPath)}`,
      source: stringifyPath(nodePath),
      sourceHandle: "bottom",
      target: stringifyPath(parentPath),
      targetHandle: "top",
    };
  }

  return undefined;
}

export function createGraphFromScenario(
  scenario: Scenario,
  pathbuilder: null | Pathbuilder,
  onSetBottomOptionsVisibility: (
    idPath: Array<string>,
    optionPaths: Array<Array<string>>,
    visible: boolean,
  ) => void,
  onToggleBottomOption: (idPath: Array<string>, optionPath: Array<string>) => void,
  onSelectNode: (idPath: Array<string>, count: boolean) => void,
  onSetTopOptionsVisibility: (
    idPath: Array<string>,
    optionPaths: Array<Array<string>>,
    visible: boolean,
  ) => void,
  onToggleTopOption: (idPath: Array<string>, optionPath: Array<string>) => void,
): {
  edges: Array<ScenarioGraphEdge>;
  nodes: Array<ScenarioGraphNode>;
} {
  if (scenario.nodes.length === 0 || pathbuilder == null) {
    return { edges: [], nodes: [] };
  }

  const visiblePathKeys = new Set(scenario.nodes.map((node) => stringifyPath(node.id)));
  const resolvedNodes: Array<ResolvedScenarioNode> = scenario.nodes
    .map((nodeState) => {
      const targetPath = resolveTargetPathForNodePath(pathbuilder, nodeState.id);

      if (targetPath == null) {
        return undefined;
      }

      return {
        nodeState,
        rowIndex: getRowIndex(nodeState.id),
        targetPath,
      };
    })
    .filter((node): node is ResolvedScenarioNode => node != null);
  const resolvedNodeById = new Map(
    resolvedNodes.map((node) => [stringifyPath(node.nodeState.id), node]),
  );
  const nodes = resolvedNodes.map(({ nodeState, rowIndex, targetPath }) => {
    const topExpansionOptions = getTopExpansionOptions(
      pathbuilder,
      visiblePathKeys,
      nodeState.id,
      targetPath,
    );
    const bottomExpansionOptions = getBottomExpansionOptions(
      visiblePathKeys,
      nodeState.id,
      targetPath,
    );

    return createPathNode(
      nodeState.id,
      targetPath,
      bottomExpansionOptions,
      onSetBottomOptionsVisibility,
      onToggleBottomOption,
      onSelectNode,
      onSetTopOptionsVisibility,
      onToggleTopOption,
      nodeState.selected,
      rowIndex,
      topExpansionOptions,
    );
  });
  const edges: Array<ScenarioGraphEdge> = [];

  for (const { nodeState, targetPath } of resolvedNodes) {
    const parentPath = getDirectParentPath(nodeState.id);

    if (parentPath.length === 0) {
      continue;
    }

    const parentNode = resolvedNodeById.get(stringifyPath(parentPath));

    if (parentNode == null) {
      continue;
    }

    const edge = createEdgeForNode(
      nodeState.id,
      targetPath,
      parentPath,
      parentNode.targetPath,
      pathbuilder,
    );

    if (edge != null) {
      edges.push(edge);
    }
  }

  return { edges, nodes };
}
