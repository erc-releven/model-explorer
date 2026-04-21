import type { Scenario } from "../scenario";
import {
  createSelectedSubgraphAst,
  type ModelAstNode,
  type ModelSubgraphAst,
} from "./ast";
import type { Pathbuilder } from "./pathbuilder";

type PydanticAstTransformer = (tree: ModelSubgraphAst) => void;
type PydanticCompiler = (tree: ModelSubgraphAst) => string;

export interface PydanticProcessorConfig {
  leafType?: string;
  makeAllFieldsOptional?: boolean;
  makeEntityReferencesOptional?: boolean;
  rootModelName?: string;
}

interface PydanticUnifiedProcessor {
  processSync: (tree: ModelSubgraphAst) => string;
  use: (transformer: PydanticAstTransformer) => PydanticUnifiedProcessor;
}

interface SelectedTreeNode {
  children: Array<SelectedTreeNode>;
  isOptional: boolean;
  node: ModelAstNode;
}

function toPascalCase(value: string): string {
  const cleaned = value.replace(/[^A-Z0-9]+/gi, " ").trim();

  if (cleaned.length === 0) {
    return "Node";
  }

  return cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

function toSnakeCase(value: string): string {
  const snake = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

  if (snake.length === 0) {
    return "field";
  }

  return /^\d/.test(snake) ? `f_${snake}` : snake;
}

function createClassNameFromNode(node: ModelAstNode): string {
  const idString = node.data.id_array
    .map((part) => {
      if (part === ">") {
        return "down";
      }

      if (part === "<") {
        return "up";
      }

      return part;
    })
    .join("_");

  return `${toPascalCase(idString)}Model`;
}

function collectSelectedForest(
  nodes: Array<ModelAstNode>,
  currentOptional: boolean,
  makeAllFieldsOptional: boolean,
  makeEntityReferencesOptional: boolean,
): Array<SelectedTreeNode> {
  const selectedTree: Array<SelectedTreeNode> = [];

  for (const node of nodes) {
    const nodeIsOptional =
      currentOptional ||
      (makeAllFieldsOptional && node.data.id_array.length > 1) ||
      (makeEntityReferencesOptional && node.data.enteredThroughEntityReference);
    const selectedChildren = collectSelectedForest(
      node.children,
      node.data.selected == null ? nodeIsOptional : false,
      makeAllFieldsOptional,
      makeEntityReferencesOptional,
    );

    if (node.data.selected != null) {
      selectedTree.push({
        children: selectedChildren,
        isOptional: nodeIsOptional,
        node,
      });
      continue;
    }

    selectedTree.push(...selectedChildren);
  }

  return selectedTree;
}

function visitSelectedTree(
  nodes: Array<SelectedTreeNode>,
  visitor: (node: SelectedTreeNode) => void,
): void {
  for (const node of nodes) {
    visitSelectedTree(node.children, visitor);
    visitor(node);
  }
}

function getSelectedTreeNodeFieldType(
  treeNode: SelectedTreeNode,
  classNameByNodeId: Map<string, string>,
  leafType: string,
): string {
  const childClassName = classNameByNodeId.get(treeNode.node.data.id);

  if (treeNode.children.length > 0 && childClassName != null) {
    return childClassName;
  }

  return treeNode.node.data.selectedEntityReferenceNode ? "AnyUrl" : leafType;
}

function compileAstToPydantic(
  tree: ModelSubgraphAst,
  config: PydanticProcessorConfig,
): string {
  const selectedForest = collectSelectedForest(
    tree.children,
    false,
    config.makeAllFieldsOptional ?? false,
    config.makeEntityReferencesOptional ?? false,
  );
  const leafType = config.leafType ?? "str";
  const rootModelName = config.rootModelName ?? "SelectedModel";

  if (selectedForest.length === 0) {
    return `from pydantic import BaseModel\n\nclass ${rootModelName}(BaseModel):\n    pass`;
  }

  const classNameByNodeId = new Map<string, string>();
  const nodesWithChildren = new Map<string, SelectedTreeNode>();
  let hasOptionalFields = false;
  let usesAnyUrl = false;

  visitSelectedTree(selectedForest, (treeNode) => {
    const nodeId = treeNode.node.data.id;
    classNameByNodeId.set(nodeId, createClassNameFromNode(treeNode.node));

    if (treeNode.isOptional) {
      hasOptionalFields = true;
    }

    if (
      treeNode.node.data.selectedEntityReferenceNode &&
      treeNode.children.length === 0
    ) {
      usesAnyUrl = true;
    }

    if (treeNode.children.length > 0) {
      nodesWithChildren.set(nodeId, treeNode);
    }
  });

  const classBlocks: Array<string> = [];

  for (const treeNode of nodesWithChildren.values()) {
    const className = classNameByNodeId.get(treeNode.node.data.id);

    if (className == null) {
      continue;
    }

    const usedFieldNames = new Set<string>();
    const fields = treeNode.children.map((child) => {
      const rawFieldName = toSnakeCase(child.node.data.targetPath.name);
      let fieldName = rawFieldName;
      let suffix = 1;

      while (usedFieldNames.has(fieldName)) {
        fieldName = `${rawFieldName}_${String(suffix)}`;
        suffix += 1;
      }

      usedFieldNames.add(fieldName);

      const fieldType = getSelectedTreeNodeFieldType(
        child,
        classNameByNodeId,
        leafType,
      );
      const renderedFieldType = child.isOptional
        ? `Optional[${fieldType}]`
        : fieldType;
      const defaultValue = child.isOptional ? " = None" : "";

      return `    ${fieldName}: ${renderedFieldType}${defaultValue}`;
    });

    classBlocks.push(`class ${className}(BaseModel):\n${fields.join("\n")}`);
  }

  const rootUsedNames = new Set<string>();
  const rootFields = selectedForest.map((rootNode) => {
    const rawFieldName = toSnakeCase(rootNode.node.data.targetPath.name);
    let fieldName = rawFieldName;
    let suffix = 1;

    while (rootUsedNames.has(fieldName)) {
      fieldName = `${rawFieldName}_${String(suffix)}`;
      suffix += 1;
    }

    rootUsedNames.add(fieldName);

    const rootType = getSelectedTreeNodeFieldType(
      rootNode,
      classNameByNodeId,
      leafType,
    );
    const renderedRootType = rootNode.isOptional
      ? `Optional[${rootType}]`
      : rootType;
    const defaultValue = rootNode.isOptional ? " = None" : "";

    return `    ${fieldName}: ${renderedRootType}${defaultValue}`;
  });

  return [
    "from __future__ import annotations",
    "",
    ...(hasOptionalFields ? ["from typing import Optional", ""] : []),
    `from pydantic import BaseModel${usesAnyUrl ? ", AnyUrl" : ""}`,
    "",
    ...classBlocks.flatMap((block) => [block, ""]),
    `class ${rootModelName}(BaseModel):`,
    ...rootFields,
  ].join("\n");
}

export function createPydanticProcessor(
  config: PydanticProcessorConfig = {},
): PydanticUnifiedProcessor {
  const transforms: Array<PydanticAstTransformer> = [];
  const compiler: PydanticCompiler = (tree) =>
    compileAstToPydantic(tree, config);

  return {
    processSync(tree: ModelSubgraphAst): string {
      for (const transform of transforms) {
        transform(tree);
      }

      return compiler(tree);
    },
    use(transformer: PydanticAstTransformer): PydanticUnifiedProcessor {
      transforms.push(transformer);
      return this;
    },
  };
}

export function serializeModelStateToPydantic(
  modelState: Scenario,
  pathbuilder: null | Pathbuilder,
  config: PydanticProcessorConfig = {},
): string {
  const ast = createSelectedSubgraphAst(modelState, pathbuilder);
  return createPydanticProcessor({
    ...config,
    makeAllFieldsOptional:
      config.makeAllFieldsOptional ?? modelState.sparql.makeAllFieldsOptional,
    makeEntityReferencesOptional:
      config.makeEntityReferencesOptional ??
      modelState.sparql.makeEntityReferencesOptional,
  }).processSync(ast);
}
