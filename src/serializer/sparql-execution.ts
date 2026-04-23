export interface SparqlExecutionResult {
  contentType: string;
  durationMs: number;
  payloadBytes: number;
  result: string;
  truncatedLineCount: number;
  truncated: boolean;
}

const maxStoredPayloadBytes = 50_000_000;

async function readResponseTextSafely(response: Response): Promise<{
  payloadBytes: number;
  text: string;
  truncatedLineCount: number;
  truncated: boolean;
}> {
  if (response.body == null) {
    const text = await response.text();

    return {
      payloadBytes: new TextEncoder().encode(text).length,
      text,
      truncatedLineCount: 0,
      truncated: false,
    };
  }

  const reader = response.body.getReader();
  const lineCountDecoder = new TextDecoder();
  const previewDecoder = new TextDecoder();
  const chunks: Array<string> = [];
  let payloadBytes = 0;
  let storedBytes = 0;
  let newlineCount = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    payloadBytes += value.byteLength;
    newlineCount += lineCountDecoder.decode(value, { stream: true }).split("\n").length - 1;

    if (storedBytes < maxStoredPayloadBytes) {
      const remainingBytes = maxStoredPayloadBytes - storedBytes;
      const chunkToStore =
        value.byteLength <= remainingBytes ? value : value.subarray(0, remainingBytes);

      chunks.push(previewDecoder.decode(chunkToStore, { stream: true }));
      storedBytes += chunkToStore.byteLength;
    }

    if (storedBytes >= maxStoredPayloadBytes) {
      truncated = true;
    }
  }

  chunks.push(previewDecoder.decode());
  const text = chunks.join("");
  const previewLineCount = text.length === 0 ? 0 : text.split("\n").length;
  const totalLineCount = payloadBytes === 0 ? 0 : newlineCount + 1;

  return {
    payloadBytes,
    text,
    truncatedLineCount: truncated ? Math.max(0, totalLineCount - previewLineCount) : 0,
    truncated,
  };
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
  const { payloadBytes, text, truncated, truncatedLineCount } =
    await readResponseTextSafely(response);

  if (!response.ok) {
    throw new Error(`Query failed (${String(response.status)}): ${text}`);
  }

  const contentType = response.headers.get("content-type") ?? "";

  return {
    contentType,
    durationMs: performance.now() - startedAt,
    payloadBytes,
    result: text,
    truncatedLineCount,
    truncated,
  };
}
