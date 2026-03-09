import { beforeEach, describe, expect, test, vi } from "vitest";

import { __testing__ } from "./sparql-query";

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, reject, resolve };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("fetchCountForNodePath queue", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __testing__.resetCountQueryState();
  });

  test("processes outstanding count queries from shallower selected paths first", async () => {
    const startedQueries: Array<string> = [];
    const firstResponse = createDeferred<Response>();
    const secondResponse = createDeferred<Response>();
    const responses = [firstResponse, secondResponse];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = init?.body;

      if (typeof body !== "string") {
        throw new Error("Unexpected fetch body.");
      }

      const query = new URLSearchParams(body).get("query");

      if (query == null) {
        throw new Error("Missing query payload.");
      }

      startedQueries.push(query);
      const next = responses.shift();

      if (next == null) {
        throw new Error("No queued mock response available.");
      }

      return await next.promise;
    });

    const deeperSelectionRequest = __testing__.fetchCountForQuery(
      "https://example.test/sparql",
      [
        "SELECT ?person ?display_name WHERE {",
        "  ?person a <http://example.test/Person> .",
        "  ?person <http://www.w3.org/2000/01/rdf-schema#label> ?display_name .",
        "}",
      ].join("\n"),
      2,
    );
    const shallowerSelectionRequest = __testing__.fetchCountForQuery(
      "https://example.test/sparql",
      ["SELECT ?person WHERE {", "  ?person a <http://example.test/Person> .", "}"].join("\n"),
      0,
    );

    await flushMicrotasks();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(startedQueries[0]).toContain("SELECT ?person WHERE");

    firstResponse.resolve(
      new Response(
        JSON.stringify({
          results: {
            bindings: [{ person: { type: "literal", value: "1" } }],
          },
        }),
        {
          headers: { "Content-Type": "application/sparql-results+json" },
          status: 200,
        },
      ),
    );

    await expect(shallowerSelectionRequest).resolves.toBe(1);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(startedQueries[1]).toContain("SELECT ?person ?display_name WHERE");

    secondResponse.resolve(
      new Response(
        JSON.stringify({
          results: {
            bindings: [{ display_name: { type: "literal", value: "2" } }],
          },
        }),
        {
          headers: { "Content-Type": "application/sparql-results+json" },
          status: 200,
        },
      ),
    );

    await Promise.all([shallowerSelectionRequest, deeperSelectionRequest]);
  });
});
