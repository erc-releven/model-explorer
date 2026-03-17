export interface SparqlExecutionResult {
  contentType: string;
  durationMs: number;
  payloadBytes: number;
  result: string;
}

export async function executeSparqlQuery(
  endpoint: string,
  query: string,
  signal?: AbortSignal,
): Promise<SparqlExecutionResult> {
  const normalizedEndpoint = endpoint.trim();
  const normalizedQuery = query.trim();

  if (normalizedEndpoint.length === 0) {
    throw new Error("Please provide an endpoint.");
  }

  if (normalizedQuery.length === 0) {
    throw new Error("Please provide a SPARQL query.");
  }

  const startedAt = performance.now();
  const response = await fetch(normalizedEndpoint, {
    body: new URLSearchParams({ query: normalizedQuery }).toString(),
    headers: {
      Accept: "application/sparql-results+json, application/json, text/plain;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    method: "POST",
    signal,
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Query failed (${String(response.status)}): ${responseText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";

  return {
    contentType,
    durationMs: performance.now() - startedAt,
    payloadBytes: new TextEncoder().encode(responseText).length,
    result:
      contentType.includes("json") && responseText.length > 0
        ? JSON.stringify(JSON.parse(responseText), null, 2)
        : responseText,
  };
}
