import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, test, vi } from "vitest";

import { parsePathbuilderXml } from "./pathbuilder";
import { __testing__, fetchCountForNodePath } from "./sparql-query";

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

  test("keeps scheduling later requests after entries were added during active processing", async () => {
    const startedQueries: Array<string> = [];
    const firstResponse = createDeferred<Response>();
    const secondResponse = createDeferred<Response>();
    const thirdResponse = createDeferred<Response>();
    const responses = [firstResponse, secondResponse, thirdResponse];
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

    const firstRequest = __testing__.fetchCountForQuery(
      "https://example.test/sparql",
      "SELECT ?root WHERE { ?root a <http://example.test/Root> . }",
      0,
    );

    await flushMicrotasks();

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const secondRequest = __testing__.fetchCountForQuery(
      "https://example.test/sparql",
      "SELECT ?child WHERE { ?child a <http://example.test/Child> . }",
      1,
    );

    firstResponse.resolve(
      new Response(
        JSON.stringify({
          results: {
            bindings: [{ root: { type: "literal", value: "1" } }],
          },
        }),
        {
          headers: { "Content-Type": "application/sparql-results+json" },
          status: 200,
        },
      ),
    );

    await expect(firstRequest).resolves.toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    secondResponse.resolve(
      new Response(
        JSON.stringify({
          results: {
            bindings: [{ child: { type: "literal", value: "2" } }],
          },
        }),
        {
          headers: { "Content-Type": "application/sparql-results+json" },
          status: 200,
        },
      ),
    );

    await expect(secondRequest).resolves.toBe(2);

    const thirdRequest = __testing__.fetchCountForQuery(
      "https://example.test/sparql",
      "SELECT ?grandchild WHERE { ?grandchild a <http://example.test/Grandchild> . }",
      2,
    );

    await flushMicrotasks();

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(startedQueries[2]).toContain("SELECT ?grandchild WHERE");

    thirdResponse.resolve(
      new Response(
        JSON.stringify({
          results: {
            bindings: [{ grandchild: { type: "literal", value: "3" } }],
          },
        }),
        {
          headers: { "Content-Type": "application/sparql-results+json" },
          status: 200,
        },
      ),
    );

    await expect(thirdRequest).resolves.toBe(3);
  });

  test("builds and issues count requests for expanded child nodes", async () => {
    const xmlSource = __DEFAULT_XML__.trim();

    if (xmlSource.length === 0) {
      throw new Error("DEFAULT_XML is not configured for tests.");
    }

    const xmlContent = readFileSync(resolve(process.cwd(), "public", xmlSource), "utf8");
    const pathbuilder = parsePathbuilderXml(xmlContent);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            results: {
              bindings: [{ count: { type: "literal", value: "1" } }],
            },
          }),
          {
            headers: { "Content-Type": "application/sparql-results+json" },
            status: 200,
          },
        ),
      );
    });

    await expect(fetchCountForNodePath(pathbuilder, ["g_person"])).resolves.toEqual({
      distinctCount: 1,
      totalCount: 1,
    });
    await expect(
      fetchCountForNodePath(pathbuilder, ["g_person", ">", "p_person_display_name"]),
    ).resolves.toEqual({
      distinctCount: 1,
      totalCount: 1,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });
});
