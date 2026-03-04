import { normalizeSparqlConfig, type Scenario } from "../scenario";
import type { Pathbuilder } from "./pathbuilder";
import { serializeScenarioToSparql } from "./sparql";

export const DEFAULT_SPARQL_ENDPOINT =
  "https://releven-graphdb.acdh-dev.oeaw.ac.at/repositories/owl-max";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null;
}

function extractCountFromSparqlResult(payload: unknown): number {
  if (!isRecord(payload) || !isRecord(payload.results)) {
    throw new Error("Unexpected SPARQL response format.");
  }

  const bindings = payload.results.bindings;

  if (!Array.isArray(bindings) || bindings.length === 0) {
    return 0;
  }

  const firstBinding = bindings[0];

  if (!isRecord(firstBinding)) {
    throw new Error("Unexpected SPARQL bindings format.");
  }

  for (const bindingValue of Object.values(firstBinding)) {
    if (!isRecord(bindingValue) || typeof bindingValue.value !== "string") {
      continue;
    }

    const parsed = Number(bindingValue.value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new Error("Could not extract numeric count from SPARQL response.");
}

const countResultCache = new Map<string, number>();
const pendingCountRequestsByKey = new Map<string, Promise<number>>();

function createCountCacheKey(endpoint: string, query: string): string {
  return `${endpoint}\n${query}`;
}

function buildTraversalNodesForPath(nodePath: Array<string>): Scenario["nodes"] {
  if (nodePath.length === 0) {
    return [];
  }

  const nodes: Scenario["nodes"] = [];

  for (let length = 1; length < nodePath.length; length += 2) {
    nodes.push({
      expanded: "both",
      id: nodePath.slice(0, length),
      selected: "no",
    });
  }

  nodes.push({
    expanded: "none",
    id: [...nodePath],
    selected: "count",
  });

  return nodes;
}

async function fetchCountForQuery(endpoint: string, query: string): Promise<number> {
  const cacheKey = createCountCacheKey(endpoint, query);
  const cachedCount = countResultCache.get(cacheKey);

  if (cachedCount != null) {
    return cachedCount;
  }

  const pendingRequest = pendingCountRequestsByKey.get(cacheKey);

  if (pendingRequest != null) {
    return await pendingRequest;
  }

  const requestPromise = (async (): Promise<number> => {
    const response = await fetch(endpoint, {
      body: new URLSearchParams({ query }).toString(),
      headers: {
        Accept: "application/sparql-results+json, application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      method: "POST",
    });
    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        `Count query failed (${String(response.status)}): ${responseText}`,
      );
    }

    let parsedPayload: unknown;

    try {
      parsedPayload = JSON.parse(responseText) as unknown;
    } catch {
      throw new Error("Count query returned non-JSON response.");
    }

    const count = extractCountFromSparqlResult(parsedPayload);
    countResultCache.set(cacheKey, count);

    return count;
  })();

  pendingCountRequestsByKey.set(cacheKey, requestPromise);

  try {
    return await requestPromise;
  } finally {
    pendingCountRequestsByKey.delete(cacheKey);
  }
}

export async function fetchCountForNodePath(
  pathbuilder: null | Pathbuilder,
  nodePath: Array<string>,
  options?: {
    endpoint?: string;
    sparql?: Partial<Scenario["sparql"]>;
  },
): Promise<{ distinctCount: number; totalCount: number }> {
  const endpoint = (options?.endpoint ?? DEFAULT_SPARQL_ENDPOINT).trim();

  if (endpoint.length === 0) {
    throw new Error("Count query endpoint is empty.");
  }

  const sparqlConfig = normalizeSparqlConfig(options?.sparql);
  const temporaryScenario: Scenario = {
    nodes: buildTraversalNodesForPath(nodePath),
    sparql: sparqlConfig,
    xmlSource: "",
  };
  const totalQuery = serializeScenarioToSparql(
    {
      ...temporaryScenario,
      sparql: { ...sparqlConfig, countDistinct: false },
    },
    pathbuilder,
  );
  const distinctQuery = serializeScenarioToSparql(
    {
      ...temporaryScenario,
      sparql: { ...sparqlConfig, countDistinct: true },
    },
    pathbuilder,
  );
  const [distinctCount, totalCount] = await Promise.all([
    fetchCountForQuery(endpoint, distinctQuery),
    fetchCountForQuery(endpoint, totalQuery),
  ]);

  return { distinctCount, totalCount };
}
