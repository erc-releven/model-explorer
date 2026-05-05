#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import { array, command, flag, multioption, oneOf, option, optional, run, string } from "cmd-ts";
import { JSDOM } from "jsdom";

import { defaultSparqlConfig, type NodeState } from "./scenario";
import { type NamedScenario, parseNamedScenario } from "./scenario-io";
import {
  parsePathbuilderDocument,
  type Pathbuilder,
  type PathbuilderPath,
} from "./serializer/pathbuilder";
import { serializeModelStateToPydantic } from "./serializer/pydantic";
import { serializeScenarioToSparql } from "./serializer/sparql";
import { executeSparqlQuery, type SparqlExecutionResult } from "./serializer/sparql-execution";
import { DEFAULT_SPARQL_ENDPOINT } from "./serializer/sparql-query";
import { serializeModelStateToSearch } from "./serializer/url";

const deployedUiUrl = "https://erc-releven.github.io/model-explorer/";

interface LoadedScenario {
  displayName: string;
  scenario: NamedScenario["scenario"];
}

interface ScenarioReport {
  name: string;
  pydantic: string;
  queryExecution?: SparqlExecutionResult;
  scenarioUrl?: string;
  sparql: string;
}

function deriveScenarioName(filePath: string, parsedScenario: NamedScenario): string {
  if (parsedScenario.name != null && parsedScenario.name.trim().length > 0) {
    return parsedScenario.name.trim();
  }

  return basename(filePath, ".json");
}

async function loadScenarioFile(filePath: string): Promise<LoadedScenario> {
  const resolvedFilePath = resolve(filePath);
  const rawScenario = await readFile(resolvedFilePath, "utf8");
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(rawScenario) as unknown;
  } catch (error: unknown) {
    throw new Error(
      `Scenario file ${resolvedFilePath} does not contain valid JSON: ${
        error instanceof Error ? error.message : "unknown parse error"
      }`,
    );
  }

  const parsedScenario = parseNamedScenario(parsedJson);

  if (parsedScenario == null) {
    throw new Error(
      `Scenario file ${resolvedFilePath} must contain a Scenario object or an object with { name?, scenario }.`,
    );
  }

  return {
    displayName: deriveScenarioName(resolvedFilePath, parsedScenario),
    scenario: parsedScenario.scenario,
  };
}

function createNodeSelectionPath(ancestorIds: Array<string>, pathId: string): Array<string> {
  if (ancestorIds.length === 0) {
    return [pathId];
  }

  return [...ancestorIds, ">", pathId];
}

function collectRootTypeScenarioNodes(
  path: PathbuilderPath,
  ancestorIds: Array<string> = [],
): Array<NodeState> {
  const currentNodePath = createNodeSelectionPath(ancestorIds, path.id);
  const nodes: Array<NodeState> = [{ id: currentNodePath, selected: "value" }];

  if (path.entity_reference != null) {
    return nodes;
  }

  for (const childPath of Object.values(path.children)) {
    nodes.push(...collectRootTypeScenarioNodes(childPath, currentNodePath));
  }

  return nodes;
}

function createRootTypeScenarios(pathbuilder: Pathbuilder, xmlPath: string): Array<LoadedScenario> {
  return pathbuilder
    .values()
    .filter((path) => path.path_array.length === 1)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((rootPath) => {
      return {
        displayName: rootPath.name || rootPath.id,
        scenario: {
          nodes: collectRootTypeScenarioNodes(rootPath),
          sparql: defaultSparqlConfig,
          xmlSource: xmlPath,
        },
      };
    });
}

function toPublicRelativeXmlSource(xmlPath: string): string | undefined {
  const publicDirectoryPath = resolve(process.cwd(), "public");
  const relativePath = relative(publicDirectoryPath, xmlPath);

  if (relativePath.length === 0) {
    return undefined;
  }

  if (isAbsolute(relativePath) || relativePath.startsWith("..")) {
    return undefined;
  }

  return relativePath.split(sep).join("/");
}

function createScenarioUrl(
  scenario: NamedScenario["scenario"],
  xmlPath: string,
): string | undefined {
  const publicRelativeXmlSource = toPublicRelativeXmlSource(xmlPath);

  if (publicRelativeXmlSource == null) {
    return undefined;
  }

  const scenarioWithRelativeXmlSource = {
    ...scenario,
    xmlSource: publicRelativeXmlSource,
  };

  return `${deployedUiUrl}${serializeModelStateToSearch(scenarioWithRelativeXmlSource)}`;
}

