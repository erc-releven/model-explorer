import type {
  Pathbuilder,
  PathbuilderPath,
} from "../../../serializer/pathbuilder";
import {
  resolveTargetPathForNodePath,
  resolveTransitionLabelForNodePath,
  stringifyPath,
} from "./graph-paths";

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

function isSameModelClass(
  left: PathbuilderPath,
  right: PathbuilderPath,
): boolean {
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

  const previousTargetPath = resolveTargetPathForNodePath(
    pathbuilder,
    previousPath,
  );

  if (previousTargetPath == null) {
    return undefined;
  }

  return { path: previousPath, targetPath: previousTargetPath };
}

function getPreviousVisibleOptionLabel(
  pathbuilder: Pathbuilder,
  nodePath: Array<string>,
  previousVisiblePathOption: {
    path: Array<string>;
    targetPath: PathbuilderPath;
  },
): string {
  return (
    resolveTransitionLabelForNodePath(
      pathbuilder,
      nodePath,
      previousVisiblePathOption.targetPath,
    ) ?? previousVisiblePathOption.targetPath.name
  );
}

function getOptionLabel(
  pathbuilder: Pathbuilder,
  path: Array<string>,
  parentTargetPath: PathbuilderPath,
  targetPath: PathbuilderPath,
): string {
  return (
    resolveTransitionLabelForNodePath(pathbuilder, path, parentTargetPath) ??
    targetPath.name
  );
}

function idPathReachedFromBelow(nodePath: Array<string>): boolean {
  return nodePath.at(-2) === "<";
}

function insertOptionBeforeMatchingOutgoing(
  options: Array<PathNodeExpansionOption>,
  optionToInsert: PathNodeExpansionOption,
): Array<PathNodeExpansionOption> {
  const insertionIndex = options.findIndex((option) => {
    return option.relationLabel === "outgoing";
  });

  if (insertionIndex === -1) {
    return [...options, optionToInsert];
  }

  return [
    ...options.slice(0, insertionIndex),
    optionToInsert,
    ...options.slice(insertionIndex),
  ];
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
      ? targetPath.references.map((referenceId) => [
          ...nodePath,
          "<",
          referenceId,
        ])
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
        label: getOptionLabel(pathbuilder, path, targetPath, optionTargetPath),
        path,
        relationLabel:
          previousVisiblePathOption != null &&
          isSameModelClass(
            optionTargetPath,
            previousVisiblePathOption.targetPath,
          )
            ? ("outgoing" as const)
            : undefined,
        rdfType: optionTargetPath.rdf_type,
        visible: isDirectVisibleExtension(visiblePathKeys, nodePath, path),
      };
    })
    .filter((option): option is NonNullable<typeof option> => option != null)
    .filter((option) => {
      return !(
        previousVisiblePathOption != null &&
        option.relationLabel === "outgoing" &&
        option.path.at(-1) === nodePath.at(-1)
      );
    });

  if (previousVisiblePathOption == null) {
    return resolvedOptions;
  }

  const hasOutgoingOption = resolvedOptions.some((option) => {
    return option.relationLabel === "outgoing";
  });

  if (!hasOutgoingOption) {
    return resolvedOptions;
  }

  return insertOptionBeforeMatchingOutgoing(resolvedOptions, {
    disabled: true,
    id: `${stringifyPath(previousVisiblePathOption.path)}::incoming`,
    label: getPreviousVisibleOptionLabel(
      pathbuilder,
      nodePath,
      previousVisiblePathOption,
    ),
    path: previousVisiblePathOption.path,
    relationLabel: "incoming",
    rdfType: previousVisiblePathOption.targetPath.rdf_type,
    visible: true,
  });
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
  const resolvedOptions = Object.values(targetPath.children).map(
    (childPath) => {
      const path = [...nodePath, ">", childPath.id];

      return {
        disabled: false,
        id: stringifyPath(path),
        label: getOptionLabel(pathbuilder, path, targetPath, childPath),
        path,
        relationLabel:
          previousVisiblePathOption != null &&
          isSameModelClass(childPath, previousVisiblePathOption.targetPath)
            ? ("outgoing" as const)
            : undefined,
        rdfType: childPath.rdf_type,
        visible: isDirectVisibleExtension(visiblePathKeys, nodePath, path),
      };
    },
  );

  if (previousVisiblePathOption == null) {
    return resolvedOptions;
  }

  const hasOutgoingOption = resolvedOptions.some((option) => {
    return option.relationLabel === "outgoing";
  });

  if (!hasOutgoingOption) {
    return resolvedOptions;
  }

  return insertOptionBeforeMatchingOutgoing(resolvedOptions, {
    disabled: true,
    id: `${stringifyPath(previousVisiblePathOption.path)}::incoming`,
    label: getPreviousVisibleOptionLabel(
      pathbuilder,
      nodePath,
      previousVisiblePathOption,
    ),
    path: previousVisiblePathOption.path,
    relationLabel: "incoming",
    rdfType: previousVisiblePathOption.targetPath.rdf_type,
    visible: true,
  });
}
