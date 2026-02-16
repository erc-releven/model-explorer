export type PathClassification = "model" | "group" | "reference" | "field";

export interface PathFieldObject {
  [key: string]: PathFieldValue;
}

export type PathFieldValue = string | Array<PathFieldValue> | PathFieldObject;
export type PathFields = Record<string, PathFieldValue>;

export interface PathElement {
  id: string;
  type: string;
  multiple: boolean;
  classification: PathClassification;
  fields: PathFields;
  name: string;
  groupId: string;
  weight: number;
}

export type PathDictionary = Record<string, PathElement>;

export interface ParsedGraph {
  byId: PathDictionary;
  groups: Array<PathElement>;
  childrenByParentId: Partial<Record<string, Array<PathElement>>>;
}

export const EMPTY_GRAPH: ParsedGraph = {
  byId: {},
  groups: [],
  childrenByParentId: {},
};

function parseNode(element: Element): PathFieldValue {
  const children = Array.from(element.children);

  if (children.length === 0) {
    return (element.textContent || "").trim();
  }

  const map: Partial<Record<string, PathFieldValue>> = {};
  for (const child of children) {
    const key = child.tagName;
    const value = parseNode(child);
    const existing = map[key];

    if (existing === undefined) {
      map[key] = value;
    } else if (Array.isArray(existing)) {
      map[key] = [...existing, value];
    } else {
      map[key] = [existing, value];
    }
  }

  return map as PathFieldObject;
}

function readFieldString(value: PathFieldValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function classifyPath(fields: PathFields, groupId: string): PathClassification {
  if (groupId === "0") {
    return "model";
  }
  if (fields.is_group === "1") {
    return "group";
  }
  if (fields.fieldtype === "entity_reference") {
    return "reference";
  }
  return "field";
}

function flattenStringValues(value: PathFieldValue | undefined): Array<string> {
  if (value === undefined) {
    return [];
  }
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenStringValues(item));
  }
  return [];
}

function computePathArray(fields: PathFields): Array<string> {
  const pathArray = fields.path_array;
  let xValues: Array<string> = [];
  let yValues: Array<string> = [];

  if (pathArray && typeof pathArray === "object" && !Array.isArray(pathArray)) {
    xValues = flattenStringValues(pathArray.x);
    yValues = flattenStringValues(pathArray.y);
  }

  const interleaved: Array<string> = [];
  const maxLen = Math.max(xValues.length, yValues.length);
  for (let i = 0; i < maxLen; i += 1) {
    if (i < xValues.length) {
      interleaved.push(xValues[i]);
    }
    if (i < yValues.length) {
      interleaved.push(yValues[i]);
    }
  }

  const datatypeProperty = readFieldString(fields.datatype_property);
  if (datatypeProperty !== "" && datatypeProperty !== "empty") {
    interleaved.push(datatypeProperty);
  }

  return interleaved;
}

function derivePathType(fields: PathFields): string {
  const datatypeProperty = readFieldString(fields.datatype_property);
  if (datatypeProperty !== "empty") {
    return datatypeProperty;
  }

  const pathArray = fields.path_array;
  if (!pathArray || typeof pathArray === "string" || Array.isArray(pathArray)) {
    return "";
  }
  const xValues = flattenStringValues(pathArray.x);
  return xValues[xValues.length - 1] ?? "";
}

export function getComputedPathArrayLength(fields: PathFields): number {
  const value = fields.path_array;
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string")
      .length;
  }
  return 0;
}

export function parseGraphXml(xml: string): ParsedGraph {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const pathNodes = Array.from(document.querySelectorAll("path"));
  const byId: PathDictionary = {};
  const childrenByParentId: Partial<Record<string, Array<PathElement>>> = {};

  for (const pathNode of pathNodes) {
    const parsedFields = parseNode(pathNode) as PathFields;
    const id = readFieldString(parsedFields.id);
    if (id.length === 0) {
      continue;
    }

    const groupId = readFieldString(parsedFields.group_id);
    const weightRaw = readFieldString(parsedFields.weight);
    const weight = Number.isNaN(Number(weightRaw)) ? 0 : Number(weightRaw);
    const name = readFieldString(parsedFields.name) || id;
    const type = derivePathType(parsedFields);
    const multiple = readFieldString(parsedFields.cardinality) === "-1";
    const fields: PathFields = {
      ...parsedFields,
      path_array: computePathArray(parsedFields),
      type,
    };

    byId[id] = {
      id,
      type,
      multiple,
      classification: classifyPath(parsedFields, groupId),
      fields,
      name,
      groupId,
      weight,
    };
  }

  for (const path of Object.values(byId)) {
    const siblings = childrenByParentId[path.groupId];
    if (siblings === undefined) {
      childrenByParentId[path.groupId] = [path];
    } else {
      siblings.push(path);
    }
  }

  const groupIdByType: Record<string, string> = {};
  for (const path of Object.values(byId)) {
    if (path.classification !== "model" || path.type === "") {
      continue;
    }
    groupIdByType[path.type] ??= path.id;
  }

  for (const path of Object.values(byId)) {
    if (path.classification !== "reference") {
      continue;
    }
    path.fields.reference_group_id = groupIdByType[path.type] ?? "";
  }

  for (const children of Object.values(childrenByParentId)) {
    if (!children) {
      continue;
    }
    children.sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name));
  }

  const groups = Object.values(byId)
    .filter((path) => path.classification === "model")
    .sort((a, b) => a.name.localeCompare(b.name));

  return { byId, groups, childrenByParentId };
}

export function collectNonGroupDescendants(
  parentId: string,
  childrenByParentId: Partial<Record<string, Array<PathElement>>>,
): Array<PathElement> {
  const result: Array<PathElement> = [];
  const stack = [...(childrenByParentId[parentId] ?? [])];

  while (stack.length > 0) {
    const current = stack.shift()!;

    if (current.classification !== "model") {
      result.push(current);
    }

    const children = childrenByParentId[current.id] ?? [];
    if (children.length > 0) {
      stack.unshift(...children);
    }
  }

  return result;
}

export async function loadDefaultGraphXml(
  path = "releven_expanded_20251216.xml",
): Promise<string> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${path} (${String(response.status)}).`);
  }
  return response.text();
}

export function readGraphXmlFile(file: File): Promise<string> {
  return file.text();
}