function formatTextReport(
  report: ScenarioReport,
  endpoint: null | string,
  includeExecution: boolean,
): string {
  const lines = [`# Scenario: ${report.name}`];

  if (report.scenarioUrl != null) {
    lines.push(`# Explore this scenario interactively: ${report.scenarioUrl}`);
  }

  lines.push(report.sparql);

  if (includeExecution && report.queryExecution != null) {
    lines.push(
      "",
      `# Query execution (${endpoint ?? DEFAULT_SPARQL_ENDPOINT}):`,
      `# Duration: ${report.queryExecution.durationMs.toFixed(2)} ms`,
      `# Payload bytes: ${String(report.queryExecution.payloadBytes)}`,
      `# Content-Type: ${report.queryExecution.contentType || "(unknown)"}`,
      "",
      "# Result:",
      report.queryExecution.result,
    );
  }

  return lines.join("\n");
}

function slugifyScenarioName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "_$1");

  return slug.length > 0 ? slug : "scenario";
}

function slugToClassName(slug: string): string {
  const pascalCase = slug
    .split("_")
    .map((part) => (part.length > 0 ? part.charAt(0).toUpperCase() + part.slice(1) : ""))
    .join("");

  return `${pascalCase}Model`;
}

function createScenarioFileNames(names: Array<{ name: string }>): Array<string> {
  const seenCountsBySlug = new Map<string, number>();

  return names.map(({ name }) => {
    const baseSlug = slugifyScenarioName(name);
    const seenCount = seenCountsBySlug.get(baseSlug) ?? 0;

    seenCountsBySlug.set(baseSlug, seenCount + 1);

    return seenCount === 0 ? baseSlug : `${baseSlug}_${String(seenCount + 1)}`;
  });
}

interface EntrypointEndpoint {
  className: string;
  filename: string;
  filterableFields?: Array<string>;
  itemKey?: string;
  url: string;
}

interface EntrypointConfig {
  backendAddress: string;
  cache?: number;
  cors?: { headers?: Array<string>; methods?: Array<string>; origins?: Array<string> };
  countsEndpoint: boolean;
  endpoints: Array<EntrypointEndpoint>;
  gitEndpoint: boolean;
  httpxArgs?: string;
  httpxTransportArgs?: string;
  logging?: string;
  modulePrefix: string;
  namedGraphs: boolean;
  queryDirectory: string;
  pageSize: number;
}

