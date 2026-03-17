import {
  defaultScenario,
  normalizeNodeState,
  normalizeSparqlConfig,
  type Scenario,
} from "./scenario";

export interface NamedScenario {
  name?: string;
  scenario: Scenario;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null;
}

function isStringArray(value: unknown): value is Array<string> {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function parseScenario(value: unknown): null | Scenario {
  if (!isRecord(value)) {
    return null;
  }

  const nodes = value.nodes;

  if (
    nodes != null &&
    (!Array.isArray(nodes) || nodes.some((node) => !isRecord(node) || !isStringArray(node.id)))
  ) {
    return null;
  }

  const normalizedNodes = (nodes ?? defaultScenario.nodes).map((node) => {
    const nodeRecord = node as Record<string, unknown>;

    return normalizeNodeState({
      id: nodeRecord.id as Array<string>,
      selected: nodeRecord.selected as Scenario["nodes"][number]["selected"],
    });
  });
  const normalizedSparqlConfig = normalizeSparqlConfig(
    isRecord(value.sparql) ? value.sparql : undefined,
  );
  const normalizedXmlSource =
    typeof value.xmlSource === "string" ? value.xmlSource : defaultScenario.xmlSource;

  return {
    nodes: normalizedNodes,
    sparql: normalizedSparqlConfig,
    xmlSource: normalizedXmlSource,
  };
}

export function parseNamedScenario(value: unknown): null | NamedScenario {
  const parsedScenario = parseScenario(value);

  if (parsedScenario != null) {
    return { scenario: parsedScenario };
  }

  if (!isRecord(value)) {
    return null;
  }

  const nestedScenario = parseScenario(value.scenario);

  if (nestedScenario == null) {
    return null;
  }

  return {
    name: typeof value.name === "string" ? value.name : undefined,
    scenario: nestedScenario,
  };
}
