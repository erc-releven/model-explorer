import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Parser as SparqlParser } from "sparqljs";
import { describe, expect, test } from "vitest";

import {
  createDefaultNodeState,
  defaultSparqlConfig,
  type NodeState,
  type Scenario,
} from "../scenario";
import { parsePathbuilderXml, type Pathbuilder } from "./pathbuilder";
import { serializeScenarioToSparql } from "./sparql";

type SelectionDirection = "<" | ">";
type ParsedSelection = Array<string>;
type ScenarioSelection = string | { selected: NodeState["selected"]; selection: string };

interface StatementGraph {
  statementVariableSets: Array<Set<string>>;
  variables: Set<string>;
}

type UnknownRecord = Record<string, unknown>;

function loadDefaultPathbuilder(): Pathbuilder {
  const xmlSource = __DEFAULT_XML__.trim();

  if (xmlSource.length === 0) {
    throw new Error("DEFAULT_XML is not configured for tests.");
  }

  const xmlContent = readFileSync(resolve(process.cwd(), "public", xmlSource), "utf8");

  return parsePathbuilderXml(xmlContent);
}

function parseSelection(selection: string): ParsedSelection {
  const parts = selection
    .trim()
    .split(/\s*([<>])\s*/)
    .filter(Boolean);

  if (parts.length === 0) {
    throw new Error("Selection must not be empty.");
  }

  return parts;
}

function splitIdParts(id: string): { prefix: string; tokens: Array<string> } {
  const [prefix, ...tokens] = id.split("_");

  return {
    prefix: prefix ?? "",
    tokens,
  };
}

function createCandidateAliases(candidateId: string, parentId?: string): Set<string> {
  const aliases = new Set([candidateId]);

  if (parentId == null) {
    return aliases;
  }

  const candidate = splitIdParts(candidateId);
  const parent = splitIdParts(parentId);

  if (candidate.prefix !== parent.prefix && candidate.prefix !== "p") {
    return aliases;
  }

  let commonLength = 0;
  while (
    commonLength < candidate.tokens.length &&
    commonLength < parent.tokens.length &&
    candidate.tokens[commonLength] === parent.tokens[commonLength]
  ) {
    commonLength += 1;
  }

  if (commonLength > 0 && commonLength < candidate.tokens.length) {
    aliases.add(`${candidate.prefix}_${candidate.tokens.slice(commonLength).join("_")}`);
  }

  return aliases;
}

function resolveSelectionSegment(
  pathbuilder: Pathbuilder,
  parentId: string,
  direction: SelectionDirection,
  segment: string,
): string {
  if (direction !== ">") {
    throw new Error(`Unsupported selection direction: ${direction}`);
  }

  const parentPath = pathbuilder.getPathById(parentId);

  if (parentPath == null) {
    throw new Error(`Unknown parent path: ${parentId}`);
  }

  if (parentPath.children[segment] != null) {
    return segment;
  }

  const candidates = Object.values(parentPath.children).filter((candidate) =>
    createCandidateAliases(candidate.id, parentId).has(segment),
  );

  if (candidates.length === 1) {
    return candidates[0]!.id;
  }

  if (candidates.length > 1) {
    throw new Error(`Ambiguous selection segment "${segment}" below "${parentId}".`);
  }

  throw new Error(`Could not resolve selection segment "${segment}" below "${parentId}".`);
}

function resolveSelectionPath(pathbuilder: Pathbuilder, selection: string): Array<string> {
  const parts = parseSelection(selection);
  const rootId = parts[0];

  if (rootId == null || pathbuilder.getPathById(rootId) == null) {
    throw new Error(`Unknown root path in selection "${selection}".`);
  }

  const resolvedPath = [rootId];
  let currentId = rootId;

  for (let index = 1; index < parts.length; index += 2) {
    const direction = parts[index] as SelectionDirection | undefined;
    const segment = parts[index + 1];

    if (direction == null || segment == null) {
      throw new Error(`Invalid selection syntax: "${selection}".`);
    }

    const resolvedSegment = resolveSelectionSegment(pathbuilder, currentId, direction, segment);

    resolvedPath.push(direction, resolvedSegment);
    currentId = resolvedSegment;
  }

  return resolvedPath;
}

function stringifyPath(path: Array<string>): string {
  return path.join("");
}

function upsertNodeState(
  statesById: Map<string, NodeState>,
  id: Array<string>,
  updater: (state: NodeState) => NodeState,
): void {
  const key = stringifyPath(id);
  const current = statesById.get(key) ?? createDefaultNodeState(id);

  statesById.set(key, updater(current));
}