function generateEntrypoint(config: EntrypointConfig): string {
  const {
    backendAddress,
    cache,
    cors,
    countsEndpoint,
    endpoints,
    gitEndpoint,
    httpxArgs,
    httpxTransportArgs,
    logging,
    modulePrefix,
    namedGraphs,
    pageSize,
    queryDirectory,
  } = config;

  const sortedByFilename = [...endpoints].sort((a, b) => a.filename.localeCompare(b.filename));
  const sortedByUrl = [...endpoints].sort((a, b) => a.url.localeCompare(b.url));
  const listingEndpoints = sortedByUrl.filter((e) => e.itemKey == null);
  const hasHttpx = httpxArgs != null || httpxTransportArgs != null;

  // Include content only when condition is truthy.
  function when(condition: unknown, content: string): string {
    return condition ? content : "";
  }

  function renderEndpoint(endpoint: EntrypointEndpoint): string {
    const hasFilter = (endpoint.filterableFields?.length ?? 0) > 0;
    const paramType = hasFilter ? "Filterable" : "Default";
    const decorator =
      cache != null
        ? `@app.get("${endpoint.url}", dependencies=[cache(max_age=${String(cache)}, public=True)])`
        : `@app.get("${endpoint.url}")`;
    const signature =
      endpoint.itemKey != null
        ? `def ${endpoint.filename}(id: str) -> ${endpoint.className}:`
        : `def ${endpoint.filename}(params: Annotated[${paramType}QueryParameters[${endpoint.className}], Query()]) -> Page[${endpoint.className}]:`;
    const returnStatement =
      endpoint.itemKey != null
        ? `    return adapter.get_item(**{"${endpoint.itemKey}": id})`
        : "    return adapter.get_page(params)";

    return `
${decorator}
${signature}
    query = load_query("${endpoint.filename}")
${when(
  hasFilter,
  `    if params.query:
        bindings = ModelSPARQLMap(${endpoint.className}, True)
        fields = [bindings[f] for f in ${JSON.stringify(endpoint.filterableFields)}]
        query = query[:-2] + " FILTER ( " + " || ".join(f'CONTAINS(?{"{f}"}, "{"{q}"}")' for f in fields for q in params.query.split(' ')) + ") }"
`,
)}${when(
      namedGraphs && endpoint.itemKey == null,
      `    if params.named_graph:
        query = query.split("\\n\\nWHERE {", 1)
        query = f"{query[0]} WHERE {{ GRAPH <{params.named_graph}> {{ {query[1]} }}"
`,
    )}    adapter = SPARQLModelAdapter(
        target="${backendAddress}",
        query=query,
        model=${endpoint.className},${when(hasHttpx, "\n        aclient_config=aclient_config")}
    )

${when(logging != null, `    logger.info("querying ${endpoint.url}")\n`)}${returnStatement}`;
  }

  // Post-process: collapse 3+ consecutive newlines to 2, trim, add trailing newline.
  const raw = `\
${when(gitEndpoint, "import importlib\n")}${when(logging != null, "import logging\n")}${when(gitEndpoint, "import sys\n")}from os import path
from typing import Annotated${when(countsEndpoint, ", TypedDict")}
${when(hasHttpx, "\nimport httpx\n")}from fastapi import FastAPI, Query, Request
${when(cors != null, "from fastapi.middleware.cors import CORSMiddleware\n")}from fastapi.responses import PlainTextResponse
${when(gitEndpoint, "from git import Repo\n")}${when(
    cache != null,
    `from hishel import AsyncSqliteStorage
from hishel.asgi import ASGICacheMiddleware
from hishel.fastapi import cache\n`,
  )}from pydantic import Field
from rdfproxy import Page, QueryParameters, SPARQLModelAdapter
from rdfproxy.utils.exceptions import NoResultsFound
from rdfproxy.utils.utils import ModelSPARQLMap

${sortedByFilename.map((e) => `from ${modulePrefix}.${e.filename} import ${e.className}`).join("\n")}

${when(
  logging != null,
  `logger = logging.getLogger(__name__)

logging.basicConfig(level=${logging})

`,
)}# show informative errors/stack traces to consumers
app = FastAPI(debug=True)

${when(
  cors != null,
  `app.add_middleware(
    CORSMiddleware,
    allow_origins=${JSON.stringify(cors?.origins ?? ["*"])},
    allow_credentials=True,
    allow_methods=${JSON.stringify(cors?.methods ?? ["*"])},
    allow_headers=${JSON.stringify(cors?.headers ?? ["*"])},
)

`,
)}${when(
    httpxTransportArgs != null,
    `aclient_config = ${httpxArgs ?? "{}"} | {"transport": httpx.AsyncHTTPTransport(**${httpxTransportArgs})}

`,
  )}${when(
    httpxArgs != null && httpxTransportArgs == null,
    `aclient_config = ${httpxArgs}

`,
  )}${when(
    gitEndpoint,
    `# The automatic health check endpoint is /. The return code has to be 200 or 30x.
@app.get("/", include_in_schema=False)
def version():
    repo = Repo(search_parent_directories=True)

    def get_version(module_name):
        try:
            return importlib.metadata.version(module_name)
        except importlib.metadata.PackageNotFoundError:
            return None

    return {
        "version": repo.git.describe(tags=True, dirty=True, always=True),
        "python": sys.version,
        "modules": {
            module: get_version(module)
            for module in sys.modules.keys()
            if get_version(module)
        },
    }

`,
  )}def load_query(name):
    with open(f"{path.dirname(path.realpath(__file__))}/${queryDirectory}/{name}.rq") as query:
        return query.read().replace("\\n ", " ")


@app.exception_handler(NoResultsFound)
def noresultsfound_exception_handler(_: Request, exc: NoResultsFound):
    return PlainTextResponse(status_code=404, content=str(exc))
    # content="\\n".join(traceback.format_exception(exc))


class DefaultQueryParameters(QueryParameters):
    size: int = Field(default=${String(pageSize)}, ge=1)
${when(namedGraphs, "    named_graph: str | None = None\n")}
class FilterableQueryParameters(DefaultQueryParameters):
    query: str | None = None
${sortedByUrl.map(renderEndpoint).join("\n")}

${when(
  countsEndpoint,
  `Counts = TypedDict('Counts', {
${listingEndpoints.map((e) => `    "${e.url}": int,`).join("\n")}
})

@app.get("/counts")
def counts(${when(namedGraphs, "named_graph: str | None = None")}) -> Counts:
    """Return item counts for all listing endpoints"""
    return {
${listingEndpoints.map((e) => `        "${e.url}": ${e.filename}(params=FilterableQueryParameters(size=1${when(namedGraphs, ", named_graph=named_graph")})).total,`).join("\n")}
    }

`,
)}${when(
    cache != null,
    `# needs to be invoked using \`uvicorn modulename:app\`, *not* fastapi!
app = ASGICacheMiddleware(app, storage=AsyncSqliteStorage())
`,
  )}`;

  return raw.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

async function writeScenarioFiles(
  reports: Array<ScenarioReport>,
  outputDirectory: string,
): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });

  const scenarioFileNames = createScenarioFileNames(reports);

  await Promise.all(
    reports.map(async (report, index) => {
      const fileName = scenarioFileNames[index]!;
      const queryPath = join(outputDirectory, `${fileName}.rq`);
      const modelPath = join(outputDirectory, `${fileName}.py`);

      await writeFile(queryPath, `${formatTextReport(report, null, false)}\n`, "utf8");
      await writeFile(modelPath, `${report.pydantic}\n`, "utf8");
    }),
  );
}

