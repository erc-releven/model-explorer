import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { JSDOM } from "jsdom";
import { describe, expect, test } from "vitest";

import { createDefaultNodeState, defaultSparqlConfig, type Scenario } from "../scenario";
import { parsePathbuilderDocument, type Pathbuilder } from "./pathbuilder";
import { serializeModelStateToPydantic } from "./pydantic";

type SelectionDirection = "<" | ">";

function loadDefaultPathbuilder(): Pathbuilder {
  const xmlSource = __DEFAULT_XML__.trim();

  if (xmlSource.length === 0) {
    throw new Error("DEFAULT_XML is not configured for tests.");
  }

  const xmlContent = readFileSync(resolve(process.cwd(), "public", xmlSource), "utf8");
  const xmlDocument = new JSDOM(xmlContent, { contentType: "text/xml" }).window.document;

  return parsePathbuilderDocument(xmlDocument);
}

function parseSelection(selection: string): Array<string> {
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

  const candidates = Object.values(parentPath.children).filter((candidate) => {
    return createCandidateAliases(candidate.id, parentId).has(segment);
  });

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

describe("serializeModelStateToPydantic", () => {
  test("marks entity-reference fields optional when configured", () => {
    const pathbuilder = loadDefaultPathbuilder();
    const entityReferencePath = resolveSelectionPath(
      pathbuilder,
      "g_external_authority_has_member_assertion > p_external_authority_has_member_is",
    );
    const selectedPath = [...entityReferencePath, ">", "p_person_display_name"];
    const scenario: Scenario = {
      nodes: [
        createDefaultNodeState(["g_external_authority_has_member_assertion"]),
        createDefaultNodeState(entityReferencePath),
        {
          id: selectedPath,
          selected: "value",
        },
      ],
      sparql: defaultSparqlConfig,
      xmlSource: __DEFAULT_XML__,
    };
    scenario.sparql = {
      ...scenario.sparql,
      makeEntityReferencesOptional: true,
    };

    expect(serializeModelStateToPydantic(scenario, pathbuilder)).toContain(
      "display_name: Optional[str] = None",
    );
  });

  test("types selected entity-reference nodes as AnyUrl", () => {
    const pathbuilder = loadDefaultPathbuilder();
    const entityReferencePath = resolveSelectionPath(
      pathbuilder,
      "g_external_authority_has_member_assertion > p_external_authority_has_member_is",
    );
    const scenario: Scenario = {
      nodes: [
        createDefaultNodeState(["g_external_authority_has_member_assertion"]),
        {
          id: entityReferencePath,
          selected: "value",
        },
      ],
      sparql: defaultSparqlConfig,
      xmlSource: __DEFAULT_XML__,
    };
    const model = serializeModelStateToPydantic(scenario, pathbuilder);

    expect(model).toContain("from pydantic import BaseModel, AnyUrl");
    expect(model).toContain("person: AnyUrl");
  });

  test("marks all non-root selected fields optional when configured", () => {
    const pathbuilder = loadDefaultPathbuilder();
    const selectedPath = resolveSelectionPath(pathbuilder, "g_person > p_person_display_name");
    const scenario: Scenario = {
      nodes: [
        createDefaultNodeState(["g_person"]),
        {
          id: selectedPath,
          selected: "value",
        },
      ],
      sparql: {
        ...defaultSparqlConfig,
        makeEntityReferencesOptional: true,
        makeAllFieldsOptional: true,
      },
      xmlSource: __DEFAULT_XML__,
    };

    expect(serializeModelStateToPydantic(scenario, pathbuilder)).toContain(
      "display_name: Optional[str] = None",
    );
  });
});
