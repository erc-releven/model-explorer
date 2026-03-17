export interface PathbuilderPath {
  group?: string;
  children: Record<string, PathbuilderPath>;
  entity_reference?: string;
  first_own_statement: number;
  id: string;
  name: string;
  path_array: Array<string>;
  raw_xml_tree: Element;
  rdf_type: string;
  references: Array<string>;
}

export class Pathbuilder {
  private readonly pathIdByType = new Map<string, string>();
  private readonly pathsById = new Map<string, PathbuilderPath>();

  public constructor(pathsById: Record<string, PathbuilderPath>) {
    for (const path of Object.values(pathsById)) {
      this.pathsById.set(path.id, path);

      if (path.path_array.length === 1) {
        this.pathIdByType.set(path.path_array[0]!, path.id);
      }
    }
  }

  public getPathById(pathId: string): PathbuilderPath | undefined {
    return this.pathsById.get(pathId);
  }

  public getPathByType(type: string): PathbuilderPath | undefined {
    const pathId = this.pathIdByType.get(type);

    if (pathId == null) {
      return undefined;
    }

    return this.pathsById.get(pathId);
  }

  public values(): Array<PathbuilderPath> {
    return Array.from(this.pathsById.values());
  }
}

function getDirectChildText(pathElement: Element, tagName: string): string {
  const childElement = pathElement.querySelector(`:scope > ${tagName}`);
  return childElement?.textContent.trim() ?? "";
}

function parsePathArray(pathElement: Element): Array<string> {
  const pathArrayElement = pathElement.querySelector(":scope > path_array");

  if (pathArrayElement == null) {
    return [];
  }

  const xValues = Array.from(pathArrayElement.querySelectorAll(":scope > x"))
    .map((element) => element.textContent.trim())
    .filter((value) => value.length > 0);
  const yValues = Array.from(pathArrayElement.querySelectorAll(":scope > y"))
    .map((element) => element.textContent.trim())
    .filter((value) => value.length > 0);
  const interleavedValues: Array<string> = [];
  const maxLength = Math.max(xValues.length, yValues.length);

  for (let index = 0; index < maxLength; index += 1) {
    const xValue = xValues[index];
    const yValue = yValues[index];

    if (xValue != null) {
      interleavedValues.push(xValue);
    }

    if (yValue != null) {
      interleavedValues.push(yValue);
    }
  }

  const datatypeProperty = getDirectChildText(pathElement, "datatype_property");

  if (datatypeProperty !== "empty") {
    interleavedValues.push(datatypeProperty);
  }

  return interleavedValues;
}

function selectRdfType(pathArray: Array<string>): string {
  for (let index = pathArray.length - 1; index >= 0; index -= 1) {
    const candidate = pathArray[index];

    if (candidate == null) {
      continue;
    }

    if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
      return candidate;
    }
  }

  return "";
}

function getCommonPrefixLength(left: Array<string>, right: Array<string>): number {
  const minLength = Math.min(left.length, right.length);
  let index = 0;

  while (index < minLength && left[index] === right[index]) {
    index += 1;
  }

  return index;
}

function parsePathbuilderPath(pathElement: Element): PathbuilderPath {
  const id = getDirectChildText(pathElement, "id");
  const name = getDirectChildText(pathElement, "name");
  const groupId = getDirectChildText(pathElement, "group_id");
  const fieldType = getDirectChildText(pathElement, "fieldtype");
  const path_array = parsePathArray(pathElement);
  const rdf_type = selectRdfType(path_array);
  const isEntityReference = fieldType === "entity_reference";

  return {
    group: groupId === "0" ? undefined : groupId,
    children: {},
    entity_reference: isEntityReference && rdf_type.length > 0 ? rdf_type : undefined,
    first_own_statement: 0,
    id,
    name,
    path_array,
    raw_xml_tree: pathElement.cloneNode(true) as Element,
    rdf_type,
    references: [],
  };
}

export function parsePathbuilderDocument(xmlDocument: Document): Pathbuilder {
  const parserError = xmlDocument.querySelector("parsererror");

  if (parserError != null) {
    throw new Error("Invalid XML: could not parse the provided content.");
  }

  if (xmlDocument.documentElement.nodeName.length === 0) {
    throw new Error("XML file has no root node.");
  }

  const pathsById: Record<string, PathbuilderPath> = {};
  const pathElements = xmlDocument.querySelectorAll("pathbuilderinterface > path");

  for (const pathElement of pathElements) {
    const pathbuilderPath = parsePathbuilderPath(pathElement);

    pathsById[pathbuilderPath.id] = pathbuilderPath;
  }

  for (const path of Object.values(pathsById)) {
    if (path.group) {
      const parentPath = pathsById[path.group];

      if (parentPath != null) {
        parentPath.children[path.id] = path;
        path.first_own_statement = getCommonPrefixLength(path.path_array, parentPath.path_array);
      }
    }
    if (path.entity_reference) {
      for (const candidatePath of Object.values(pathsById)) {
        if (
          candidatePath.path_array.length === 1 &&
          candidatePath.path_array[0] === path.entity_reference
        ) {
          candidatePath.references.push(path.id);
        }
      }
    }
  }

  return new Pathbuilder(pathsById);
}

export function parsePathbuilderXml(xmlContent: string): Pathbuilder {
  const parser = new DOMParser();
  const xmlDocument = parser.parseFromString(xmlContent, "application/xml");

  return parsePathbuilderDocument(xmlDocument);
}
