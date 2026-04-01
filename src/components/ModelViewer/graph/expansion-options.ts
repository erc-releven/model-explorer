import type { Pathbuilder, PathbuilderPath } from "../../../serializer/pathbuilder";
import { resolveTargetPathForNodePath, stringifyPath } from "./graph-paths";

export interface PathNodeExpansionOption {
  disabled: boolean;
  id: string;
  label: string;
  path: Array<string>;
  relationLabel?: "incoming" | "outgoing";
  rdfType: string;
  visible: boolean;
}

function countTraversalSteps(path: Array<string>): number {
  return path.filter((part) => part === ">" || part === "<").length;
}

function isDirectVisibleExtension(
  visiblePathKeys: Set<string>,
  nodePath: Array<string>,
  directPath: Array<string>,
): boolean {
  return (
    directPath.length === nodePath.length + 2 &&
    countTraversalSteps(directPath) === countTraversalSteps(nodePath) + 1 &&
    visiblePathKeys.has(stringifyPath(directPath))
  );
}

function isSameModelClass(left: PathbuilderPath, right: PathbuilderPath): boolean {
  if (left.rdf_type.length > 0 && right.rdf_type.length > 0) {
    return left.rdf_type === right.rdf_type;
  }

  return left.name === right.name;
}

function getPreviousVisiblePathOption(
  pathbuilder: Pathbuilder,
  visiblePathKeys: Set<string>,
  nodePath: Array<string>,
): { path: Array<string>; targetPath: PathbuilderPath } | undefined {
  if (nodePath.length <= 1) {
    return undefined;
  }

  const previousPath = nodePath.slice(0, -2);

  if (!visiblePathKeys.has(stringifyPath(previousPath))) {
    return undefined;
  }

  const previousTargetPath = resolveTargetPathForNodePath(pathbuilder, previousPath);

  if (previousTargetPath == null) {
    return undefined;
  }

  return { path: previousPath, targetPath: previousTargetPath };
}

function idPathReachedFromBelow(nodePath: Array<string>): boolean {
  return nodePath.at(-2) === "<";
}

export function getTopExpansionOptions(
  pathbuilder: Pathbuilder,
  visiblePathKeys: Set<string>,
  nodePath: Array<string>,
  targetPath: PathbuilderPath,
): Array<PathNodeExpansionOption> {
  const previousVisiblePathOption =
    nodePath.at(-2) === ">"
      ? getPreviousVisiblePathOption(pathbuilder, visiblePathKeys, nodePath)
      : undefined;
  const optionPaths =
    targetPath.references.length > 0
      ? targetPath.references.map((referenceId) => [...nodePath, "<", referenceId])
      : idPathReachedFromBelow(nodePath) && targetPath.group != null
        ? [[...nodePath, "<", targetPath.group]]
        : [];

  const resolvedOptions = optionPaths
    .map((path) => {
      const optionTargetPath = resolveTargetPathForNodePath(pathbuilder, path);

      if (optionTargetPath == null) {
        return undefined;
      }

      return {
        disabled: false,
        id: stringifyPath(path),
        label: optionTargetPath.name,
        path,
        relationLabel:
          previousVisiblePathOption != null &&
          isSameModelClass(optionTargetPath, previousVisiblePathOption.targetPath)
            ? "incoming"
            : undefined,
        rdfType: optionTargetPath.rdf_type,
        visible: isDirectVisibleExtension(visiblePathKeys, nodePath, path),
      };
    })
    .filter((option): option is PathNodeExpansionOption => option != null);

  if (previousVisiblePathOption == null) {
    return resolvedOptions;
  }

  const nextOptions: Array<PathNodeExpansionOption> = [];

  for (const option of resolvedOptions) {
    if (option.relationLabel === "incoming") {
      nextOptions.push({
        disabled: true,
        id: `${stringifyPath(previousVisiblePathOption.path)}::outgoing`,
        label: previousVisiblePathOption.targetPath.name,
        path: previousVisiblePathOption.path,
        relationLabel: "outgoing",
        rdfType: previousVisiblePathOption.targetPath.rdf_type,
        visible: true,
      });
    }

    nextOptions.push(option);
  }

  return nextOptions;
}

export function getBottomExpansionOptions(
  pathbuilder: Pathbuilder,
  visiblePathKeys: Set<string>,
  nodePath: Array<string>,
  targetPath: PathbuilderPath,
): Array<PathNodeExpansionOption> {
  const previousVisiblePathOption =
    nodePath.at(-2) === "<"
      ? getPreviousVisiblePathOption(pathbuilder, visiblePathKeys, nodePath)
      : undefined;
  const resolvedOptions = Object.values(targetPath.children).map((childPath) => {
    const path = [...nodePath, ">", childPath.id];

    return {
      disabled: false,
      id: stringifyPath(path),
      label: childPath.name,
      path,
      relationLabel:
        previousVisiblePathOption != null &&
        isSameModelClass(childPath, previousVisiblePathOption.targetPath)
          ? "outgoing"
          : undefined,
      rdfType: childPath.rdf_type,
      visible: isDirectVisibleExtension(visiblePathKeys, nodePath, path),
    };
  });

  if (previousVisiblePathOption == null) {
    return resolvedOptions;
  }

  const nextOptions: Array<PathNodeExpansionOption> = [];

  for (const option of resolvedOptions) {
    if (option.relationLabel === "outgoing") {
      nextOptions.push({
        disabled: true,
        id: `${stringifyPath(previousVisiblePathOption.path)}::incoming`,
        label: previousVisiblePathOption.targetPath.name,
        path: previousVisiblePathOption.path,
        relationLabel: "incoming",
        rdfType: previousVisiblePathOption.targetPath.rdf_type,
        visible: true,
      });
    }

    nextOptions.push(option);
  }

  return nextOptions;
}
