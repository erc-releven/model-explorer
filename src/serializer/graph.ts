import { isBottomExpanded, isTopExpanded, type Scenario, type SelectedState } from "../scenario";
import type { Pathbuilder, PathbuilderPath } from "./pathbuilder";

export interface PathNodeData extends Record<string, unknown> {
  bottomExpanded: boolean;
  countDistinct?: number;
  countTotal?: number;
  hasChildren: boolean;
  hasReferences: boolean;
  id_array: Array<string>;
  onExpandBottom: (idPath: Array<string>) => void;
  onExpandTop: (idPath: Array<string>) => void;
  onSelectNode: (idPath: Array<string>, count: boolean) => void;
  row_index: number;
  selected: SelectedState;
  targetPath: PathbuilderPath;
  topExpanded: boolean;
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

function stringifyPath(path: Array<string>): string {
  return path.join("");
}

function createPathNode(
  path: Array<string>,
  pathbuilderPath: PathbuilderPath,
  bottomExpanded: boolean,
  onExpandBottom: (idPath: Array<string>) => void,
  onSelectNode: (idPath: Array<string>, count: boolean) => void,
  onExpandTop: (idPath: Array<string>) => void,
  topExpanded: boolean,
  selected: SelectedState,
  rowIndex: number,
): ScenarioGraphNode {
  return {
    data: {
      bottomExpanded,
      hasChildren: Object.keys(pathbuilderPath.children).length > 0,
      hasReferences: pathbuilderPath.references.length > 0,
      id_array: path,
      onExpandBottom,
      onExpandTop,
      onSelectNode,
      row_index: rowIndex,
      selected,
      targetPath: pathbuilderPath,
      topExpanded,
    },
    id: stringifyPath(path),
    position: { x: 0, y: rowIndex * 160 },
    type: "pathNode",
  };
}

export function createGraphFromScenario(
  scenario: Scenario,
  pathbuilder: null | Pathbuilder,
  onExpandBottom: (idPath: Array<string>) => void,
  onSelectNode: (idPath: Array<string>, count: boolean) => void,
  onExpandTop: (idPath: Array<string>) => void,
): {
  edges: Array<ScenarioGraphEdge>;
  nodes: Array<ScenarioGraphNode>;
} {
  if (scenario.nodes.length === 0 || pathbuilder == null) {
    return { edges: [], nodes: [] };
  }

  const rootModelNode = scenario.nodes[0];

  if (rootModelNode == null) {
    return { edges: [], nodes: [] };
  }

  const rootPathbuilderNode = pathbuilder.getPathById(rootModelNode.id.at(-1)!);

  if (rootPathbuilderNode == null) {
    return { edges: [], nodes: [] };
  }

  const modelNodeByPath = new Map(scenario.nodes.map((node) => [stringifyPath(node.id), node]));
  const nodes: Array<ScenarioGraphNode> = [];
  const edges: Array<ScenarioGraphEdge> = [];

  function addNodesAndEdges(
    graphNode: ScenarioGraphNode,
    parentNode?: ScenarioGraphNode,
    incomingEntityReference?: PathbuilderPath,
  ): void {
    nodes.push(graphNode);

    if (parentNode != null) {
      edges.push({
        data:
          incomingEntityReference == null
            ? undefined
            : { entityReferencePath: incomingEntityReference },
        id: `${parentNode.id}->${graphNode.id}`,
        label: incomingEntityReference?.name,
        source: parentNode.id,
        sourceHandle: "bottom",
        target: graphNode.id,
        targetHandle: "top",
      });
    }

    if (graphNode.data.topExpanded && graphNode.data.targetPath.references.length > 0) {
      for (const referenceId of graphNode.data.targetPath.references) {
        const referencePathbuilderNode = pathbuilder.getPathById(referenceId);

        if (referencePathbuilderNode == null) {
          continue;
        }

        const referenceParentPathbuilderNode =
          referencePathbuilderNode.group == null
            ? referencePathbuilderNode
            : (pathbuilder.getPathById(referencePathbuilderNode.group) ?? referencePathbuilderNode);
        const referencePath = [...graphNode.data.id_array, "<", referenceId];
        const referenceModelNode = modelNodeByPath.get(stringifyPath(referencePath));
        const referenceGraphNode = createPathNode(
          referencePath,
          referenceParentPathbuilderNode,
          isBottomExpanded(referenceModelNode),
          onExpandBottom,
          onSelectNode,
          onExpandTop,
          isTopExpanded(referenceModelNode),
          referenceModelNode?.selected ?? "no",
          graphNode.data.row_index - 1,
        );

        addNodesAndEdges(referenceGraphNode);
        edges.push({
          data: { entityReferencePath: referencePathbuilderNode },
          id: `${referenceGraphNode.id}->${graphNode.id}`,
          label: referencePathbuilderNode.name,
          source: referenceGraphNode.id,
          sourceHandle: "bottom",
          target: graphNode.id,
          targetHandle: "top",
        });
      }
    } else if (
      graphNode.data.topExpanded &&
      graphNode.data.id_array.at(-2) === "<" &&
      graphNode.data.targetPath.group != null
    ) {
      const parentPathbuilderNode = pathbuilder.getPathById(graphNode.data.targetPath.group);

      if (parentPathbuilderNode != null) {
        const parentPath = [...graphNode.data.id_array, "<", parentPathbuilderNode.id];
        const parentModelNode = modelNodeByPath.get(stringifyPath(parentPath));
        const parentGraphNode = createPathNode(
          parentPath,
          parentPathbuilderNode,
          isBottomExpanded(parentModelNode),
          onExpandBottom,
          onSelectNode,
          onExpandTop,
          isTopExpanded(parentModelNode),
          parentModelNode?.selected ?? "no",
          graphNode.data.row_index - 1,
        );

        addNodesAndEdges(parentGraphNode);
        edges.push({
          id: `${parentGraphNode.id}->${graphNode.id}`,
          source: parentGraphNode.id,
          sourceHandle: "bottom",
          target: graphNode.id,
          targetHandle: "top",
        });
      }
    }

    if (!graphNode.data.bottomExpanded) {
      return;
    }

    for (const childId of Object.keys(graphNode.data.targetPath.children)) {
      const childPathbuilderNode = graphNode.data.targetPath.children[childId]!;
      const childPath = [...graphNode.data.id_array, ">", childId];
      const childModelNode = modelNodeByPath.get(stringifyPath(childPath));

      if (childPathbuilderNode.entity_reference == null) {
        const childGraphNode = createPathNode(
          childPath,
          childPathbuilderNode,
          isBottomExpanded(childModelNode),
          onExpandBottom,
          onSelectNode,
          onExpandTop,
          isTopExpanded(childModelNode),
          childModelNode?.selected ?? "no",
          graphNode.data.row_index + 1,
        );
        addNodesAndEdges(childGraphNode, graphNode);
        continue;
      }

      const referencedPathbuilderNode = pathbuilder.getPathByType(
        childPathbuilderNode.entity_reference,
      );

      if (referencedPathbuilderNode == null) {
        const childGraphNode = createPathNode(
          childPath,
          childPathbuilderNode,
          isBottomExpanded(childModelNode),
          onExpandBottom,
          onSelectNode,
          onExpandTop,
          isTopExpanded(childModelNode),
          childModelNode?.selected ?? "no",
          graphNode.data.row_index + 1,
        );
        addNodesAndEdges(childGraphNode, graphNode);
        continue;
      }

      const referencedGraphNode = createPathNode(
        childPath,
        referencedPathbuilderNode,
        isBottomExpanded(childModelNode),
        onExpandBottom,
        onSelectNode,
        onExpandTop,
        isTopExpanded(childModelNode),
        childModelNode?.selected ?? "no",
        graphNode.data.row_index + 1,
      );
      addNodesAndEdges(referencedGraphNode, graphNode, childPathbuilderNode);
    }
  }

  const rootModelNodeState = modelNodeByPath.get(stringifyPath(rootModelNode.id));
  const rootGraphNode = createPathNode(
    rootModelNode.id,
    rootPathbuilderNode,
    isBottomExpanded(rootModelNodeState),
    onExpandBottom,
    onSelectNode,
    onExpandTop,
    isTopExpanded(rootModelNodeState),
    rootModelNodeState?.selected ?? "no",
    0,
  );
  addNodesAndEdges(rootGraphNode);

  return { edges, nodes };
}
