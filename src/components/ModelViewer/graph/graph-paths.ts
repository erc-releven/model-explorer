import type { Pathbuilder, PathbuilderPath } from "../../../serializer/pathbuilder";

export function stringifyPath(path: Array<string>): string {
  return path.join("");
}

export function resolveTargetPathForNodePath(
  pathbuilder: Pathbuilder,
  nodePath: Array<string>,
): PathbuilderPath | undefined {
  const rootId = nodePath[0];

  if (rootId == null) {
    return undefined;
  }

  let currentPath = pathbuilder.getPathById(rootId);

  if (currentPath == null) {
    return undefined;
  }

  for (let index = 1; index < nodePath.length; index += 2) {
    const direction = nodePath[index];
    const segment = nodePath[index + 1];

    if (direction == null || segment == null) {
      return undefined;
    }

    if (direction === ">") {
      const childPath = currentPath.children[segment] as PathbuilderPath | undefined;

      if (childPath == null) {
        return undefined;
      }

      const entityReference = childPath.entity_reference;

      if (entityReference == null) {
        currentPath = childPath;
        continue;
      }

      currentPath = pathbuilder.getPathByType(entityReference) ?? childPath;
      continue;
    }

    if (direction !== "<") {
      return undefined;
    }

    if (currentPath.references.includes(segment)) {
      const referencePath = pathbuilder.getPathById(segment);

      if (referencePath == null) {
        return undefined;
      }

      currentPath =
        referencePath.group == null
          ? referencePath
          : (pathbuilder.getPathById(referencePath.group) ?? referencePath);
      continue;
    }

    if (currentPath.group === segment) {
      currentPath = pathbuilder.getPathById(segment) ?? currentPath;
      continue;
    }

    return undefined;
  }

  return currentPath;
}
