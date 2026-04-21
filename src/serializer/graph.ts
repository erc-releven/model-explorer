import type { Scenario, SelectedState } from "../scenario";
import type { Pathbuilder, PathbuilderPath } from "./pathbuilder";
import {
  getBottomExpansionOptions,
  getTopExpansionOptions,
  type PathNodeExpansionOption,
} from "../components/ModelViewer/graph/expansion-options";
import {
  resolveTargetPathForNodePath,
  resolveTransitionLabelForNodePath,
  stringifyPath,
} from "../components/ModelViewer/graph/graph-paths";

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
  onToggleBottomOption: (
    idPath: Array<string>,
    optionPath: Array<string>,
  ) => void;
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

function createPathNode(
  path: Array<string>,
  pathbuilderPath: PathbuilderPath,
  bottomExpansionOptions: Array<PathNodeExpansionOption>,
  onSetBottomOptionsVisibility: (
    idPath: Array<string>,
    optionPaths: Array<Array<string>>,
    visible: boolean,
  ) => void,
  onToggleBottomOption: (
    idPath: Array<string>,
    optionPath: Array<string>,
  ) => void,
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
      data:
        childPath.entity_reference == null
          ? undefined
          : { entityReferencePath: childPath },
      id: `${stringifyPath(parentPath)}->${stringifyPath(nodePath)}`,
      label: resolveTransitionLabelForNodePath(
        pathbuilder,
        nodePath,
        parentTargetPath,
      ),
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
      data:
        referencePath == null
          ? undefined
          : { entityReferencePath: referencePath },
      id: `${stringifyPath(nodePath)}->${stringifyPath(parentPath)}`,
      label: resolveTransitionLabelForNodePath(
        pathbuilder,
        nodePath,
        parentTargetPath,
      ),
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
  onToggleBottomOption: (
    idPath: Array<string>,
    optionPath: Array<string>,
  ) => void,
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

  const visiblePathKeys = new Set(
    scenario.nodes.map((node) => stringifyPath(node.id)),
  );
  const selectedNodes = scenario.nodes.filter((node) => node.selected != null);

  function isLockedBySelection(optionPath: Array<string>): boolean {
    return selectedNodes.some(
      (node) =>
        node.id.length >= optionPath.length &&
        optionPath.every((part, index) => node.id[index] === part),
    );
  }

  function lockSelectedOptions(
    options: Array<PathNodeExpansionOption>,
  ): Array<PathNodeExpansionOption> {
    if (selectedNodes.length === 0) {
      return options;
    }

    return options.map((option) => {
      if (option.disabled || !isLockedBySelection(option.path)) {
        return option;
      }

      return { ...option, disabled: true };
    });
  }

  const resolvedNodes: Array<ResolvedScenarioNode> = scenario.nodes
    .map((nodeState) => {
      const targetPath = resolveTargetPathForNodePath(
        pathbuilder,
        nodeState.id,
      );

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
    const topExpansionOptions = lockSelectedOptions(
      getTopExpansionOptions(
        pathbuilder,
        visiblePathKeys,
        nodeState.id,
        targetPath,
      ),
    );
    const bottomExpansionOptions = lockSelectedOptions(
      getBottomExpansionOptions(
        pathbuilder,
        visiblePathKeys,
        nodeState.id,
        targetPath,
      ),
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
