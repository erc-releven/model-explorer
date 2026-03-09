import { defaultSparqlConfig, normalizeSparqlConfig, type Scenario } from "../scenario";
import type { Pathbuilder } from "./pathbuilder";
import { serializeScenarioToSparql } from "./sparql";

export const DEFAULT_SPARQL_ENDPOINT =
  "https://releven-graphdb.acdh-dev.oeaw.ac.at/repositories/owl-max";

interface CountQueueEntry<T> {
  priority: number;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
  sequence: number;
  task: () => Promise<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null;
}

function extractCountFromSparqlResult(payload: unknown): number {
  if (!isRecord(payload) || !isRecord(payload.results)) {
    throw new Error("Unexpected SPARQL response format.");
  }

  const { results } = payload;
  const bindings = results.bindings;

  if (!Array.isArray(bindings) || bindings.length === 0) {
    return 0;
  }

  const firstBinding: unknown = bindings[0];

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
const countQueueEntries: Array<CountQueueEntry<unknown>> = [];
let isProcessingCountQueue = false;
let isCountQueueProcessingScheduled = false;
let nextCountQueueSequence = 0;

function createCountCacheKey(endpoint: string, query: string): string {
  return `${endpoint}\n${query}`;
}

function getSelectedNodeDepth(nodePath: Array<string>): number {
  let depth = 0;

  for (const part of nodePath) {
    if (part === ">" || part === "<") {
      depth += 1;
    }
  }

  return depth;
}

function dequeueNextCountRequest(): CountQueueEntry<unknown> | undefined {
  if (countQueueEntries.length === 0) {
    return undefined;
  }

  let nextIndex = 0;

  for (let index = 1; index < countQueueEntries.length; index += 1) {
    const current = countQueueEntries[index]!;
    const next = countQueueEntries[nextIndex]!;

    if (current.priority < next.priority) {
      nextIndex = index;
      continue;
    }

    if (current.priority === next.priority && current.sequence < next.sequence) {
      nextIndex = index;
    }
  }

  return countQueueEntries.splice(nextIndex, 1)[0];
}

async function processCountQueue(): Promise<void> {
  if (isProcessingCountQueue) {
    return;
  }

  isProcessingCountQueue = true;
  isCountQueueProcessingScheduled = false;

  try {
    while (countQueueEntries.length > 0) {
      const entry = dequeueNextCountRequest();

      if (entry == null) {
        break;
      }

      try {
        entry.resolve(await entry.task());
      } catch (error: unknown) {
        entry.reject(error);
      }
    }
  } finally {
    isProcessingCountQueue = false;
  }
}

function enqueueCountRequest<T>(priority: number, task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    countQueueEntries.push({
      priority,
      reject,
      resolve,
      sequence: nextCountQueueSequence,
      task,
    });
    nextCountQueueSequence += 1;

    if (!isCountQueueProcessingScheduled) {
      isCountQueueProcessingScheduled = true;
      queueMicrotask(() => {
        void processCountQueue();
      });
    }
  });
}

function buildTraversalNodesForPath(nodePath: Array<string>): Scenario["nodes"] {
  if (nodePath.length === 0) {
    return [];
  }

  const nodes: Scenario["nodes"] = [];

  for (let length = 1; length < nodePath.length; length += 2) {
    nodes.push({
      id: nodePath.slice(0, length),
      selected: "no",
    });
  }

  nodes.push({
    id: [...nodePath],
    selected: "count",
  });

  return nodes;
}

async function fetchCountForQuery(
  endpoint: string,
  query: string,
  priority: number = Number.MAX_SAFE_INTEGER,
): Promise<number> {
  const cacheKey = createCountCacheKey(endpoint, query);
  const cachedCount = countResultCache.get(cacheKey);

  if (cachedCount != null) {
    return cachedCount;
  }

  const pendingRequest = pendingCountRequestsByKey.get(cacheKey);

  if (pendingRequest != null) {
    return await pendingRequest;
  }

  const requestPromise = enqueueCountRequest(priority, async (): Promise<number> => {
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
      throw new Error(`Count query failed (${String(response.status)}): ${responseText}`);
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
  });

  pendingCountRequestsByKey.set(cacheKey, requestPromise);

  try {
    return await requestPromise;
  } finally {
    pendingCountRequestsByKey.delete(cacheKey);
  }
}

export const __testing__ = {
  fetchCountForQuery,
  getSelectedNodeDepth,
  resetCountQueryState(): void {
    countResultCache.clear();
    pendingCountRequestsByKey.clear();
    countQueueEntries.length = 0;
    isCountQueueProcessingScheduled = false;
    isProcessingCountQueue = false;
    nextCountQueueSequence = 0;
  },
};

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

  const sparqlConfig = normalizeSparqlConfig({
    ...defaultSparqlConfig,
    namedGraph: options?.sparql?.namedGraph ?? defaultSparqlConfig.namedGraph,
  });
  const temporaryScenario: Scenario = {
    nodes: buildTraversalNodesForPath(nodePath),
    sparql: sparqlConfig,
    xmlSource: "",
  };
  const priority = getSelectedNodeDepth(nodePath);
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
  const distinctCount = await fetchCountForQuery(endpoint, distinctQuery, priority);
  const totalCount = await fetchCountForQuery(endpoint, totalQuery, priority);

  return { distinctCount, totalCount };
}