function createScenarioFromSelections(
  pathbuilder: Pathbuilder,
  selections: Array<ScenarioSelection>,
): Scenario {
  const statesById = new Map<string, NodeState>();

  for (const entry of selections) {
    const selection = typeof entry === "string" ? entry : entry.selection;
    const selectedState = typeof entry === "string" ? "value" : entry.selected;
    const resolvedPath = resolveSelectionPath(pathbuilder, selection);

    for (let index = 0; index < resolvedPath.length - 1; index += 2) {
      const nodeId = resolvedPath.slice(0, index + 1);

      upsertNodeState(statesById, nodeId, (state) => {
        return state;
      });
    }

    upsertNodeState(statesById, resolvedPath, (state) => {
      return {
        ...state,
        selected: selectedState,
      };
    });
  }

  const nodes = Array.from(statesById.values()).sort((left, right) => {
    return left.id.length - right.id.length;
  });

  return {
    nodes,
    sparql: defaultSparqlConfig,
    xmlSource: __DEFAULT_XML__,
  };
}

function isVariableTerm(value: unknown): value is { termType: "Variable"; value: string } {
  return (
    typeof value === "object" &&
    value != null &&
    "termType" in value &&
    "value" in value &&
    value.termType === "Variable" &&
    typeof value.value === "string"
  );
}

function collectVariablesFromValue(value: unknown): Set<string> {
  const variables = new Set<string>();

  function visit(current: unknown): void {
    if (isVariableTerm(current)) {
      variables.add(`?${current.value}`);
      return;
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        visit(item);
      }
      return;
    }

    if (typeof current !== "object" || current == null) {
      return;
    }

    for (const nestedValue of Object.values(current)) {
      visit(nestedValue);
    }
  }

  visit(value);
  return variables;
}

function asRecord(value: unknown): null | UnknownRecord {
  return typeof value === "object" && value != null ? (value as UnknownRecord) : null;
}

function mergeStatementGraph(target: StatementGraph, source: StatementGraph): void {
  for (const variable of source.variables) {
    target.variables.add(variable);
  }

  target.statementVariableSets.push(...source.statementVariableSets);
}

function collectStatementGraph(patterns: Array<unknown>): StatementGraph {
  const graph: StatementGraph = {
    statementVariableSets: [],
    variables: new Set<string>(),
  };

  for (const pattern of patterns) {
    if (typeof pattern !== "object" || pattern == null || !("type" in pattern)) {
      continue;
    }

    switch (pattern.type) {
      case "bgp": {
        if (!("triples" in pattern) || !Array.isArray(pattern.triples)) {
          break;
        }

        for (const triple of pattern.triples) {
          const variables = new Set<string>();
          const tripleRecord = asRecord(triple);

          if (tripleRecord == null) {
            continue;
          }

          for (const key of ["subject", "predicate", "object"] as const) {
            const term = tripleRecord[key];

            if (isVariableTerm(term)) {
              variables.add(`?${term.value}`);
            }
          }

          for (const variable of variables) {
            graph.variables.add(variable);
          }

          if (variables.size > 0) {
            graph.statementVariableSets.push(variables);
          }
        }
        break;
      }

      case "bind": {
        const variables = collectVariablesFromValue(pattern);

        for (const variable of variables) {
          graph.variables.add(variable);
        }

        if (variables.size > 0) {
          graph.statementVariableSets.push(variables);
        }
        break;
      }

      case "group":
      case "graph":
      case "minus":
      case "optional":
      case "service": {
        if ("patterns" in pattern && Array.isArray(pattern.patterns)) {
          mergeStatementGraph(graph, collectStatementGraph(pattern.patterns));
        }
        break;
      }

      case "union": {
        if ("patterns" in pattern && Array.isArray(pattern.patterns)) {
          for (const unionBranch of pattern.patterns) {
            if (Array.isArray(unionBranch)) {
              mergeStatementGraph(graph, collectStatementGraph(unionBranch));
            }
          }
        }
        break;
      }

      case "query": {
        if ("where" in pattern && Array.isArray(pattern.where)) {
          mergeStatementGraph(graph, collectStatementGraph(pattern.where));
        }
        break;
      }
    }
  }

  return graph;
}

function getProjectedVariables(parsedQuery: { variables?: Array<unknown> }): Set<string> {
  const variables = new Set<string>();

  for (const variable of parsedQuery.variables ?? []) {
    if (isVariableTerm(variable)) {
      variables.add(`?${variable.value}`);
      continue;
    }

    const record = asRecord(variable);
    const projectedVariable = record == null ? undefined : record.variable;

    if (isVariableTerm(projectedVariable)) {
      variables.add(`?${projectedVariable.value}`);
    }
  }

  return variables;
}