const cli = command({
  name: "releven-cli",
  description:
    "Generate SPARQL and Pydantic output from one or more Scenario JSON files and optionally execute the SPARQL query.",
  args: {
    endpoint: option({
      long: "endpoint",
      defaultValue: () => DEFAULT_SPARQL_ENDPOINT,
      description: "SPARQL endpoint used when --execute is passed.",
      type: string,
    }),
    execute: flag({
      long: "execute",
      description: "Execute the generated SPARQL query for each scenario.",
    }),
    output: option({
      long: "output",
      defaultValue: () => "stdout" as const,
      description: "Write output to stdout or to separate query/model files.",
      type: oneOf(["files", "stdout"] as const),
    }),
    outputDir: option({
      long: "output-dir",
      description: "Directory used when --output files is selected.",
      type: optional(string),
    }),
    scenario: multioption({
      long: "scenario",
      description:
        "Path to a scenario JSON file. Repeat this option to process multiple scenarios in one run.",
      defaultValue: () => [],
      type: array(string),
    }),
    rootTypes: flag({
      long: "root-types",
      description:
        "Generate one scenario per root type from the XML, selecting the root and all descendant child nodes until entity references.",
    }),
    xml: option({
      long: "xml",
      description:
        "Path to the pathbuilder XML file that forms the basis of query and model serialization.",
      type: string,
    }),
    entrypoint: flag({
      long: "entrypoint",
      description:
        "Generate an entrypoint.py FastAPI application in the --output-dir alongside the scenario files. Requires --output files.",
    }),
    cache: option({
      long: "cache",
      description: "Enable hishel response caching with the given max-age in seconds.",
      type: optional(string),
    }),
    cors: flag({
      long: "cors",
      description: "Enable CORS middleware with wildcard allow-all defaults.",
    }),
    corsHeaders: multioption({
      long: "cors-headers",
      description: 'Allowed CORS headers. Defaults to ["*"] when --cors is set.',
      defaultValue: () => [] as Array<string>,
      type: array(string),
    }),
    corsMethods: multioption({
      long: "cors-methods",
      description: 'Allowed CORS methods. Defaults to ["*"] when --cors is set.',
      defaultValue: () => [] as Array<string>,
      type: array(string),
    }),
    corsOrigins: multioption({
      long: "cors-origins",
      description: 'Allowed CORS origins. Defaults to ["*"] when --cors is set.',
      defaultValue: () => [] as Array<string>,
      type: array(string),
    }),
    countsEndpoint: flag({
      long: "counts",
      description: "Include a /counts endpoint that returns total counts for all listing routes.",
    }),
    gitEndpoint: flag({
      long: "git",
      description: "Include a / health-check endpoint that returns git version metadata.",
    }),
    httpxArgs: option({
      long: "httpx-args",
      description: "Python dict literal passed as aclient_config to SPARQLModelAdapter.",
      type: optional(string),
    }),
    httpxTransportArgs: option({
      long: "httpx-transport-args",
      description: "Python dict literal passed to httpx.AsyncHTTPTransport within aclient_config.",
      type: optional(string),
    }),
    logging: option({
      long: "logging",
      description: "Python logging level expression, e.g. logging.DEBUG.",
      type: optional(string),
    }),
    namedGraphs: flag({
      long: "named-graphs",
      description: "Add an optional named_graph query parameter to all listing and counts routes.",
    }),
    pageSize: option({
      long: "page-size",
      defaultValue: () => "100",
      description: "Default page size for paginated endpoints.",
      type: string,
    }),
  },
  async handler(args) {
    if (args.rootTypes && args.scenario.length > 0) {
      throw new Error("Use either --scenario or --root-types, not both.");
    }

    if (!args.rootTypes && args.scenario.length === 0) {
      throw new Error("Provide at least one --scenario file or pass --root-types.");
    }

    if (args.output === "files" && args.outputDir == null) {
      throw new Error("Provide --output-dir when using --output files.");
    }

    if (args.entrypoint && args.output !== "files") {
      throw new Error("--entrypoint requires --output files.");
    }

    const resolvedXmlPath = resolve(args.xml);
    const xmlContent = await readFile(resolvedXmlPath, "utf8");
    const pathbuilder = parsePathbuilderDocument(
      new JSDOM(xmlContent, { contentType: "text/xml" }).window.document,
    );
    const loadedScenarios = args.rootTypes
      ? createRootTypeScenarios(pathbuilder, resolvedXmlPath)
      : await Promise.all(
          args.scenario.map(async (scenarioFile) => await loadScenarioFile(scenarioFile)),
        );

    // Compute deduplicated file names upfront so pydantic models get unique class names.
    const fileNames = createScenarioFileNames(
      loadedScenarios.map((s) => ({ name: s.displayName })),
    );

    const reports: Array<ScenarioReport> = [];

    for (const [index, loadedScenario] of loadedScenarios.entries()) {
      const fileName = fileNames[index]!;
      const scenario = {
        ...loadedScenario.scenario,
        xmlSource: resolvedXmlPath,
      };
      const pydantic = serializeModelStateToPydantic(scenario, pathbuilder, {
        rootModelName: slugToClassName(fileName),
      });
      const sparql = serializeScenarioToSparql(scenario, pathbuilder);
      const queryExecution = args.execute
        ? await executeSparqlQuery(args.endpoint, sparql)
        : undefined;

      reports.push({
        name: loadedScenario.displayName,
        pydantic,
        queryExecution,
        scenarioUrl: createScenarioUrl(scenario, resolvedXmlPath),
        sparql,
      });
    }

    if (args.output === "files") {
      const resolvedOutputDirectory = resolve(args.outputDir!);

      await writeScenarioFiles(reports, resolvedOutputDirectory);

      if (args.entrypoint) {
        const hasCors =
          args.cors ||
          args.corsOrigins.length > 0 ||
          args.corsMethods.length > 0 ||
          args.corsHeaders.length > 0;
        const parsedCache = args.cache != null ? Number.parseInt(args.cache, 10) : undefined;

        const relativeOutputDir = relative(process.cwd(), resolvedOutputDirectory);
        const modulePrefix = relativeOutputDir.split(sep).join(".");
        const queryDirectory = relativeOutputDir.split(sep).join("/");

        const entrypointContent = generateEntrypoint({
          backendAddress: args.endpoint,
          cache: parsedCache != null && Number.isFinite(parsedCache) ? parsedCache : undefined,
          cors: hasCors
            ? {
                headers: args.corsHeaders.length > 0 ? args.corsHeaders : undefined,
                methods: args.corsMethods.length > 0 ? args.corsMethods : undefined,
                origins: args.corsOrigins.length > 0 ? args.corsOrigins : undefined,
              }
            : undefined,
          countsEndpoint: args.countsEndpoint,
          endpoints: fileNames.map((fileName) => ({
            className: slugToClassName(fileName),
            filename: fileName,
            url: `/${fileName}`,
          })),
          gitEndpoint: args.gitEndpoint,
          httpxArgs: args.httpxArgs ?? undefined,
          httpxTransportArgs: args.httpxTransportArgs ?? undefined,
          logging: args.logging ?? undefined,
          modulePrefix,
          namedGraphs: args.namedGraphs,
          pageSize: Number.parseInt(args.pageSize, 10),
          queryDirectory,
        });

        await writeFile(join(process.cwd(), "entrypoint.py"), entrypointContent, "utf8");
      }

      process.stdout.write(
        `Wrote ${String(reports.length)} scenario file set(s) to ${resolvedOutputDirectory}\n`,
      );
      return;
    }

    process.stdout.write(
      `${reports
        .map((report) =>
          formatTextReport(report, args.execute ? args.endpoint : null, args.execute),
        )
        .join("\n\n---\n\n")}\n`,
    );
  },
});

const cliArguments = process.argv.slice(2);

void run(cli, cliArguments[0] === "--" ? cliArguments.slice(1) : cliArguments);
