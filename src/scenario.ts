import { useReducer } from "react";

export type ExpandedState = "both" | "bottom" | "none" | "top";
export type OrderByState = "none" | `?${string}`;
export type SelectedState = "count" | "no" | "yes";

export interface NodeState {
  expanded: ExpandedState;
  id: Array<string>;
  selected: SelectedState;
}

export interface SparqlConfigState {
  countDistinct: boolean;
  direction: "ASC" | "DESC";
  disregardTypesOfNonRootNodes: boolean;
  includeZeroCountResults: boolean;
  limit?: number;
  makeAllFieldsOptional: boolean;
  makeEntityReferencesOptional: boolean;
  namedGraph: string;
  orderBy: OrderByState;
  alwaysIncludeFullPrefixConstraints: boolean;
}

export interface Scenario {
  nodes: Array<NodeState>;
  sparql: SparqlConfigState;
  xmlSource: string;
}

export const defaultSparqlConfig: SparqlConfigState = {
  alwaysIncludeFullPrefixConstraints: false,
  countDistinct: false,
  direction: "ASC",
  disregardTypesOfNonRootNodes: false,
  includeZeroCountResults: true,
  limit: undefined,
  makeAllFieldsOptional: false,
  makeEntityReferencesOptional: false,
  namedGraph: "",
  orderBy: "none",
};

export const defaultScenario: Scenario = {
  nodes: [],
  sparql: defaultSparqlConfig,
  xmlSource: __DEFAULT_XML__,
};

export type ScenarioAction =
  | { type: "state/replace"; payload: { scenario: Scenario } }
  | {
      type: "state/setSparqlConfig";
      payload: { sparql: Partial<SparqlConfigState> };
    }
  | { type: "state/setXmlSource"; payload: { xmlSource: string } }
  | { type: "state/setNodes"; payload: { nodes: Array<NodeState> } }
  | { type: "state/reset" };

export function scenarioReducer(
  state: Scenario,
  action: ScenarioAction,
): Scenario {
  switch (action.type) {
    case "state/replace": {
      return {
        ...action.payload.scenario,
        nodes: action.payload.scenario.nodes.map((node) =>
          normalizeNodeState(node),
        ),
        sparql: normalizeSparqlConfig(action.payload.scenario.sparql),
      };
    }

    case "state/setNodes": {
      return {
        ...state,
        nodes: action.payload.nodes.map((node) => normalizeNodeState(node)),
      };
    }
    case "state/setSparqlConfig": {
      return {
        ...state,
        sparql: normalizeSparqlConfig({
          ...state.sparql,
          ...action.payload.sparql,
        }),
      };
    }
    case "state/setXmlSource": {
      return {
        ...state,
        xmlSource: action.payload.xmlSource,
      };
    }

    case "state/reset": {
      return defaultScenario;
    }
  }
}

export function useScenario() {
  return useReducer(scenarioReducer, defaultScenario);
}

export function createDefaultNodeState(id: Array<string>): NodeState {
  return {
    expanded: "none",
    id,
    selected: "no",
  };
}

export function normalizeNodeState(
  nodeState: Pick<NodeState, "id"> & Partial<Omit<NodeState, "id">>,
): NodeState {
  return {
    expanded: nodeState.expanded ?? "none",
    id: nodeState.id,
    selected:
      nodeState.selected === "count" || nodeState.selected === "yes"
        ? nodeState.selected
        : "no",
  };
}

export function normalizeSparqlConfig(
  sparqlConfig?: Partial<SparqlConfigState>,
): SparqlConfigState {
  const nextLimit =
    typeof sparqlConfig?.limit === "number" &&
    Number.isInteger(sparqlConfig.limit)
      ? Math.max(0, sparqlConfig.limit)
      : undefined;

  return {
    alwaysIncludeFullPrefixConstraints:
      sparqlConfig?.alwaysIncludeFullPrefixConstraints ??
      defaultSparqlConfig.alwaysIncludeFullPrefixConstraints,
    countDistinct:
      sparqlConfig?.countDistinct ?? defaultSparqlConfig.countDistinct,
    direction: sparqlConfig?.direction === "DESC" ? "DESC" : "ASC",
    disregardTypesOfNonRootNodes:
      sparqlConfig?.disregardTypesOfNonRootNodes ??
      defaultSparqlConfig.disregardTypesOfNonRootNodes,
    includeZeroCountResults:
      sparqlConfig?.includeZeroCountResults ??
      defaultSparqlConfig.includeZeroCountResults,
    limit: nextLimit,
    makeAllFieldsOptional:
      sparqlConfig?.makeAllFieldsOptional ??
      defaultSparqlConfig.makeAllFieldsOptional,
    makeEntityReferencesOptional:
      sparqlConfig?.makeEntityReferencesOptional ??
      defaultSparqlConfig.makeEntityReferencesOptional,
    namedGraph: sparqlConfig?.namedGraph ?? defaultSparqlConfig.namedGraph,
    orderBy:
      sparqlConfig?.orderBy === "none" || sparqlConfig?.orderBy?.startsWith("?")
        ? sparqlConfig.orderBy
        : "none",
  };
}

export function isBottomExpanded(
  nodeState?: Pick<NodeState, "expanded">,
): boolean {
  return nodeState?.expanded === "both" || nodeState?.expanded === "bottom";
}

export function isTopExpanded(
  nodeState?: Pick<NodeState, "expanded">,
): boolean {
  return nodeState?.expanded === "both" || nodeState?.expanded === "top";
}

export function withBottomExpanded(
  nodeState: NodeState,
  expanded: boolean,
): NodeState {
  const topExpanded = isTopExpanded(nodeState);

  return {
    ...nodeState,
    expanded: expanded
      ? topExpanded
        ? "both"
        : "bottom"
      : topExpanded
        ? "top"
        : "none",
  };
}

export function withTopExpanded(
  nodeState: NodeState,
  expanded: boolean,
): NodeState {
  const bottomExpanded = isBottomExpanded(nodeState);

  return {
    ...nodeState,
    expanded: expanded
      ? bottomExpanded
        ? "both"
        : "top"
      : bottomExpanded
        ? "bottom"
        : "none",
  };
}
