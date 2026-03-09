import {
  defaultScenario,
  defaultSparqlConfig,
  type NodeState,
  normalizeSparqlConfig,
  type OrderByState,
  type Scenario,
  type SelectedState,
} from "../scenario.ts";

function parseSelectedState(value: unknown): SelectedState {
  if (value === "count" || value === "yes") {
    return value;
  }

  return "no";
}

function parseNodeStateList(values: Array<string>): Array<NodeState> {
  const nodes: Array<NodeState> = [];

  for (const value of values) {
    try {
      const parsed = JSON.parse(value) as unknown;

      if (parsed == null || typeof parsed !== "object") {
        continue;
      }

      const candidate = parsed as Partial<NodeState>;

      if (!Array.isArray(candidate.id)) {
        continue;
      }

      if (!candidate.id.every((part) => typeof part === "string")) {
        continue;
      }

      nodes.push({
        id: candidate.id,
        selected: parseSelectedState(candidate.selected),
      });
    } catch {
      continue;
    }
  }

  return nodes;
}

function parseBooleanParam(value: null | string): boolean | undefined {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return undefined;
}

function parseOrderByState(value: null | string): OrderByState | undefined {
  if (value === "none") {
    return value;
  }

  if (value?.startsWith("?")) {
    return value as `?${string}`;
  }

  return undefined;
}

export function parseModelStateFromSearch(search: string): Scenario {
  const params = new URLSearchParams(search);
  const xmlSource = params.get("xmlSource");
  const nodes = parseNodeStateList(params.getAll("nodes"));
  const limitParam = params.get("limit");
  const parsedLimit =
    limitParam == null || limitParam.length === 0 ? undefined : Number.parseInt(limitParam, 10);
  const sparql = normalizeSparqlConfig({
    omitPathPrefixesUnlessExplicitlySelected: parseBooleanParam(
      params.get("omitPathPrefixesUnlessExplicitlySelected"),
    ),
    countDistinct: parseBooleanParam(params.get("countDistinct")),
    direction: params.get("direction") === "DESC" ? "DESC" : "ASC",
    disregardTypesOfNonRootNodes: parseBooleanParam(params.get("disregardTypesOfNonRootNodes")),
    includeZeroCountResults: parseBooleanParam(params.get("includeZeroCountResults")),
    limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    makeAllFieldsOptional: parseBooleanParam(params.get("makeAllFieldsOptional")),
    makeEntityReferencesOptional: parseBooleanParam(params.get("makeEntityReferencesOptional")),
    namedGraph: params.get("namedGraph") ?? undefined,
    orderBy: parseOrderByState(params.get("orderBy")),
  });

  return {
    nodes: nodes.length > 0 ? nodes : defaultScenario.nodes,
    sparql,
    xmlSource: xmlSource ?? defaultScenario.xmlSource,
  };
}

export function serializeModelStateToSearch(modelState: Scenario): string {
  const params = new URLSearchParams();

  if (modelState.xmlSource !== defaultScenario.xmlSource) {
    params.set("xmlSource", modelState.xmlSource);
  }

  if (
    modelState.sparql.disregardTypesOfNonRootNodes !==
    defaultSparqlConfig.disregardTypesOfNonRootNodes
  ) {
    params.set(
      "disregardTypesOfNonRootNodes",
      String(modelState.sparql.disregardTypesOfNonRootNodes),
    );
  }

  if (
    modelState.sparql.makeEntityReferencesOptional !==
    defaultSparqlConfig.makeEntityReferencesOptional
  ) {
    params.set(
      "makeEntityReferencesOptional",
      String(modelState.sparql.makeEntityReferencesOptional),
    );
  }

  if (modelState.sparql.makeAllFieldsOptional !== defaultSparqlConfig.makeAllFieldsOptional) {
    params.set("makeAllFieldsOptional", String(modelState.sparql.makeAllFieldsOptional));
  }

  if (
    modelState.sparql.omitPathPrefixesUnlessExplicitlySelected !==
    defaultSparqlConfig.omitPathPrefixesUnlessExplicitlySelected
  ) {
    params.set(
      "omitPathPrefixesUnlessExplicitlySelected",
      String(modelState.sparql.omitPathPrefixesUnlessExplicitlySelected),
    );
  }

  if (modelState.sparql.countDistinct !== defaultSparqlConfig.countDistinct) {
    params.set("countDistinct", String(modelState.sparql.countDistinct));
  }

  if (modelState.sparql.includeZeroCountResults !== defaultSparqlConfig.includeZeroCountResults) {
    params.set("includeZeroCountResults", String(modelState.sparql.includeZeroCountResults));
  }

  if (modelState.sparql.namedGraph !== defaultSparqlConfig.namedGraph) {
    params.set("namedGraph", modelState.sparql.namedGraph);
  }

  if (modelState.sparql.orderBy !== defaultSparqlConfig.orderBy) {
    params.set("orderBy", modelState.sparql.orderBy);
  }

  if (modelState.sparql.direction !== defaultSparqlConfig.direction) {
    params.set("direction", modelState.sparql.direction);
  }

  if (modelState.sparql.limit !== defaultSparqlConfig.limit) {
    params.set("limit", String(modelState.sparql.limit));
  }

  if (modelState.nodes.length > 0) {
    for (const node of modelState.nodes) {
      const serializableNode: Record<string, unknown> = { id: node.id };

      if (node.selected !== "no") {
        serializableNode.selected = node.selected;
      }

      params.append("nodes", JSON.stringify(serializableNode));
    }
  }

  const queryString = params.toString();
  return queryString.length > 0 ? `?${queryString}` : "";
}