function collectNestedQueryProjectedVariables(patterns: Array<unknown>): Set<string> {
  const variables = new Set<string>();

  for (const pattern of patterns) {
    const record = asRecord(pattern);

    if (record == null || typeof record.type !== "string") {
      continue;
    }

    switch (record.type) {
      case "group":
      case "graph":
      case "minus":
      case "optional":
      case "service": {
        if (Array.isArray(record.patterns)) {
          for (const variable of collectNestedQueryProjectedVariables(record.patterns)) {
            variables.add(variable);
          }
        }
        break;
      }

      case "union": {
        if (Array.isArray(record.patterns)) {
          for (const branch of record.patterns) {
            if (!Array.isArray(branch)) {
              continue;
            }

            for (const variable of collectNestedQueryProjectedVariables(branch)) {
              variables.add(variable);
            }
          }
        }
        break;
      }

      case "query": {
        for (const variable of getProjectedVariables(record)) {
          variables.add(variable);
        }

        if (Array.isArray(record.where)) {
          for (const variable of collectNestedQueryProjectedVariables(record.where)) {
            variables.add(variable);
          }
        }
        break;
      }
    }
  }

  return variables;
}

function omitTopLevelVariables(parsedQuery: {
  variables?: Array<unknown>;
  where?: Array<unknown>;
}): Record<string, unknown> {
  const record = asRecord(parsedQuery);

  if (record == null) {
    return {};
  }

  const { variables: _variables, ...rest } = record;
  return rest;
}

