import { useReducer } from "react";

export type OrderByDirection = "ASC" | "DESC";
export type OrderByState = [string, OrderByDirection];
export type SelectedState = "count" | "value";

export interface NodeState {
  id: Array<string>;
  selected?: SelectedState;
}

export interface SparqlConfigState {
  countDistinct: boolean;
  disregardTypesOfNonRootNodes: boolean;
  includeZeroCountResults: boolean;
  limit?: number;
  makeAllFieldsOptional: boolean;
  makeEntityReferencesOptional: boolean;
  namedGraph: string;
  omitPathPrefixesUnlessExplicitlySelected: boolean;
  orderBy?: OrderByState;
}

export interface Scenario {
  nodes: Array<NodeState>;
  sparql: SparqlConfigState;
  xmlSource: string;
}

export const defaultXmlSource =
  typeof __DEFAULT_XML__ === "string" ? __DEFAULT_XML__ : "";

export const defaultSparqlConfig: SparqlConfigState = {
  countDistinct: false,
  disregardTypesOfNonRootNodes: false,
  includeZeroCountResults: true,
  limit: undefined,
  makeAllFieldsOptional: false,
  makeEntityReferencesOptional: false,
  namedGraph: "",
  omitPathPrefixesUnlessExplicitlySelected: true,
  orderBy: undefined,
};

export const defaultScenario: Scenario = {
  nodes: [],
  sparql: defaultSparqlConfig,
  xmlSource: defaultXmlSource,
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
    id,
    selected: undefined,
  };
}

export function normalizeNodeState(
  nodeState: Pick<NodeState, "id"> & Partial<Pick<NodeState, "selected">>,
): NodeState {
  return {
    id: nodeState.id,
    selected:
      nodeState.selected === "count" || nodeState.selected === "value"
        ? nodeState.selected
        : undefined,
  };
}

export function normalizeSparqlConfig(
  sparqlConfig?: Partial<SparqlConfigState>,
): SparqlConfigState {
  const nextOrderBy = sparqlConfig?.orderBy;
  const nextLimit =
    typeof sparqlConfig?.limit === "number" &&
    Number.isInteger(sparqlConfig.limit)
      ? Math.max(0, sparqlConfig.limit)
      : undefined;

  return {
    countDistinct:
      sparqlConfig?.countDistinct ?? defaultSparqlConfig.countDistinct,
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
    omitPathPrefixesUnlessExplicitlySelected:
      sparqlConfig?.omitPathPrefixesUnlessExplicitlySelected ??
      defaultSparqlConfig.omitPathPrefixesUnlessExplicitlySelected,
    orderBy:
      Array.isArray(nextOrderBy) && nextOrderBy[0].trim().length > 0
        ? nextOrderBy
        : undefined,
  };
}
