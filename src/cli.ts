#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  array,
  command,
  flag,
  multioption,
  oneOf,
  option,
  optional,
  run,
  string,
} from "cmd-ts";
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
import {
  executeSparqlQuery,
  type SparqlExecutionResult,
} from "./serializer/sparql-execution";
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

function deriveScenarioName(
  filePath: string,
  parsedScenario: NamedScenario,
): string {
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

function createNodeSelectionPath(
  ancestorIds: Array<string>,
  pathId: string,
): Array<string> {
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

function createRootTypeScenarios(
  pathbuilder: Pathbuilder,
  xmlPath: string,
): Array<LoadedScenario> {
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
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : "scenario";
}

function createScenarioFileNames(
  reports: Array<ScenarioReport>,
): Array<string> {
  const seenCountsBySlug = new Map<string, number>();

  return reports.map((report) => {
    const baseSlug = slugifyScenarioName(report.name);
    const seenCount = seenCountsBySlug.get(baseSlug) ?? 0;

    seenCountsBySlug.set(baseSlug, seenCount + 1);

    return seenCount === 0 ? baseSlug : `${baseSlug}-${String(seenCount + 1)}`;
  });
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

      await writeFile(
        queryPath,
        `${formatTextReport(report, null, false)}\n`,
        "utf8",
      );
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
  },
  async handler(args) {
    if (args.rootTypes && args.scenario.length > 0) {
      throw new Error("Use either --scenario or --root-types, not both.");
    }

    if (!args.rootTypes && args.scenario.length === 0) {
      throw new Error(
        "Provide at least one --scenario file or pass --root-types.",
      );
    }

    if (args.output === "files" && args.outputDir == null) {
      throw new Error("Provide --output-dir when using --output files.");
    }

    const resolvedXmlPath = resolve(args.xml);
    const xmlContent = await readFile(resolvedXmlPath, "utf8");
    const pathbuilder = parsePathbuilderDocument(
      new JSDOM(xmlContent, { contentType: "text/xml" }).window.document,
    );
    const loadedScenarios = args.rootTypes
      ? createRootTypeScenarios(pathbuilder, resolvedXmlPath)
      : await Promise.all(
          args.scenario.map(
            async (scenarioFile) => await loadScenarioFile(scenarioFile),
          ),
        );
    const reports: Array<ScenarioReport> = [];

    for (const loadedScenario of loadedScenarios) {
      const scenario = {
        ...loadedScenario.scenario,
        xmlSource: resolvedXmlPath,
      };
      const pydantic = serializeModelStateToPydantic(scenario, pathbuilder);
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
      process.stdout.write(
        `Wrote ${String(reports.length)} scenario file set(s) to ${resolvedOutputDirectory}\n`,
      );
      return;
    }

    process.stdout.write(
      `${reports
        .map((report) =>
          formatTextReport(
            report,
            args.execute ? args.endpoint : null,
            args.execute,
          ),
        )
        .join("\n\n---\n\n")}\n`,
    );
  },
});

const cliArguments = process.argv.slice(2);

void run(cli, cliArguments[0] === "--" ? cliArguments.slice(1) : cliArguments);