function expectContiguousVariableGraph(graph: StatementGraph): void {
  const variables = Array.from(graph.variables);

  if (variables.length <= 1) {
    return;
  }

  const adjacency = new Map<string, Set<string>>();

  for (const variable of variables) {
    adjacency.set(variable, new Set<string>());
  }

  for (const statementVariables of graph.statementVariableSets) {
    const statementVariableList = Array.from(statementVariables);

    for (const variable of statementVariableList) {
      const neighbors = adjacency.get(variable);

      if (neighbors == null) {
        continue;
      }

      for (const otherVariable of statementVariableList) {
        if (otherVariable !== variable) {
          neighbors.add(otherVariable);
        }
      }
    }
  }

  const visited = new Set<string>();
  const queue = [variables[0]!];

  while (queue.length > 0) {
    const variable = queue.shift()!;

    if (visited.has(variable)) {
      continue;
    }

    visited.add(variable);

    for (const neighbor of adjacency.get(variable) ?? []) {
      if (!visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  expect(visited).toEqual(new Set(variables));
}

const mixedCountSelectionsWithoutRoot = [
  {
    selected: "value" as const,
    selection: "g_social_relationship > p_social_relationship_display_name",
  },
  {
    selected: "count" as const,
    selection: "g_social_relationship > g_social_relationship_categorisation_assertion",
  },
] as const satisfies Array<ScenarioSelection>;

const mixedCountSelectionsWithRoot = [
  "g_social_relationship",
  ...mixedCountSelectionsWithoutRoot,
] as const satisfies Array<ScenarioSelection>;

const serializerScenarios = [
  {
    selections: [
      "g_person",
      "g_person > p_display_name",
    ] as const satisfies Array<ScenarioSelection>,
    title: "keeps selected variables grounded in one contiguous WHERE graph",
  },
  {
    selections: mixedCountSelectionsWithoutRoot,
    title: "keeps mixed value and count selections grounded in one contiguous WHERE graph",
  },
  {
    selections: mixedCountSelectionsWithRoot,
    title: "keeps mixed value and count selections contiguous when the root node is also selected",
  },
] as const;

const countOnlySelection = [
  {
    selected: "count" as const,
    selection: "g_social_relationship > p_social_relationship_display_name",
  },
] as const satisfies Array<ScenarioSelection>;

describe("serializeScenarioToSparql", () => {
  test.each(serializerScenarios)("$title", ({ selections }) => {
    const pathbuilder = loadDefaultPathbuilder();
    const scenario = createScenarioFromSelections(pathbuilder, selections);
    const query = serializeScenarioToSparql(scenario, pathbuilder);
    const parsedQuery = new SparqlParser().parse(query) as {
      variables?: Array<unknown>;
      where?: Array<unknown>;
    };
    const selectVariables = getProjectedVariables(parsedQuery);
    const nestedQueryProjectedVariables = collectNestedQueryProjectedVariables(
      parsedQuery.where ?? [],
    );
    const whereGraph = collectStatementGraph(parsedQuery.where ?? []);

    for (const variable of selectVariables) {
      if (nestedQueryProjectedVariables.has(variable)) {
        continue;
      }

      expect(whereGraph.variables.has(variable)).toBe(true);
    }

    expectContiguousVariableGraph(whereGraph);
  });

  test("serializes the two mixed count scenarios identically apart from one extra selected variable", () => {
    const pathbuilder = loadDefaultPathbuilder();
    const baseScenario = createScenarioFromSelections(pathbuilder, mixedCountSelectionsWithoutRoot);
    const rootSelectedScenario = createScenarioFromSelections(
      pathbuilder,
      mixedCountSelectionsWithRoot,
    );
    const parser = new SparqlParser();
    const baseParsedQuery = parser.parse(serializeScenarioToSparql(baseScenario, pathbuilder)) as {
      variables?: Array<unknown>;
      where?: Array<unknown>;
    };
    const rootSelectedParsedQuery = parser.parse(
      serializeScenarioToSparql(rootSelectedScenario, pathbuilder),
    ) as {
      variables?: Array<unknown>;
      where?: Array<unknown>;
    };
    const baseSelectVariables = getProjectedVariables(baseParsedQuery);
    const rootSelectedSelectVariables = getProjectedVariables(rootSelectedParsedQuery);
    const additionalVariables = Array.from(rootSelectedSelectVariables).filter((variable) => {
      return !baseSelectVariables.has(variable);
    });

    expect(
      Array.from(baseSelectVariables).filter(
        (variable) => !rootSelectedSelectVariables.has(variable),
      ),
    ).toEqual([]);
    expect(additionalVariables).toHaveLength(1);
    expect(omitTopLevelVariables(rootSelectedParsedQuery)).toEqual(
      omitTopLevelVariables(baseParsedQuery),
    );
  });

  test("serializes a lone count selection as an ungrouped subselect in the WHERE clause", () => {
    const pathbuilder = loadDefaultPathbuilder();
    const scenario = createScenarioFromSelections(pathbuilder, countOnlySelection);
    const parsedQuery = new SparqlParser().parse(
      serializeScenarioToSparql(scenario, pathbuilder),
    ) as {
      where?: Array<unknown>;
    };
    const topLevelWherePatterns = parsedQuery.where ?? [];

    expect(topLevelWherePatterns).toHaveLength(1);

    const subselect = asRecord(topLevelWherePatterns[0]);

    expect(subselect?.type).toBe("query");
    expect("group" in (subselect ?? {})).toBe(false);
  });

  test("wraps entity-reference selections in OPTIONAL blocks when configured", () => {
    const pathbuilder = loadDefaultPathbuilder();
    const scenario = createScenarioFromSelections(pathbuilder, [
      "g_external_authority_has_member_assertion > p_external_authority_has_member_is",
    ]);
    scenario.sparql = {
      ...scenario.sparql,
      makeEntityReferencesOptional: true,
    };
    const parsedQuery = new SparqlParser().parse(
      serializeScenarioToSparql(scenario, pathbuilder),
    ) as {
      where?: Array<unknown>;
    };
    const optionalPatterns = (parsedQuery.where ?? []).filter((pattern) => {
      return asRecord(pattern)?.type === "optional";
    });

    expect(optionalPatterns.length).toBeGreaterThan(0);
  });

  test("comments out intermediate unselected variables in the SELECT clause", () => {
    const pathbuilder = loadDefaultPathbuilder();
    const scenario = createScenarioFromSelections(pathbuilder, ["g_person > p_person_display_name"]);
    const query = serializeScenarioToSparql(scenario, pathbuilder);

    expect(query).toMatch(/SELECT\n\s*#\?\w+/);
  });

  test("wraps all non-root traversals in OPTIONAL blocks when configured", () => {
    const pathbuilder = loadDefaultPathbuilder();
    const scenario = createScenarioFromSelections(pathbuilder, [
      "g_person > g_person_birth_of_person > g_person_birth_of_person_date_of_birth_assertion",
    ]);
    scenario.sparql = {
      ...scenario.sparql,
      makeEntityReferencesOptional: true,
      makeAllFieldsOptional: true,
    };
    const query = serializeScenarioToSparql(scenario, pathbuilder);
    const optionalCount = (query.match(/\bOPTIONAL \{/g) ?? []).length;

    expect(optionalCount).toBeGreaterThanOrEqual(2);
  });
});
