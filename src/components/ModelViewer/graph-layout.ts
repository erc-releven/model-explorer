import type { Edge, Node } from "@xyflow/react";

import type { Scenario } from "../../scenario";
import {
  createGraphFromScenario as createSerializerGraphFromScenario,
  type PathNodeData,
} from "../../serializer/graph";
import type { Pathbuilder } from "../../serializer/pathbuilder";

export type { PathNodeData };
export type GraphEdge = Edge;
export type GraphNode = Node<PathNodeData>;

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
  edges: Array<GraphEdge>;
  nodes: Array<GraphNode>;
} {
  return createSerializerGraphFromScenario(
    scenario,
    pathbuilder,
    onSetBottomOptionsVisibility,
    onToggleBottomOption,
    onSelectNode,
    onSetTopOptionsVisibility,
    onToggleTopOption,
  ) as {
    edges: Array<GraphEdge>;
    nodes: Array<GraphNode>;
  };
}
