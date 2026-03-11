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
  onExpandBottom: (idPath: Array<string>) => void,
  onSelectNode: (idPath: Array<string>, count: boolean) => void,
  onExpandTop: (idPath: Array<string>) => void,
): {
  edges: Array<GraphEdge>;
  nodes: Array<GraphNode>;
} {
  return createSerializerGraphFromScenario(
    scenario,
    pathbuilder,
    onExpandBottom,
    onSelectNode,
    onExpandTop,
  ) as {
    edges: Array<GraphEdge>;
    nodes: Array<GraphNode>;
  };
}
