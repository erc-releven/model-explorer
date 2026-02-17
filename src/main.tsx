import "@xyflow/react/dist/style.css";
import "./index.css";

import { type Edge, type Node, type ReactFlowInstance } from "@xyflow/react";
import {
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import colors from "tailwindcss/colors";

import {
  COUNT_HIGHLIGHT_GREEN,
  FALLBACK_REFERENCED_GROUP_COLOR,
  getNodeBorderClass,
  getNodeBorderRadius,
  getNodeContainerClass,
  getSelectionDoubleBorderShadow,
  GROUP_COLOR_PALETTE,
  NODE_REFERENCE_LABEL_BG_COLOR,
  NODE_REFERENCE_LABEL_TEXT_COLOR,
} from "./components/GraphDisplaySection";
import { HoverTooltipButton } from "./components/HoverTooltipButton";
import { ModelViewer } from "./components/ModelViewer";
import { ModelNodeTooltipOverlay } from "./components/ModelNodeTooltipOverlay";
import { XmlLoaderSection } from "./components/XmlLoaderSection";
import {
  collectNonGroupDescendants,
  EMPTY_GRAPH,
  getComputedPathArrayLength,
  loadDefaultGraphXml,
  parseGraphXml,
  type PathDictionary,
  type PathElement,
  readGraphXmlFile,
} from "./pathbuilder";
import { abbreviateType } from "./prefixes";
import {
  buildNodeSelectionEntries,
  CURRENT_SELECTION_DRAFTS_STORAGE_KEY,
  type CurrentSelectionDraft,
  type DerivedSelectionState,
  deriveSelectionState,
  LAST_ACTIVE_SAVED_TAB_STORAGE_KEY,
  mergeSelectionStateWithPreviousEntries,
  type NodeSelectionEntry,
  normalizeList,
  parseSavedSelectionTabsFromStorage,
  sameList,
  sameNodeSelectionEntries,
  sanitizeCurrentSelectionDraft,
  SAVED_SELECTIONS_STORAGE_KEY,
  type SavedSelectionTab,
} from "./selection";
import {
  generateSparqlQuery,
  type SparqlSelectedEdge,
  type SparqlSelectedNode,
} from "./sparql";
import {
  applyUrlSelectionState,
  hasUrlSelectionState,
  parseUrlSelectionState,
} from "./url-state";

const CURRENT_QUERY_TAB_ID = "__current__";
const FLOW_VERTICAL_GAP = 170;
const SELECTED_EDGE_COLOR = colors.neutral[900];
const DEFAULT_EDGE_COLOR = colors.slate[400];

function readFieldString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildGroupReferenceCounts(
  byId: PathDictionary,
): Record<string, number> {
  const referenceCounts: Record<string, number> = {};

  for (const path of Object.values(byId)) {
    if (path.classification !== "reference") {
      continue;
    }

    const referencedGroupId = readFieldString(path.fields.reference_group_id);
    if (referencedGroupId === "") {
      continue;
    }

    referenceCounts[referencedGroupId] =
      (referenceCounts[referencedGroupId] ?? 0) + 1;
  }

  return referenceCounts;
}

function buildReferencedGroupColors(
  referenceCounts: Record<string, number>,
): Record<string, string> {
  const groupIds = Object.keys(referenceCounts).sort();
  const colors: Record<string, string> = {};

  for (const [index, groupId] of groupIds.entries()) {
    colors[groupId] = GROUP_COLOR_PALETTE[index % GROUP_COLOR_PALETTE.length];
  }

  return colors;
}

function buildSelectedAdjacency(
  edges: Array<Edge>,
  selectedNodeIds: Set<string>,
): Map<string, Array<{ neighborId: string; edgeId: string }>> {
  const adjacency = new Map<
    string,
    Array<{ neighborId: string; edgeId: string }>
  >();

  const add = (fromId: string, toId: string, edgeId: string): void => {
    const existing = adjacency.get(fromId) ?? [];
    existing.push({ neighborId: toId, edgeId });
    adjacency.set(fromId, existing);
  };

  for (const edge of edges) {
    if (
      !selectedNodeIds.has(edge.source) ||
      !selectedNodeIds.has(edge.target)
    ) {
      continue;
    }
    add(edge.source, edge.target, edge.id);
    add(edge.target, edge.source, edge.id);
  }

  return adjacency;
}

function buildNodeAdjacency(edges: Array<Edge>): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();

  const add = (fromId: string, toId: string): void => {
    const existing = adjacency.get(fromId) ?? new Set<string>();
    existing.add(toId);
    adjacency.set(fromId, existing);
  };

  for (const edge of edges) {
    add(edge.source, edge.target);
    add(edge.target, edge.source);
  }

  return adjacency;
}

function findShortestPathToSelected(
  targetNodeId: string,
  selectedNodeIds: Set<string>,
  edges: Array<Edge>,
): Array<string> | null {
  if (selectedNodeIds.size === 0) {
    return [targetNodeId];
  }
  if (selectedNodeIds.has(targetNodeId)) {
    return [targetNodeId];
  }

  const adjacency = buildNodeAdjacency(edges);
  const queue: Array<string> = [targetNodeId];
  const visited = new Set<string>([targetNodeId]);
  const parent = new Map<string, string>();
  let reachedSelected: string | null = null;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }

    if (selectedNodeIds.has(current)) {
      reachedSelected = current;
      break;
    }

    for (const neighbor of adjacency.get(current) ?? []) {
      if (visited.has(neighbor)) {
        continue;
      }
      visited.add(neighbor);
      parent.set(neighbor, current);
      queue.push(neighbor);
    }
  }

  if (!reachedSelected) {
    return null;
  }

  const path: Array<string> = [reachedSelected];
  let cursor = reachedSelected;
  while (cursor !== targetNodeId) {
    const next = parent.get(cursor);
    if (!next) {
      return null;
    }
    path.push(next);
    cursor = next;
  }

  return path;
}

function getReachableSelectedFromFirst(
  firstSelectedNodeId: string | null,
  selectedNodeIds: Set<string>,
  edges: Array<Edge>,
): Set<string> {
  if (!firstSelectedNodeId || !selectedNodeIds.has(firstSelectedNodeId)) {
    return new Set<string>();
  }

  const selectedAdjacency = buildSelectedAdjacency(edges, selectedNodeIds);
  const reachable = new Set<string>([firstSelectedNodeId]);
  const queue: Array<string> = [firstSelectedNodeId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    for (const adjacent of selectedAdjacency.get(current) ?? []) {
      if (reachable.has(adjacent.neighborId)) {
        continue;
      }
      reachable.add(adjacent.neighborId);
      queue.push(adjacent.neighborId);
    }
  }

  return reachable;
}

function resolveEffectiveSelection({
  firstSelectedNodeId,
  explicitSelectedNodeIds,
  edges,
}: {
  firstSelectedNodeId: string | null;
  explicitSelectedNodeIds: Set<string>;
  edges: Array<Edge>;
}): { effective: Set<string>; implicit: Set<string> } {
  if (
    !firstSelectedNodeId ||
    !explicitSelectedNodeIds.has(firstSelectedNodeId)
  ) {
    return { effective: new Set<string>(), implicit: new Set<string>() };
  }

  const effective = new Set<string>([firstSelectedNodeId]);
  const implicit = new Set<string>();
  const orderedExplicitNodeIds = [
    firstSelectedNodeId,
    ...Array.from(explicitSelectedNodeIds).filter(
      (nodeId) => nodeId !== firstSelectedNodeId,
    ),
  ];

  for (const explicitNodeId of orderedExplicitNodeIds) {
    if (effective.has(explicitNodeId)) {
      continue;
    }

    const bridgePath = findShortestPathToSelected(
      explicitNodeId,
      effective,
      edges,
    );
    if (!bridgePath) {
      effective.add(explicitNodeId);
      continue;
    }

    for (const pathNodeId of bridgePath) {
      effective.add(pathNodeId);
      if (!explicitSelectedNodeIds.has(pathNodeId)) {
        implicit.add(pathNodeId);
      }
    }
  }

  return { effective, implicit };
}

function toggleNodeSelection(
  prev: { first: string | null; selected: Set<string> },
  nodeId: string,
  edges: Array<Edge>,
): { first: string | null; selected: Set<string> } {
  void edges;

  const selected = new Set(prev.selected);
  if (!selected.has(nodeId)) {
    selected.add(nodeId);
    return { first: prev.first ?? nodeId, selected };
  }
  selected.delete(nodeId);
  if (selected.size === 0) {
    return { first: null, selected };
  }
  if (prev.first === nodeId) {
    return { first: null, selected: new Set() };
  }
  return { first: prev.first, selected };
}

function buildFlowForGroup({
  group,
  byId,
  childrenByParentId,
  referencedGroupColors,
  expandedChildNodeIds,
  expandedAboveNodeIds,
  selectedNodeIds,
  countNodeIds,
  firstSelectedNodeId,
  onToggleChildren,
  onToggleAbove,
}: {
  group: PathElement;
  byId: PathDictionary;
  childrenByParentId: Partial<Record<string, Array<PathElement>>>;
  referencedGroupColors: Record<string, string>;
  expandedChildNodeIds: Set<string>;
  expandedAboveNodeIds: Set<string>;
  selectedNodeIds: Set<string>;
  countNodeIds: Set<string>;
  firstSelectedNodeId: string | null;
  onToggleChildren: (nodeId: string) => void;
  onToggleAbove: (nodeId: string) => void;
}) {
  interface DisplayNode {
    displayId: string;
    sourceId: string;
    path: PathElement;
    inCloneBranch: boolean;
    viaReferenceName?: string;
    viaReferenceSourceId?: string;
  }

  const horizontalGap = 280;
  const verticalGap = FLOW_VERTICAL_GAP;
  const fixedModelReferenceCounts = buildGroupReferenceCounts(byId);
  const edges: Array<Edge> = [];
  const displayNodesById = new Map<string, DisplayNode>();
  const prelinkedChildSourcesByAboveParent = new Map<string, Set<string>>();
  const entryChildDisplayIdByAboveParent = new Map<string, string>();
  const directEntityRefAboveParentIds = new Set<string>();
  const soleParentAboveDisplayIds = new Set<string>();
  const incomingParentSourceIdByDisplayId = new Map<string, string>();
  const subtreeWidthMemo = new Map<string, number>();
  const subtreeWidthInProgress = new Set<string>();
  const positions = new Map<string, { x: number; y: number }>();

  function getSourceChildren(node: DisplayNode): Array<PathElement> {
    if (node.path.classification === "reference") {
      const referencedModelId = readFieldString(
        node.path.fields.reference_group_id,
      );
      if (referencedModelId !== "") {
        return childrenByParentId[referencedModelId] ?? [];
      }
    }

    return childrenByParentId[node.sourceId] ?? [];
  }

  function getVisibleChildren(
    node: DisplayNode,
    ancestry: Set<string>,
  ): Array<DisplayNode> {
    const isFieldNode = getComputedPathArrayLength(node.path.fields) % 2 === 0;
    if (isFieldNode) {
      return [];
    }

    if (!expandedChildNodeIds.has(node.displayId)) {
      return [];
    }

    const sourceChildren = getSourceChildren(node);
    const nextCloneBranch =
      node.inCloneBranch || node.path.classification === "reference";

    return sourceChildren
      .filter((child) => !ancestry.has(child.id))
      .map((child, index) => ({
        displayId: nextCloneBranch
          ? `${node.displayId}::${child.id}::${String(index)}`
          : child.id,
        sourceId: child.id,
        path: child,
        inCloneBranch: nextCloneBranch,
      }));
  }

  function getTypeReferenceParents(node: DisplayNode): Array<{
    parent: PathElement;
    viaReferenceName: string;
    viaReferenceSourceId: string;
  }> {
    const uniqueParentGroups = new Map<
      string,
      {
        parent: PathElement;
        viaReferenceName: string;
        viaReferenceSourceId: string;
      }
    >();

    for (const path of Object.values(byId)) {
      const referencedGroupId = readFieldString(path.fields.reference_group_id);
      const matchesEntityReferenceByType =
        node.path.type !== "" && path.type === node.path.type;
      const matchesEntityReferenceByGroupTarget =
        referencedGroupId !== "" && referencedGroupId === node.sourceId;
      if (
        path.classification !== "reference" ||
        (!matchesEntityReferenceByType &&
          !matchesEntityReferenceByGroupTarget) ||
        path.id === node.sourceId
      ) {
        continue;
      }

      const parentGroupId = path.groupId;
      if (parentGroupId === "0") {
        continue;
      }

      const parentGroup = byId[parentGroupId];
      if (parentGroup.id === node.sourceId) {
        continue;
      }

      if (!uniqueParentGroups.has(parentGroup.id)) {
        uniqueParentGroups.set(parentGroup.id, {
          parent: parentGroup,
          viaReferenceName: path.name,
          viaReferenceSourceId: path.id,
        });
      }
    }

    return Array.from(uniqueParentGroups.values());
  }

  function getHierarchyParent(node: DisplayNode): PathElement | null {
    const parentId = node.path.groupId;
    if (!parentId || parentId === "0") {
      return null;
    }
    return byId[parentId] ?? null;
  }

  function computeSubtreeWidth(
    node: DisplayNode,
    ancestry: Set<string>,
  ): number {
    if (subtreeWidthMemo.has(node.displayId)) {
      return subtreeWidthMemo.get(node.displayId)!;
    }

    if (subtreeWidthInProgress.has(node.displayId)) {
      return 1;
    }

    subtreeWidthInProgress.add(node.displayId);
    const nextAncestry = new Set(ancestry);
    nextAncestry.add(node.sourceId);
    const children = getVisibleChildren(node, nextAncestry);
    let width = 0;

    if (children.length === 0) {
      width = 1;
    } else {
      for (const child of children) {
        width += computeSubtreeWidth(child, nextAncestry);
      }
      width = Math.max(width, 1);
    }

    subtreeWidthInProgress.delete(node.displayId);
    subtreeWidthMemo.set(node.displayId, width);
    return width;
  }

  function placeNode(
    node: DisplayNode,
    depth: number,
    leftBoundary: number,
    ancestry: Set<string>,
  ): void {
    if (displayNodesById.has(node.displayId)) {
      return;
    }

    displayNodesById.set(node.displayId, node);

    const nextAncestry = new Set(ancestry);
    nextAncestry.add(node.sourceId);
    const nodeWidth = computeSubtreeWidth(node, ancestry);
    const center = leftBoundary + nodeWidth / 2;
    positions.set(node.displayId, {
      x: center * horizontalGap,
      y: depth * verticalGap,
    });

    let cursor = leftBoundary;
    for (const child of getVisibleChildren(node, nextAncestry)) {
      const edgeReferenceLabel =
        child.path.classification === "reference" ? child.path.name : undefined;
      incomingParentSourceIdByDisplayId.set(child.displayId, node.sourceId);
      edges.push({
        id: `${node.displayId}->${child.displayId}`,
        source: node.displayId,
        target: child.displayId,
        data:
          child.path.classification === "reference"
            ? {
                viaReferenceSourcePathId: child.sourceId,
                edgeReferenceNodeId: child.sourceId,
              }
            : undefined,
        label: edgeReferenceLabel,
        labelShowBg: edgeReferenceLabel ? true : undefined,
        labelStyle: edgeReferenceLabel
          ? {
              fontSize: 10,
              color: NODE_REFERENCE_LABEL_TEXT_COLOR,
              fontWeight: 600,
            }
          : undefined,
        labelBgStyle: edgeReferenceLabel
          ? {
              fill: NODE_REFERENCE_LABEL_BG_COLOR,
              opacity: 0.95,
            }
          : undefined,
        labelBgBorderRadius: edgeReferenceLabel ? 4 : undefined,
        labelBgPadding: edgeReferenceLabel ? [4, 2] : undefined,
      });

      const childWidth = computeSubtreeWidth(child, nextAncestry);
      placeNode(child, depth + 1, cursor, nextAncestry);
      cursor += childWidth;
    }
  }

  const rootNode: DisplayNode = {
    displayId: group.id,
    sourceId: group.id,
    path: group,
    inCloneBranch: false,
  };

  computeSubtreeWidth(rootNode, new Set());
  placeNode(rootNode, 0, 0, new Set());

  const initialDisplayedSourceIds = new Set<string>(
    Array.from(displayNodesById.values(), (node) => node.sourceId),
  );

  function getAboveParentNodes(
    node: DisplayNode,
    availableSourceIds: Set<string>,
    ancestry: Set<string>,
  ): Array<DisplayNode> {
    const referenceParents = getTypeReferenceParents(node).map((entry) => ({
      path: entry.parent,
      kind: "reference" as const,
      viaReferenceName: entry.viaReferenceName,
      viaReferenceSourceId: entry.viaReferenceSourceId,
    }));
    const hierarchyParent = getHierarchyParent(node);
    const hierarchyParents = hierarchyParent
      ? [
          {
            path: hierarchyParent,
            kind: "parent" as const,
            viaReferenceName: undefined,
          },
        ]
      : [];
    const combined = [...referenceParents, ...hierarchyParents];

    const unique = new Map<
      string,
      {
        path: PathElement;
        kind: "reference" | "parent";
        viaReferenceName?: string;
        viaReferenceSourceId?: string;
      }
    >();
    for (const parent of combined) {
      if (ancestry.has(parent.path.id)) {
        continue;
      }
      if (!unique.has(parent.path.id)) {
        unique.set(parent.path.id, parent);
      }
    }

    return Array.from(unique.values()).map((parent, index) => ({
      displayId: `${node.displayId}::above::${parent.kind}::${parent.path.id}::${String(index)}`,
      sourceId: parent.path.id,
      path: parent.path,
      inCloneBranch: true,
      viaReferenceName: parent.viaReferenceName,
      viaReferenceSourceId: parent.viaReferenceSourceId,
    }));
  }

  function computeAboveBranchWidth(
    node: DisplayNode,
    availableSourceIds: Set<string>,
    ancestry: Set<string>,
  ): number {
    if (!expandedAboveNodeIds.has(node.displayId)) {
      return 1;
    }

    const nextAncestry = new Set(ancestry);
    nextAncestry.add(node.sourceId);
    const parents = getAboveParentNodes(node, availableSourceIds, nextAncestry);
    if (parents.length === 0) {
      return 1;
    }

    let width = 0;
    for (const parent of parents) {
      const nextAvailable = new Set(availableSourceIds);
      nextAvailable.add(parent.sourceId);
      width += computeAboveBranchWidth(parent, nextAvailable, nextAncestry);
    }
    return Math.max(width, 1);
  }

  function placeAboveBranches(
    node: DisplayNode,
    depth: number,
    availableSourceIds: Set<string>,
    ancestry: Set<string>,
  ): void {
    if (!expandedAboveNodeIds.has(node.displayId)) {
      return;
    }

    const nodePosition = positions.get(node.displayId);
    if (!nodePosition) {
      return;
    }

    const nextAncestry = new Set(ancestry);
    nextAncestry.add(node.sourceId);
    const parents = getAboveParentNodes(node, availableSourceIds, nextAncestry);
    if (parents.length === 0) {
      return;
    }
    if (parents.length === 1) {
      soleParentAboveDisplayIds.add(parents[0].displayId);
    }

    const parentWidths = parents.map((parent) => {
      const nextAvailable = new Set(availableSourceIds);
      nextAvailable.add(parent.sourceId);
      return computeAboveBranchWidth(parent, nextAvailable, nextAncestry);
    });
    const totalWidth = parentWidths.reduce((sum, width) => sum + width, 0);
    let cursor = nodePosition.x / horizontalGap - totalWidth / 2;

    for (let i = 0; i < parents.length; i += 1) {
      const parent = parents[i];
      const branchWidth = parentWidths[i];
      const parentCenter = cursor + branchWidth / 2;
      const parentX = parentCenter * horizontalGap;
      const parentY = (depth - 1) * verticalGap;

      if (!displayNodesById.has(parent.displayId)) {
        displayNodesById.set(parent.displayId, parent);
        positions.set(parent.displayId, { x: parentX, y: parentY });
      }

      edges.push({
        id: `${parent.displayId}->${node.displayId}`,
        source: parent.displayId,
        target: node.displayId,
        data: parent.viaReferenceSourceId
          ? {
              viaReferenceSourcePathId: parent.viaReferenceSourceId,
              edgeReferenceNodeId: parent.viaReferenceSourceId,
            }
          : undefined,
        label: parent.viaReferenceName ?? undefined,
        labelShowBg: parent.viaReferenceName ? true : undefined,
        labelStyle: parent.viaReferenceName
          ? {
              fontSize: 10,
              color: NODE_REFERENCE_LABEL_TEXT_COLOR,
              fontWeight: 600,
            }
          : undefined,
        labelBgStyle: parent.viaReferenceName
          ? {
              fill: NODE_REFERENCE_LABEL_BG_COLOR,
              opacity: 0.95,
            }
          : undefined,
        labelBgBorderRadius: parent.viaReferenceName ? 4 : undefined,
        labelBgPadding: parent.viaReferenceName ? [4, 2] : undefined,
      });
      if (!prelinkedChildSourcesByAboveParent.has(parent.displayId)) {
        prelinkedChildSourcesByAboveParent.set(parent.displayId, new Set());
      }
      if (!entryChildDisplayIdByAboveParent.has(parent.displayId)) {
        entryChildDisplayIdByAboveParent.set(parent.displayId, node.displayId);
      }
      if (parent.viaReferenceSourceId) {
        directEntityRefAboveParentIds.add(parent.displayId);
        prelinkedChildSourcesByAboveParent
          .get(parent.displayId)!
          .add(parent.viaReferenceSourceId);
      } else {
        prelinkedChildSourcesByAboveParent
          .get(parent.displayId)!
          .add(node.sourceId);
      }

      const nextAvailable = new Set(availableSourceIds);
      nextAvailable.add(parent.sourceId);
      placeAboveBranches(parent, depth - 1, nextAvailable, nextAncestry);
      cursor += branchWidth;
    }
  }

  function runAboveExpansionPass(availableSourceIds: Set<string>): void {
    const queue: Array<{
      node: DisplayNode;
      depth: number;
      availableSourceIds: Set<string>;
      ancestry: Set<string>;
    }> = Array.from(displayNodesById.values()).map((node) => ({
      node,
      depth: Math.round((positions.get(node.displayId)?.y ?? 0) / verticalGap),
      availableSourceIds: new Set(availableSourceIds),
      ancestry: new Set<string>(),
    }));
    const processedAbove = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (processedAbove.has(current.node.displayId)) {
        continue;
      }
      processedAbove.add(current.node.displayId);

      const beforeSize = displayNodesById.size;
      placeAboveBranches(
        current.node,
        current.depth,
        current.availableSourceIds,
        current.ancestry,
      );
      if (displayNodesById.size > beforeSize) {
        for (const node of displayNodesById.values()) {
          if (!processedAbove.has(node.displayId)) {
            queue.push({
              node,
              depth: Math.round(
                (positions.get(node.displayId)?.y ?? 0) / verticalGap,
              ),
              availableSourceIds: new Set(
                Array.from(displayNodesById.values(), (n) => n.sourceId),
              ),
              ancestry: new Set<string>(),
            });
          }
        }
      }
    }
  }

  function addExpandedChildrenForAboveNode(
    parentDisplayId: string,
    parentNode: DisplayNode,
    depth: number,
    excludedChildSourceIds: Set<string>,
    ancestry: Set<string>,
  ): void {
    if (!expandedChildNodeIds.has(parentDisplayId)) {
      return;
    }

    const parentPosition = positions.get(parentDisplayId);
    if (!parentPosition) {
      return;
    }

    const children = getSourceChildren(parentNode).filter(
      (child) =>
        !excludedChildSourceIds.has(child.id) && !ancestry.has(child.id),
    );
    if (children.length === 0) {
      return;
    }

    function resolveNonOverlappingX(
      desiredX: number,
      rowY: number,
      selfId: string,
      direction: 1 | -1,
    ): number {
      const minGap = 220;
      let candidateX = desiredX;

      for (let iteration = 0; iteration < 200; iteration += 1) {
        let hasOverlap = false;
        for (const [existingId, existingPosition] of positions.entries()) {
          if (existingId === selfId) {
            continue;
          }
          if (Math.abs(existingPosition.y - rowY) > 0.5) {
            continue;
          }
          if (Math.abs(existingPosition.x - candidateX) < minGap) {
            candidateX = existingPosition.x + direction * minGap;
            hasOverlap = true;
            break;
          }
        }

        if (!hasOverlap) {
          break;
        }
      }

      return candidateX;
    }

    const entryChildDisplayId =
      entryChildDisplayIdByAboveParent.get(parentDisplayId) ?? null;
    const entryChildPositionX =
      entryChildDisplayId !== null
        ? (positions.get(entryChildDisplayId)?.x ?? null)
        : null;
    const sideDirection: 1 | -1 =
      entryChildPositionX === null
        ? 1
        : entryChildPositionX <= parentPosition.x
          ? 1
          : -1;
    const useDirectEntityRefSideLayout =
      directEntityRefAboveParentIds.has(parentDisplayId) &&
      entryChildPositionX !== null;
    const entryAnchorX = entryChildPositionX ?? parentPosition.x;
    const startX = useDirectEntityRefSideLayout
      ? entryAnchorX + sideDirection * 220
      : parentPosition.x - ((children.length - 1) * 220) / 2;
    for (const [index, child] of children.entries()) {
      const childDisplayId = `${parentDisplayId}::down::${child.id}::${String(index)}`;
      const childNode: DisplayNode = {
        displayId: childDisplayId,
        sourceId: child.id,
        path: child,
        inCloneBranch: true,
      };
      incomingParentSourceIdByDisplayId.set(
        childDisplayId,
        parentNode.sourceId,
      );

      if (!displayNodesById.has(childDisplayId)) {
        const rowY = (depth + 1) * verticalGap;
        const desiredX = useDirectEntityRefSideLayout
          ? startX + sideDirection * index * 220
          : startX + index * 220;
        const safeX = resolveNonOverlappingX(
          desiredX,
          rowY,
          childDisplayId,
          useDirectEntityRefSideLayout ? sideDirection : 1,
        );
        displayNodesById.set(childDisplayId, childNode);
        positions.set(childDisplayId, {
          x: safeX,
          y: rowY,
        });
      }

      edges.push({
        id: `${parentDisplayId}->${childDisplayId}`,
        source: parentDisplayId,
        target: childDisplayId,
      });

      const nextAncestry = new Set(ancestry);
      nextAncestry.add(child.id);
      addExpandedChildrenForAboveNode(
        childDisplayId,
        childNode,
        depth + 1,
        new Set(),
        nextAncestry,
      );
    }
  }

  function runDownwardExpansionFromAboveParents(): void {
    for (const [
      parentDisplayId,
      excludedChildSourceIds,
    ] of prelinkedChildSourcesByAboveParent.entries()) {
      const parentNode = displayNodesById.get(parentDisplayId);
      if (!parentNode) {
        continue;
      }
      const depth = Math.round(
        (positions.get(parentDisplayId)?.y ?? 0) / verticalGap,
      );
      const ancestry = new Set<string>([parentNode.sourceId]);
      addExpandedChildrenForAboveNode(
        parentDisplayId,
        parentNode,
        depth,
        excludedChildSourceIds,
        ancestry,
      );
    }
  }

  // Resolve above/downward expansions to a fixed point so nodes introduced
  // by an up->down step can still participate in later upward expansion.
  for (let i = 0; i < 8; i += 1) {
    const beforeSize = displayNodesById.size;
    runAboveExpansionPass(
      i === 0
        ? initialDisplayedSourceIds
        : new Set(Array.from(displayNodesById.values(), (n) => n.sourceId)),
    );
    runDownwardExpansionFromAboveParents();
    if (displayNodesById.size === beforeSize) {
      break;
    }
  }

  const displayedSourceIds = new Set<string>(
    Array.from(displayNodesById.values(), (node) => node.sourceId),
  );

  const {
    effective: effectiveSelectedNodeIds,
    implicit: implicitSelectedNodeIds,
  } = resolveEffectiveSelection({
    firstSelectedNodeId,
    explicitSelectedNodeIds: selectedNodeIds,
    edges,
  });

  const rootPosition = positions.get(rootNode.displayId);
  const xOffset = rootPosition ? rootPosition.x : 0;
  const nodes: Array<Node> = [];

  for (const [displayId, displayNode] of displayNodesById.entries()) {
    const levelNode = displayNode.path;
    const referencedGroupId = readFieldString(
      levelNode.fields.reference_group_id,
    );
    const referencedGroupColor =
      referencedGroupColors[referencedGroupId] ??
      FALLBACK_REFERENCED_GROUP_COLOR;
    const sourceNodeColor = referencedGroupColors[displayNode.sourceId];
    const nodeBackgroundColor =
      levelNode.classification === "reference"
        ? referencedGroupColor
        : sourceNodeColor;
    const sourceChildren = getSourceChildren(displayNode);
    const isCollapsed = !expandedChildNodeIds.has(displayId);
    const hasChildren = sourceChildren.length > 0;
    const totalChildCount = sourceChildren.length;
    const isModelNode = levelNode.classification === "model";
    const typeReferenceParents = getTypeReferenceParents(displayNode);
    const typeReferenceParentCount = typeReferenceParents.length;
    const hierarchyParent = getHierarchyParent(displayNode);
    const expandableAboveIds = new Set<string>(
      typeReferenceParents.map((entry) => entry.parent.id),
    );
    if (hierarchyParent) {
      expandableAboveIds.add(hierarchyParent.id);
    }
    const expandableAboveCount = expandableAboveIds.size;
    const isFieldNode = getComputedPathArrayLength(levelNode.fields) % 2 === 0;
    const isGroupLike =
      levelNode.classification === "model" ||
      levelNode.classification === "group" ||
      levelNode.classification === "reference";
    const hasExpandableParents = expandableAboveCount > 0;
    const parentsExpanded = expandedAboveNodeIds.has(displayId);
    const position = positions.get(displayId)!;
    const isSelected = effectiveSelectedNodeIds.has(displayId);
    const isImplicitlySelected = implicitSelectedNodeIds.has(displayId);
    const isCountNode = countNodeIds.has(displayId);
    const isFirstSelected = firstSelectedNodeId === displayId;
    const reachedFromAbove = displayId.includes("::down::");
    const reachedFromBelow = displayId.includes("::above::");
    const incomingParentSourceId =
      incomingParentSourceIdByDisplayId.get(displayId) ?? null;
    const hasOtherExpandableParents = Array.from(expandableAboveIds).some(
      (parentId) => parentId !== incomingParentSourceId,
    );
    const hideTopExpandButtonByIncomingParent =
      reachedFromAbove &&
      incomingParentSourceId !== null &&
      !hasOtherExpandableParents;
    const hideTopExpandButtonForClonedNonReferenceNode =
      displayNode.inCloneBranch && levelNode.classification !== "reference";
    const hideTopExpandButtonForFieldNode = isFieldNode;
    const hideTopExpandButtonByDefault =
      hideTopExpandButtonByIncomingParent ||
      hideTopExpandButtonForClonedNonReferenceNode ||
      hideTopExpandButtonForFieldNode;
    const forceShowTopExpandButtonForModelEntityReferences =
      isModelNode &&
      typeReferenceParents.some(
        (entry) => entry.parent.id !== incomingParentSourceId,
      );
    const hideTopExpandButton = reachedFromBelow
      ? levelNode.classification === "group" || isFieldNode
        ? false
        : !forceShowTopExpandButtonForModelEntityReferences &&
          hideTopExpandButtonByDefault
      : !forceShowTopExpandButtonForModelEntityReferences &&
        hideTopExpandButtonByDefault;
    const incomingLinkedChildSourceIds =
      prelinkedChildSourcesByAboveParent.get(displayId) ?? new Set<string>();
    const hasOtherChildrenBeyondIncoming = sourceChildren.some(
      (child) => !incomingLinkedChildSourceIds.has(child.id),
    );
    const hideBottomExpandButton =
      reachedFromBelow &&
      soleParentAboveDisplayIds.has(displayId) &&
      !hasOtherChildrenBeyondIncoming;
    const tooltipModelId = isModelNode
      ? levelNode.id
      : levelNode.classification === "reference" && referencedGroupId !== ""
        ? referencedGroupId
        : "";
    const modelGroupFieldCount = isModelNode
      ? collectNonGroupDescendants(levelNode.id, childrenByParentId).length
      : 0;
    const tooltipReferenceCount =
      tooltipModelId !== ""
        ? (fixedModelReferenceCounts[tooltipModelId] ?? 0)
        : 0;
    const nodeBorderClass = getNodeBorderClass(levelNode.classification);
    const selectionDoubleBorderShadow = getSelectionDoubleBorderShadow({
      isFirstSelected,
      isCountNode,
      isSelected,
      isImplicitlySelected,
    });
    const implicitSelectionOutline =
      isImplicitlySelected && !isFirstSelected && !isCountNode
        ? "2px dashed #171717"
        : undefined;
    nodes.push({
      id: displayId,
      position: { x: position.x - xOffset, y: position.y },
      className: getNodeContainerClass(isGroupLike, nodeBorderClass),
      data: {
        sourcePathId: displayNode.sourceId,
        label: (
          <div className="relative inline-flex flex-col items-center justify-center text-center text-neutral-900">
            {hasExpandableParents && !hideTopExpandButton ? (
              <HoverTooltipButton
                className="nodrag nopan absolute -top-6 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full border border-neutral-300 bg-white px-1.5 text-[9px] leading-4 text-neutral-700 shadow-sm"
                tooltipText={
                  tooltipReferenceCount > 0
                    ? `${parentsExpanded ? "collapse" : "expand"} ${String(tooltipReferenceCount)} entity reference${tooltipReferenceCount === 1 ? "" : "s"} to this model`
                    : `${parentsExpanded ? "collapse" : "expand"} parent`
                }
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleAbove(displayId);
                }}
              >
                {parentsExpanded ? (
                  <ChevronUp className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <ChevronsUp className="h-3 w-3" aria-hidden="true" />
                )}
              </HoverTooltipButton>
            ) : null}

            <div
              className={
                isCollapsed
                  ? "relative inline-flex w-full min-w-0 flex-col items-center justify-center gap-1 rounded-full px-3 py-2"
                  : "relative flex w-full flex-col items-center justify-center gap-1"
              }
              style={
                isCollapsed ? { backgroundColor: "transparent" } : undefined
              }
            >
              <ModelNodeTooltipOverlay
                nodeId={displayNode.sourceId}
                isModelNode={isModelNode}
                modelGroupFieldCount={modelGroupFieldCount}
                typeReferenceParentCount={tooltipReferenceCount}
              />
              <span className="pointer-events-none whitespace-normal break-words text-xs font-semibold leading-tight">
                {levelNode.classification === "reference"
                  ? (byId[referencedGroupId]?.name ?? levelNode.name)
                  : levelNode.name}
              </span>
              <code className="pointer-events-none whitespace-normal break-all rounded bg-neutral-100 px-1 py-0.5 text-[9px] text-neutral-700">
                {abbreviateType(levelNode.type)}
              </code>
            </div>

            {hasChildren ? (
              !isFieldNode ? (
                !hideBottomExpandButton ? (
                  <HoverTooltipButton
                    className="nodrag nopan absolute -bottom-6 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full border border-neutral-300 bg-white px-1.5 text-[9px] leading-4 text-neutral-700 shadow-sm"
                    tooltipText={`${isCollapsed ? "expand" : "collapse"} ${String(totalChildCount)} field${totalChildCount === 1 ? "" : "s"}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleChildren(displayId);
                    }}
                  >
                    {isCollapsed ? (
                      <ChevronsDown className="h-3 w-3" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-3 w-3" aria-hidden="true" />
                    )}
                  </HoverTooltipButton>
                ) : null
              ) : null
            ) : null}
          </div>
        ),
      },
      style: {
        background: nodeBackgroundColor,
        borderRadius: getNodeBorderRadius(isGroupLike),
        overflow: "visible",
        boxShadow: selectionDoubleBorderShadow,
        outline: implicitSelectionOutline,
        outlineOffset: implicitSelectionOutline ? "2px" : undefined,
      },
    });
  }

  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const dedupedEdges = new Map<string, Edge>();

  for (const edge of edges) {
    if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) {
      continue;
    }
    if (!dedupedEdges.has(edge.id)) {
      dedupedEdges.set(edge.id, edge);
    }
  }

  const dedupedEdgeList = Array.from(dedupedEdges.values());
  const visibleSelectedNodeIds = new Set<string>(
    Array.from(effectiveSelectedNodeIds).filter((id) => visibleNodeIds.has(id)),
  );
  const selectedSubgraphEdgeIds = new Set<string>(
    dedupedEdgeList
      .filter(
        (edge) =>
          visibleSelectedNodeIds.has(edge.source) &&
          visibleSelectedNodeIds.has(edge.target),
      )
      .map((edge) => edge.id),
  );

  const behindCountEdgeIds = new Set<string>();
  const visibleCountNodeIds = new Set<string>(
    Array.from(countNodeIds).filter((id) => visibleNodeIds.has(id)),
  );
  const firstSelectedVisible =
    firstSelectedNodeId !== null &&
    visibleSelectedNodeIds.has(firstSelectedNodeId)
      ? firstSelectedNodeId
      : null;

  if (firstSelectedVisible) {
    const selectedAdjacency = buildSelectedAdjacency(
      dedupedEdgeList,
      visibleSelectedNodeIds,
    );

    const bfsParentEdgeByNode = new Map<string, string>();
    const bfsChildren = new Map<
      string,
      Array<{ childId: string; edgeId: string }>
    >();
    const connectedFromFirst = new Set<string>([firstSelectedVisible]);
    const queue: Array<string> = [firstSelectedVisible];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        break;
      }
      for (const adjacent of selectedAdjacency.get(current) ?? []) {
        if (connectedFromFirst.has(adjacent.neighborId)) {
          continue;
        }
        connectedFromFirst.add(adjacent.neighborId);
        bfsParentEdgeByNode.set(adjacent.neighborId, adjacent.edgeId);
        const existingChildren = bfsChildren.get(current) ?? [];
        existingChildren.push({
          childId: adjacent.neighborId,
          edgeId: adjacent.edgeId,
        });
        bfsChildren.set(current, existingChildren);
        queue.push(adjacent.neighborId);
      }
    }

    for (const countNodeId of visibleCountNodeIds) {
      if (!connectedFromFirst.has(countNodeId)) {
        continue;
      }
      const incomingEdgeId = bfsParentEdgeByNode.get(countNodeId);
      if (incomingEdgeId) {
        behindCountEdgeIds.add(incomingEdgeId);
      }

      const stack = [...(bfsChildren.get(countNodeId) ?? [])];
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
          continue;
        }
        behindCountEdgeIds.add(current.edgeId);
        for (const childId of bfsChildren.get(current.childId) ?? []) {
          stack.push(childId);
        }
      }
    }
  }

  const styledEdges: Array<Edge> = dedupedEdgeList.map((edge): Edge => {
    const isSelectedSubgraphEdge = selectedSubgraphEdgeIds.has(edge.id);
    const isBehindCountEdge = behindCountEdgeIds.has(edge.id);
    const strokeColor = isBehindCountEdge
      ? COUNT_HIGHLIGHT_GREEN
      : isSelectedSubgraphEdge
        ? SELECTED_EDGE_COLOR
        : DEFAULT_EDGE_COLOR;

    return {
      ...edge,
      style: {
        ...(edge.style ?? {}),
        stroke: strokeColor,
        strokeWidth: isSelectedSubgraphEdge ? 2.2 : 1.5,
      },
    };
  });

  return { nodes, edges: styledEdges };
}

function App() {
  const initialUrlState = useMemo(
    () => parseUrlSelectionState(window.location.search),
    [],
  );
  const hasInitialUrlCurrentSelectionState = useMemo(
    () => hasUrlSelectionState(window.location.search),
    [],
  );
  const [xmlContent, setXmlContent] = useState<string | null>(null);
  const [xmlSourceLabel, setXmlSourceLabel] = useState(
    "public/releven_expanded_20251216.xml",
  );
  const [xmlUrlInput, setXmlUrlInput] = useState("");
  const [isLoadingFromUrl, setIsLoadingFromUrl] = useState(false);
  const [xmlLoadError, setXmlLoadError] = useState<string | null>(null);
  const applyLoadedGraph = (
    xmlText: string,
    sourceLabel: string,
    options?: { preserveCurrentViewState?: boolean },
  ): void => {
    setXmlContent(xmlText);
    setXmlSourceLabel(sourceLabel);
    setXmlLoadError(null);
    if (!options?.preserveCurrentViewState) {
      setActiveGroupId("");
      setExpandedChildNodeIds(new Set());
      setExpandedAboveNodeIds(new Set());
      setSelection({ first: null, selected: new Set() });
      setCountSelectedNodeIds(new Set());
    }
    setGeneratedSparql("");
  };
  const { graph, graphParseError } = useMemo(() => {
    if (!xmlContent) {
      return { graph: EMPTY_GRAPH, graphParseError: null as string | null };
    }

    try {
      return {
        graph: parseGraphXml(xmlContent),
        graphParseError: null as string | null,
      };
    } catch (error) {
      return {
        graph: EMPTY_GRAPH,
        graphParseError:
          error instanceof Error ? error.message : "Failed to parse XML file.",
      };
    }
  }, [xmlContent]);

  useEffect(() => {
    let cancelled = false;

    async function loadDefaultGraph(): Promise<void> {
      try {
        const text = await loadDefaultGraphXml("releven_expanded_20251216.xml");
        if (cancelled) {
          return;
        }
        applyLoadedGraph(text, "public/releven_expanded_20251216.xml", {
          preserveCurrentViewState: hasInitialUrlCurrentSelectionState,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        setXmlLoadError(
          error instanceof Error
            ? error.message
            : "Failed to load releven_expanded_20251216.xml.",
        );
      }
    }

    void loadDefaultGraph();
    return () => {
      cancelled = true;
    };
  }, [hasInitialUrlCurrentSelectionState]);
  const groupReferenceCounts = useMemo(
    () => buildGroupReferenceCounts(graph.byId),
    [graph.byId],
  );
  const referencedGroupColors = useMemo(
    () => buildReferencedGroupColors(groupReferenceCounts),
    [groupReferenceCounts],
  );
  const sortedGroups = useMemo(
    () =>
      [...graph.groups].sort((a, b) => {
        const aCount = groupReferenceCounts[a.id] ?? 0;
        const bCount = groupReferenceCounts[b.id] ?? 0;
        return bCount - aCount || a.name.localeCompare(b.name);
      }),
    [graph.groups, groupReferenceCounts],
  );
  const [activeGroupId, setActiveGroupId] = useState<string>(
    () => initialUrlState.groupId,
  );
  const [expandedChildNodeIds, setExpandedChildNodeIds] = useState<Set<string>>(
    () => new Set(initialUrlState.expandedChildNodeIds),
  );
  const [expandedAboveNodeIds, setExpandedAboveNodeIds] = useState<Set<string>>(
    () => new Set(initialUrlState.expandedAboveNodeIds),
  );
  const [selectedNodeEntries, setSelectedNodeEntries] = useState<
    Array<NodeSelectionEntry>
  >(() =>
    buildNodeSelectionEntries({
      selectedNodeIds: initialUrlState.selectedNodeIds,
      countNodeIds: initialUrlState.countNodeIds,
      firstSelectedNodeId: initialUrlState.firstSelectedNodeId,
    }),
  );
  const selection = useMemo(
    () => deriveSelectionState(selectedNodeEntries),
    [selectedNodeEntries],
  );
  const countSelectedNodeIds = useMemo(
    () =>
      new Set(
        selectedNodeEntries
          .filter((entry) => entry.isCount)
          .map((entry) => entry.id),
      ),
    [selectedNodeEntries],
  );
  const setSelection = (
    updater:
      | DerivedSelectionState
      | ((prev: DerivedSelectionState) => DerivedSelectionState),
  ): void => {
    setSelectedNodeEntries((prevEntries) => {
      const previousSelection = deriveSelectionState(prevEntries);
      const nextSelection =
        typeof updater === "function" ? updater(previousSelection) : updater;
      const nextEntries = mergeSelectionStateWithPreviousEntries(
        prevEntries,
        nextSelection,
      );
      return sameNodeSelectionEntries(nextEntries, prevEntries)
        ? prevEntries
        : nextEntries;
    });
  };
  const setCountSelectedNodeIds = (
    updater: Set<string> | ((prev: Set<string>) => Set<string>),
  ): void => {
    setSelectedNodeEntries((prevEntries) => {
      const previousCount = new Set(
        prevEntries.filter((entry) => entry.isCount).map((entry) => entry.id),
      );
      const nextCount =
        typeof updater === "function" ? updater(previousCount) : updater;
      const nextEntries = prevEntries.map((entry) => ({
        ...entry,
        isCount: nextCount.has(entry.id),
      }));
      return sameNodeSelectionEntries(nextEntries, prevEntries)
        ? prevEntries
        : nextEntries;
    });
  };
  const [generatedSparql, setGeneratedSparql] = useState<string>("");
  const [queryText, setQueryText] = useState<string>("");
  const [includeZeroCountResults, setIncludeZeroCountResults] = useState(
    () => initialUrlState.includeZeroCountResults,
  );
  const [includeFullPrefixConstraints, setIncludeFullPrefixConstraints] =
    useState(() => initialUrlState.includeFullPrefixConstraints);
  const [makeAllFieldsOptional, setMakeAllFieldsOptional] = useState(
    () => initialUrlState.makeAllFieldsOptional,
  );
  const [makeAllEntityReferencesOptional, setMakeAllEntityReferencesOptional] =
    useState(() => initialUrlState.makeAllEntityReferencesOptional);
  const [disregardTypesOfNonRootNodes, setDisregardTypesOfNonRootNodes] =
    useState(() => initialUrlState.disregardTypesOfNonRootNodes);
  const [omitClassConstraints, setOmitClassConstraints] = useState(
    () => initialUrlState.omitClassConstraints,
  );
  const [namedGraphInput, setNamedGraphInput] = useState(
    () => initialUrlState.namedGraphInput,
  );
  const [selectedOrderByVariable, setSelectedOrderByVariable] =
    useState<string>(() => initialUrlState.orderByVariable);
  const [selectedOrderByDirection, setSelectedOrderByDirection] = useState<
    "ASC" | "DESC"
  >(() => initialUrlState.orderByDirection);
  const [queryLimit, setQueryLimit] = useState<number>(
    () => initialUrlState.queryLimit,
  );
  useEffect(() => {
    if (!makeAllEntityReferencesOptional && makeAllFieldsOptional) {
      setMakeAllFieldsOptional(false);
    }
  }, [makeAllEntityReferencesOptional, makeAllFieldsOptional]);
  const [savedSelectionTabs, setSavedSelectionTabs] = useState<
    Array<SavedSelectionTab>
  >(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_SELECTIONS_STORAGE_KEY);
      return parseSavedSelectionTabsFromStorage(raw);
    } catch {
      return [];
    }
  });
  const [activeQueryTabId, setActiveQueryTabId] =
    useState<string>(CURRENT_QUERY_TAB_ID);
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const flowViewportRef = useRef<HTMLDivElement | null>(null);
  const latestNodeYByIdRef = useRef<Map<string, number>>(new Map());
  const shouldFitAfterQueryTabRestoreRef = useRef(false);
  const fitTargetNodeIdsRef = useRef<Array<string> | null>(null);
  const [pendingRevealRowY, setPendingRevealRowY] = useState<number | null>(
    null,
  );
  const [currentSelectionDraft, setCurrentSelectionDraft] =
    useState<CurrentSelectionDraft>(() => {
      if (hasInitialUrlCurrentSelectionState) {
        return {
          sourceLabel: xmlSourceLabel,
          groupId: activeGroupId,
          selectedNodeIds: Array.from(selection.selected),
          countNodeIds: Array.from(countSelectedNodeIds),
          firstSelectedNodeId: selection.first,
          expandedChildNodeIds: Array.from(expandedChildNodeIds),
          expandedAboveNodeIds: Array.from(expandedAboveNodeIds),
          includeZeroCountResults,
          includeFullPrefixConstraints,
          makeAllFieldsOptional,
          makeAllEntityReferencesOptional,
          disregardTypesOfNonRootNodes,
          omitClassConstraints,
          namedGraphInput,
          orderByDirection: selectedOrderByDirection,
          queryLimit,
          query: generatedSparql,
        };
      }

      try {
        const raw = window.localStorage.getItem(
          CURRENT_SELECTION_DRAFTS_STORAGE_KEY,
        );
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<
            Record<string, CurrentSelectionDraft>
          >;
          const stored = parsed[xmlSourceLabel];
          if (
            stored !== undefined &&
            typeof stored.sourceLabel === "string" &&
            typeof stored.groupId === "string" &&
            Array.isArray(stored.selectedNodeIds) &&
            Array.isArray(stored.expandedChildNodeIds) &&
            Array.isArray(stored.expandedAboveNodeIds) &&
            typeof stored.query === "string"
          ) {
            return sanitizeCurrentSelectionDraft(stored);
          }
        }
      } catch {
        // Ignore browser storage errors.
      }

      return {
        sourceLabel: xmlSourceLabel,
        groupId: activeGroupId,
        selectedNodeIds: Array.from(selection.selected),
        countNodeIds: Array.from(countSelectedNodeIds),
        firstSelectedNodeId: selection.first,
        expandedChildNodeIds: Array.from(expandedChildNodeIds),
        expandedAboveNodeIds: Array.from(expandedAboveNodeIds),
        includeZeroCountResults,
        includeFullPrefixConstraints,
        makeAllFieldsOptional,
        makeAllEntityReferencesOptional,
        disregardTypesOfNonRootNodes,
        omitClassConstraints,
        namedGraphInput,
        orderByDirection: selectedOrderByDirection,
        queryLimit,
        query: generatedSparql,
      };
    });

  useEffect(() => {
    window.localStorage.setItem(
      SAVED_SELECTIONS_STORAGE_KEY,
      JSON.stringify(savedSelectionTabs),
    );
  }, [savedSelectionTabs]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(
        CURRENT_SELECTION_DRAFTS_STORAGE_KEY,
      );
      const parsed = raw
        ? (JSON.parse(raw) as Record<string, CurrentSelectionDraft>)
        : {};
      parsed[xmlSourceLabel] = currentSelectionDraft;
      window.localStorage.setItem(
        CURRENT_SELECTION_DRAFTS_STORAGE_KEY,
        JSON.stringify(parsed),
      );
    } catch {
      // Ignore browser storage errors.
    }
  }, [currentSelectionDraft, xmlSourceLabel]);

  const visibleSavedTabs = useMemo(
    () =>
      savedSelectionTabs.filter((tab) => tab.sourceLabel === xmlSourceLabel),
    [savedSelectionTabs, xmlSourceLabel],
  );
  const activeSavedTab = useMemo(
    () => visibleSavedTabs.find((tab) => tab.id === activeQueryTabId) ?? null,
    [activeQueryTabId, visibleSavedTabs],
  );
  const hasUnsavedChangesForActiveSavedTab = useMemo(() => {
    if (!activeSavedTab) {
      return false;
    }

    return !(
      activeSavedTab.groupId === activeGroupId &&
      activeSavedTab.firstSelectedNodeId === selection.first &&
      sameList(
        normalizeList(activeSavedTab.selectedNodeIds),
        normalizeList(Array.from(selection.selected)),
      ) &&
      sameList(
        normalizeList(activeSavedTab.countNodeIds),
        normalizeList(Array.from(countSelectedNodeIds)),
      ) &&
      sameList(
        normalizeList(activeSavedTab.expandedChildNodeIds),
        normalizeList(Array.from(expandedChildNodeIds)),
      ) &&
      sameList(
        normalizeList(activeSavedTab.expandedAboveNodeIds),
        normalizeList(Array.from(expandedAboveNodeIds)),
      ) &&
      activeSavedTab.includeZeroCountResults === includeZeroCountResults &&
      activeSavedTab.includeFullPrefixConstraints ===
        includeFullPrefixConstraints &&
      activeSavedTab.makeAllFieldsOptional === makeAllFieldsOptional &&
      activeSavedTab.makeAllEntityReferencesOptional ===
        makeAllEntityReferencesOptional &&
      activeSavedTab.disregardTypesOfNonRootNodes === disregardTypesOfNonRootNodes &&
      activeSavedTab.omitClassConstraints === omitClassConstraints &&
      activeSavedTab.namedGraphInput === namedGraphInput &&
      activeSavedTab.orderByDirection === selectedOrderByDirection &&
      activeSavedTab.queryLimit === queryLimit
    );
  }, [
    activeGroupId,
    activeSavedTab,
    expandedAboveNodeIds,
    expandedChildNodeIds,
    includeFullPrefixConstraints,
    includeZeroCountResults,
    makeAllEntityReferencesOptional,
    makeAllFieldsOptional,
    disregardTypesOfNonRootNodes,
    omitClassConstraints,
    countSelectedNodeIds,
    namedGraphInput,
    queryLimit,
    selectedOrderByDirection,
    selection.first,
    selection.selected,
  ]);

  useEffect(() => {
    if (activeQueryTabId === CURRENT_QUERY_TAB_ID || !activeSavedTab) {
      return;
    }

    try {
      const raw = window.localStorage.getItem(
        LAST_ACTIVE_SAVED_TAB_STORAGE_KEY,
      );
      const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      parsed[xmlSourceLabel] = activeQueryTabId;
      window.localStorage.setItem(
        LAST_ACTIVE_SAVED_TAB_STORAGE_KEY,
        JSON.stringify(parsed),
      );
    } catch {
      // Ignore browser storage errors.
    }
  }, [activeQueryTabId, activeSavedTab, xmlSourceLabel]);

  useEffect(() => {
    if (activeQueryTabId !== CURRENT_QUERY_TAB_ID) {
      if (visibleSavedTabs.some((tab) => tab.id === activeQueryTabId)) {
        return;
      }
      setActiveQueryTabId(CURRENT_QUERY_TAB_ID);
    }
  }, [activeQueryTabId, visibleSavedTabs]);
  const displayedSelectedCount = selection.selected.size;
  const isCurrentQueryTab = activeQueryTabId === CURRENT_QUERY_TAB_ID;

  const buildSelectionSnapshot = () => ({
    sourceLabel: xmlSourceLabel,
    groupId: activeGroupId,
    selectedNodeIds: Array.from(selection.selected),
    countNodeIds: Array.from(countSelectedNodeIds),
    firstSelectedNodeId: selection.first,
    expandedChildNodeIds: Array.from(expandedChildNodeIds),
    expandedAboveNodeIds: Array.from(expandedAboveNodeIds),
    includeZeroCountResults,
    includeFullPrefixConstraints,
    makeAllFieldsOptional,
    makeAllEntityReferencesOptional,
    disregardTypesOfNonRootNodes,
    omitClassConstraints,
    namedGraphInput,
    orderByDirection: selectedOrderByDirection,
    queryLimit,
    query: generatedSparql,
  });

  const saveSelectionAsNewTab = () => {
    const labelInput = window
      .prompt("Enter a label for this selection:")
      ?.trim();
    if (!labelInput) {
      return;
    }

    const snapshot = buildSelectionSnapshot();
    const nextTab: SavedSelectionTab = {
      id: `saved_${String(Date.now())}_${Math.random().toString(36).slice(2, 8)}`,
      label: labelInput,
      ...snapshot,
    };

    setSavedSelectionTabs((prev) => [...prev, nextTab]);
    setActiveQueryTabId(nextTab.id);
    setCurrentSelectionDraft({
      sourceLabel: xmlSourceLabel,
      groupId: activeGroupId,
      selectedNodeIds: [],
      countNodeIds: [],
      firstSelectedNodeId: null,
      expandedChildNodeIds: Array.from(expandedChildNodeIds),
      expandedAboveNodeIds: Array.from(expandedAboveNodeIds),
      includeZeroCountResults,
      includeFullPrefixConstraints,
      makeAllFieldsOptional,
      makeAllEntityReferencesOptional,
      disregardTypesOfNonRootNodes,
      omitClassConstraints,
      namedGraphInput,
      orderByDirection: selectedOrderByDirection,
      queryLimit,
      query: "",
    });
  };

  const updateActiveSavedSelection = () => {
    if (!activeSavedTab) {
      return;
    }
    const snapshot = buildSelectionSnapshot();
    setSavedSelectionTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeSavedTab.id
          ? {
              ...tab,
              ...snapshot,
            }
          : tab,
      ),
    );
  };

  const discardActiveSavedSelectionChanges = () => {
    if (!activeSavedTab) {
      return;
    }
    setActiveGroupId(activeSavedTab.groupId);
    setExpandedChildNodeIds(new Set(activeSavedTab.expandedChildNodeIds));
    setExpandedAboveNodeIds(new Set(activeSavedTab.expandedAboveNodeIds));
    setSelection({
      first: activeSavedTab.firstSelectedNodeId,
      selected: new Set(activeSavedTab.selectedNodeIds),
    });
    setCountSelectedNodeIds(new Set(activeSavedTab.countNodeIds));
    setIncludeZeroCountResults(activeSavedTab.includeZeroCountResults);
    setIncludeFullPrefixConstraints(
      activeSavedTab.includeFullPrefixConstraints,
    );
    setMakeAllFieldsOptional(activeSavedTab.makeAllFieldsOptional);
    setMakeAllEntityReferencesOptional(
      activeSavedTab.makeAllEntityReferencesOptional,
    );
    setDisregardTypesOfNonRootNodes(activeSavedTab.disregardTypesOfNonRootNodes);
    setOmitClassConstraints(activeSavedTab.omitClassConstraints);
    setNamedGraphInput(activeSavedTab.namedGraphInput);
    setSelectedOrderByDirection(activeSavedTab.orderByDirection);
    setQueryLimit(activeSavedTab.queryLimit);
  };

  const scheduleGraphFit = (visibleNodeIds: Array<string>) => {
    const instance = reactFlowInstanceRef.current;
    if (!instance) {
      return;
    }
    const fitTargetIds = fitTargetNodeIdsRef.current;
    const selectedVisibleIds =
      fitTargetIds && fitTargetIds.length > 0
        ? fitTargetIds.filter((id) => visibleNodeIds.includes(id))
        : [];
    void window.requestAnimationFrame(() => {
      void window.requestAnimationFrame(() => {
        if (selectedVisibleIds.length > 0) {
          void instance.fitView({
            padding: 0.15,
            nodes: selectedVisibleIds.map((id) => ({ id })),
          });
          return;
        }
        void instance.fitView({ padding: 0.15 });
      });
    });
  };

  useEffect(() => {
    if (activeQueryTabId !== CURRENT_QUERY_TAB_ID) {
      return;
    }

    setCurrentSelectionDraft({
      sourceLabel: xmlSourceLabel,
      groupId: activeGroupId,
      selectedNodeIds: Array.from(selection.selected),
      countNodeIds: Array.from(countSelectedNodeIds),
      firstSelectedNodeId: selection.first,
      expandedChildNodeIds: Array.from(expandedChildNodeIds),
      expandedAboveNodeIds: Array.from(expandedAboveNodeIds),
      includeZeroCountResults,
      includeFullPrefixConstraints,
      makeAllFieldsOptional,
      makeAllEntityReferencesOptional,
      disregardTypesOfNonRootNodes,
      omitClassConstraints,
      namedGraphInput,
      orderByDirection: selectedOrderByDirection,
      queryLimit,
      query: generatedSparql,
    });
  }, [
    activeGroupId,
    activeQueryTabId,
    expandedAboveNodeIds,
    expandedChildNodeIds,
    includeFullPrefixConstraints,
    includeZeroCountResults,
    makeAllEntityReferencesOptional,
    makeAllFieldsOptional,
    disregardTypesOfNonRootNodes,
    omitClassConstraints,
    countSelectedNodeIds,
    generatedSparql,
    namedGraphInput,
    queryLimit,
    selectedOrderByDirection,
    selection.first,
    selection.selected,
    xmlSourceLabel,
  ]);

  useEffect(() => {
    if (graph.groups.length === 0) {
      setActiveGroupId("");
      return;
    }

    setActiveGroupId((previous) => {
      if (
        previous &&
        Object.prototype.hasOwnProperty.call(graph.byId, previous)
      ) {
        return previous;
      }

      const groupFromUrl = initialUrlState.groupId.trim();
      if (
        groupFromUrl.length > 0 &&
        Object.prototype.hasOwnProperty.call(graph.byId, groupFromUrl)
      ) {
        return groupFromUrl;
      }

      return previous ?? "";
    });
  }, [graph.byId, graph.groups, initialUrlState.groupId]);

  const activeGroup = graph.groups.find((entry) => entry.id === activeGroupId);

  const flow = useMemo(
    () =>
      activeGroup
        ? buildFlowForGroup({
            group: activeGroup,
            byId: graph.byId,
            childrenByParentId: graph.childrenByParentId,
            referencedGroupColors,
            expandedChildNodeIds,
            expandedAboveNodeIds,
            selectedNodeIds: selection.selected,
            countNodeIds: countSelectedNodeIds,
            firstSelectedNodeId: selection.first,
            onToggleChildren: (nodeId) => {
              setExpandedChildNodeIds((prev) => {
                const next = new Set(prev);
                if (next.has(nodeId)) {
                  next.delete(nodeId);
                } else {
                  next.add(nodeId);
                  const baseY = latestNodeYByIdRef.current.get(nodeId);
                  if (baseY !== undefined) {
                    setPendingRevealRowY(baseY + FLOW_VERTICAL_GAP);
                  }
                }
                return next;
              });
            },
            onToggleAbove: (nodeId) => {
              setExpandedAboveNodeIds((prev) => {
                const next = new Set(prev);
                if (next.has(nodeId)) {
                  next.delete(nodeId);
                } else {
                  next.add(nodeId);
                  const baseY = latestNodeYByIdRef.current.get(nodeId);
                  if (baseY !== undefined) {
                    setPendingRevealRowY(baseY - FLOW_VERTICAL_GAP);
                  }
                }
                return next;
              });
            },
          })
        : null,
    [
      activeGroup,
      expandedAboveNodeIds,
      expandedChildNodeIds,
      graph.byId,
      graph.childrenByParentId,
      referencedGroupColors,
      countSelectedNodeIds,
      selection.first,
      selection.selected,
    ],
  );
  const effectiveSelection = useMemo(
    () =>
      flow
        ? resolveEffectiveSelection({
            firstSelectedNodeId: selection.first,
            explicitSelectedNodeIds: selection.selected,
            edges: flow.edges,
          })
        : { effective: new Set<string>(), implicit: new Set<string>() },
    [flow, selection.first, selection.selected],
  );
  const effectiveSelectedNodeIds = effectiveSelection.effective;
  const countBlockedNodeIds = useMemo<Set<string>>(() => {
    if (!flow || !selection.first || effectiveSelectedNodeIds.size === 0) {
      return new Set<string>();
    }
    if (
      !effectiveSelectedNodeIds.has(selection.first) ||
      countSelectedNodeIds.size === 0
    ) {
      return new Set<string>();
    }

    const selectedAdjacency = buildSelectedAdjacency(
      flow.edges,
      effectiveSelectedNodeIds,
    );
    const connectedFromFirst = new Set<string>([selection.first]);
    const bfsChildren = new Map<string, Array<string>>();
    const queue: Array<string> = [selection.first];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        break;
      }
      for (const adjacent of selectedAdjacency.get(current) ?? []) {
        if (connectedFromFirst.has(adjacent.neighborId)) {
          continue;
        }
        connectedFromFirst.add(adjacent.neighborId);
        const children = bfsChildren.get(current) ?? [];
        children.push(adjacent.neighborId);
        bfsChildren.set(current, children);
        queue.push(adjacent.neighborId);
      }
    }

    const blocked = new Set<string>();
    for (const countNodeId of countSelectedNodeIds) {
      if (!connectedFromFirst.has(countNodeId)) {
        continue;
      }
      const stack = [...(bfsChildren.get(countNodeId) ?? [])];
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current || blocked.has(current)) {
          continue;
        }
        blocked.add(current);
        for (const childId of bfsChildren.get(current) ?? []) {
          stack.push(childId);
        }
      }
    }

    return blocked;
  }, [countSelectedNodeIds, effectiveSelectedNodeIds, flow, selection.first]);
  const selectedGraphNodes = useMemo<Array<SparqlSelectedNode>>(() => {
    if (!flow) {
      return [];
    }

    const byDisplayId = new Map(
      flow.nodes.map((node) => [
        node.id,
        (
          (node.data as { sourcePathId?: string } | undefined)?.sourcePathId ??
          node.id
        ).trim(),
      ]),
    );

    const orderedSelected = Array.from(effectiveSelectedNodeIds).sort();
    const nodes: Array<SparqlSelectedNode> = [];

    for (const selectedDisplayId of orderedSelected) {
      const sourcePathId = byDisplayId.get(selectedDisplayId);
      if (!sourcePathId) {
        continue;
      }
      nodes.push({
        displayId: selectedDisplayId,
        sourcePathId,
        path: graph.byId[sourcePathId],
      });
    }

    return nodes;
  }, [effectiveSelectedNodeIds, flow, graph.byId]);
  const selectedGraphEdges = useMemo<Array<SparqlSelectedEdge>>(() => {
    if (!flow || effectiveSelectedNodeIds.size === 0) {
      return [];
    }

    const selected = effectiveSelectedNodeIds;
    const byDisplayId = new Map(
      flow.nodes.map((node) => [
        node.id,
        (
          (node.data as { sourcePathId?: string } | undefined)?.sourcePathId ??
          node.id
        ).trim(),
      ]),
    );
    const getBridgePredicateIri = (referencePathId: string): string | null => {
      const referencePath = graph.byId[referencePathId];
      const raw = referencePath.fields.path_array;
      if (!Array.isArray(raw)) {
        return null;
      }

      const predicates = raw
        .filter(
          (value, index): value is string =>
            index % 2 === 1 &&
            typeof value === "string" &&
            value.trim().length > 0,
        )
        .map((value) => value.trim());

      return predicates[predicates.length - 1] ?? null;
    };

    return flow.edges
      .filter((edge) => selected.has(edge.source) && selected.has(edge.target))
      .map((edge) => {
        const targetPathId = byDisplayId.get(edge.target) ?? "";
        const targetPath = graph.byId[targetPathId];
        const isEntityReferenceBoundary =
          targetPath.classification === "reference";
        const viaReferenceSourcePathId = readFieldString(
          (edge.data as { viaReferenceSourcePathId?: string } | undefined)
            ?.viaReferenceSourcePathId,
        );
        const bridgePredicateIri = viaReferenceSourcePathId
          ? getBridgePredicateIri(viaReferenceSourcePathId)
          : null;

        return {
          sourceDisplayId: edge.source,
          targetDisplayId: edge.target,
          bridgePredicateIri: bridgePredicateIri ?? undefined,
          isEntityReferenceBoundary,
        };
      });
  }, [effectiveSelectedNodeIds, flow, graph.byId]);
  const orderByVariableOptions = useMemo<
    Array<{ value: string; label: string }>
  >(() => {
    const query = generatedSparql.trim();
    if (query.length === 0) {
      return [];
    }
    const lines = query.split("\n");
    const selectIndex = lines.findIndex(
      (line) => line.trim().toUpperCase() === "SELECT DISTINCT",
    );
    if (selectIndex < 0) {
      return [];
    }
    const whereIndex = lines.findIndex(
      (line, index) =>
        index > selectIndex && line.trim().toUpperCase() === "WHERE {",
    );
    if (whereIndex < 0) {
      return [];
    }
    const variables: Array<string> = [];
    const seen = new Set<string>();
    for (let index = selectIndex + 1; index < whereIndex; index += 1) {
      const line = lines[index].trim();
      if (!line) {
        continue;
      }
      const matches = Array.from(line.matchAll(/\?([a-z_]\w*)/gi));
      if (matches.length === 0) {
        continue;
      }
      const variableName = matches[matches.length - 1][1];
      if (seen.has(variableName)) {
        continue;
      }
      seen.add(variableName);
      variables.push(variableName);
    }
    return variables.map((variableName) => ({
      value: variableName,
      label: `?${variableName}`,
    }));
  }, [generatedSparql]);
  useEffect(() => {
    if (orderByVariableOptions.length === 0) {
      return;
    }
    if (
      selectedOrderByVariable !== "" &&
      orderByVariableOptions.some(
        (option) => option.value === selectedOrderByVariable,
      )
    ) {
      return;
    }
    setSelectedOrderByVariable(orderByVariableOptions[0].value);
  }, [orderByVariableOptions, selectedOrderByVariable]);
  const isFirstSelectedNodeModel = useMemo(() => {
    if (!flow || !selection.first) {
      return false;
    }
    const displayNode = flow.nodes.find((node) => node.id === selection.first);
    if (!displayNode) {
      return false;
    }
    const sourcePathId = (
      (displayNode.data as { sourcePathId?: string } | undefined)
        ?.sourcePathId ?? selection.first
    ).trim();
    const path = graph.byId[sourcePathId];
    return path.classification === "model";
  }, [flow, graph.byId, selection.first]);
  const disableIncludeZeroCountResults = countSelectedNodeIds.size === 0;
  const disableIncludeFullPrefixConstraints =
    effectiveSelectedNodeIds.size === 0 || isFirstSelectedNodeModel;

  useEffect(() => {
    if (effectiveSelectedNodeIds.size === 0) {
      setGeneratedSparql("");
      return;
    }

    setGeneratedSparql(
      generateSparqlQuery({
        firstSelectedDisplayNodeId: selection.first,
        selectedNodes: selectedGraphNodes,
        selectedEdges: selectedGraphEdges,
        projectedNodeDisplayIds: Array.from(selection.selected),
        countNodeDisplayIds: Array.from(countSelectedNodeIds),
        includeZeroCountResults:
          includeZeroCountResults && !disableIncludeZeroCountResults,
        includeFullPrefixConstraintsWhenCentralNotTopModel:
          includeFullPrefixConstraints && !disableIncludeFullPrefixConstraints,
        makeAllFieldsOptional,
        makeAllEntityReferencesOptional,
        disregardTypesOfNonRootNodes,
        omitClassConstraints,
        namedGraphInput,
        queryLimit,
        orderByVariableName: selectedOrderByVariable || undefined,
        orderByDirection: selectedOrderByDirection,
      }),
    );
  }, [
    countSelectedNodeIds,
    disableIncludeFullPrefixConstraints,
    disableIncludeZeroCountResults,
    includeFullPrefixConstraints,
    includeZeroCountResults,
    makeAllEntityReferencesOptional,
    makeAllFieldsOptional,
    disregardTypesOfNonRootNodes,
    omitClassConstraints,
    namedGraphInput,
    queryLimit,
    selectedOrderByDirection,
    selectedOrderByVariable,
    selection.first,
    effectiveSelectedNodeIds,
    selectedGraphEdges,
    selectedGraphNodes,
  ]);

  useEffect(() => {
    setQueryText(generatedSparql);
  }, [generatedSparql]);

  useEffect(() => {
    if (!flow) {
      latestNodeYByIdRef.current = new Map();
      return;
    }
    latestNodeYByIdRef.current = new Map(
      flow.nodes.map((node) => [node.id, node.position.y]),
    );
  }, [flow]);

  useEffect(() => {
    if (!flow || pendingRevealRowY === null) {
      return;
    }
    const instance = reactFlowInstanceRef.current;
    const viewportElement = flowViewportRef.current;
    if (!instance || !viewportElement) {
      return;
    }
    const viewport = instance.getViewport();
    const zoom = viewport.zoom <= 0 ? 1 : viewport.zoom;
    const visibleFlowWidth = viewportElement.clientWidth / zoom;
    const visibleFlowHeight = viewportElement.clientHeight / zoom;
    const visibleMinX = -viewport.x / zoom;
    const visibleMaxX = visibleMinX + visibleFlowWidth;
    const visibleMinY = -viewport.y / zoom;
    const visibleMaxY = visibleMinY + visibleFlowHeight;

    const exactRowNodes = flow.nodes.filter(
      (node) =>
        Math.abs(node.position.y - pendingRevealRowY) < 0.5 &&
        node.position.x >= visibleMinX &&
        node.position.x <= visibleMaxX,
    );
    const rowNodes =
      exactRowNodes.length > 0
        ? exactRowNodes
        : (() => {
            let closestY = pendingRevealRowY;
            let minDistance = Number.POSITIVE_INFINITY;
            for (const node of flow.nodes) {
              if (
                node.position.x < visibleMinX ||
                node.position.x > visibleMaxX
              ) {
                continue;
              }
              const distance = Math.abs(node.position.y - pendingRevealRowY);
              if (distance < minDistance) {
                minDistance = distance;
                closestY = node.position.y;
              }
            }
            if (!Number.isFinite(minDistance)) {
              return [];
            }
            return flow.nodes.filter(
              (node) =>
                Math.abs(node.position.y - closestY) < 0.5 &&
                node.position.x >= visibleMinX &&
                node.position.x <= visibleMaxX,
            );
          })();

    if (rowNodes.length > 0) {
      const rowY = rowNodes[0].position.y;
      const verticalPadding = Math.max(24 / zoom, visibleFlowHeight * 0.12);
      let targetMinY = visibleMinY;
      if (rowY < visibleMinY + verticalPadding) {
        targetMinY = rowY - verticalPadding;
      } else if (rowY > visibleMaxY - verticalPadding) {
        targetMinY = rowY - (visibleFlowHeight - verticalPadding);
      }
      if (Math.abs(targetMinY - visibleMinY) > 0.5) {
        void instance.setViewport(
          {
            x: viewport.x,
            y: -targetMinY * zoom,
            zoom,
          },
          { duration: 220 },
        );
      }
    }
    setPendingRevealRowY(null);
  }, [flow, pendingRevealRowY]);

  useEffect(() => {
    if (!flow) {
      return;
    }

    const visibleNodeIds = new Set(flow.nodes.map((node) => node.id));

    setSelection((prev) => {
      if (prev.selected.size === 0) {
        return prev;
      }

      const filtered = new Set<string>();
      for (const nodeId of prev.selected) {
        if (visibleNodeIds.has(nodeId)) {
          filtered.add(nodeId);
        }
      }

      const sameSize = filtered.size === prev.selected.size;
      if (sameSize) {
        return prev;
      }

      if (!prev.first || !filtered.has(prev.first)) {
        return { first: null, selected: new Set() };
      }
      return { first: prev.first, selected: filtered };
    });
    setCountSelectedNodeIds((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      const filtered = new Set<string>();
      for (const nodeId of prev) {
        if (visibleNodeIds.has(nodeId)) {
          filtered.add(nodeId);
        }
      }
      return filtered.size === prev.size ? prev : filtered;
    });
  }, [flow]);

  useEffect(() => {
    if (selection.selected.size > 0 || countSelectedNodeIds.size === 0) {
      return;
    }
    setCountSelectedNodeIds(new Set());
  }, [countSelectedNodeIds.size, selection.selected.size]);

  useEffect(() => {
    if (!flow || countSelectedNodeIds.size === 0) {
      return;
    }
    const reachable = getReachableSelectedFromFirst(
      selection.first,
      effectiveSelectedNodeIds,
      flow.edges,
    );
    setCountSelectedNodeIds((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      const filtered = new Set<string>();
      for (const nodeId of prev) {
        if (reachable.has(nodeId)) {
          filtered.add(nodeId);
        }
      }
      return filtered.size === prev.size ? prev : filtered;
    });
  }, [
    countSelectedNodeIds.size,
    effectiveSelectedNodeIds,
    flow,
    selection.first,
  ]);

  useEffect(() => {
    if (countBlockedNodeIds.size === 0) {
      return;
    }
    setCountSelectedNodeIds((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      const filtered = new Set<string>();
      for (const nodeId of prev) {
        if (!countBlockedNodeIds.has(nodeId)) {
          filtered.add(nodeId);
        }
      }
      return filtered.size === prev.size ? prev : filtered;
    });
  }, [countBlockedNodeIds]);

  useEffect(() => {
    if (!flow || !shouldFitAfterQueryTabRestoreRef.current) {
      return;
    }
    shouldFitAfterQueryTabRestoreRef.current = false;
    scheduleGraphFit(flow.nodes.map((node) => node.id));
    fitTargetNodeIdsRef.current = null;
  }, [activeQueryTabId, flow]);

  useEffect(() => {
    if (!activeGroupId) {
      return;
    }

    const nextUrl = applyUrlSelectionState(window.location.href, {
      groupId: activeGroupId,
      expandedChildNodeIds: Array.from(expandedChildNodeIds),
      expandedAboveNodeIds: Array.from(expandedAboveNodeIds),
      firstSelectedNodeId: selection.first,
      selectedNodeIds: Array.from(selection.selected),
      countNodeIds: Array.from(countSelectedNodeIds),
      includeZeroCountResults,
      includeFullPrefixConstraints,
      makeAllFieldsOptional,
      makeAllEntityReferencesOptional,
      disregardTypesOfNonRootNodes,
      omitClassConstraints,
      namedGraphInput,
      orderByVariable: selectedOrderByVariable,
      orderByDirection: selectedOrderByDirection,
      queryLimit,
    });

    window.history.replaceState({}, "", nextUrl);
  }, [
    activeGroupId,
    countSelectedNodeIds,
    expandedAboveNodeIds,
    expandedChildNodeIds,
    includeFullPrefixConstraints,
    includeZeroCountResults,
    makeAllEntityReferencesOptional,
    makeAllFieldsOptional,
    disregardTypesOfNonRootNodes,
    omitClassConstraints,
    namedGraphInput,
    queryLimit,
    selectedOrderByDirection,
    selectedOrderByVariable,
    selection.first,
    selection.selected,
  ]);

  const visibleSavedTabViews = visibleSavedTabs.map((tab) => ({
    id: tab.id,
    label: tab.label,
    groupName: graph.byId[tab.groupId]?.name ?? tab.groupId,
    selectedNodeCount: tab.selectedNodeIds.length,
  }));

  const handleUploadXmlFile = async (file: File): Promise<void> => {
    try {
      const text = await readGraphXmlFile(file);
      applyLoadedGraph(text, file.name);
    } catch (error) {
      setXmlLoadError(
        error instanceof Error
          ? error.message
          : "Failed to read uploaded XML file.",
      );
    }
  };

  const handleLoadXmlUrl = async (url: string): Promise<void> => {
    if (url.length === 0) {
      return;
    }

    setIsLoadingFromUrl(true);
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Failed to load URL (${String(response.status)}).`);
      }
      const text = await response.text();
      applyLoadedGraph(text, url);
    } catch (error) {
      setXmlLoadError(
        error instanceof Error ? error.message : "Failed to load XML from URL.",
      );
    } finally {
      setIsLoadingFromUrl(false);
    }
  };

  const handleMakeAllFieldsOptionalChange = (selected: boolean): void => {
    setMakeAllFieldsOptional(selected);
  };
  const handleMakeAllEntityReferencesOptionalChange = (
    selected: boolean,
  ): void => {
    setMakeAllEntityReferencesOptional(selected);
    if (!selected) {
      setMakeAllFieldsOptional(false);
    }
  };

  const handleSelectGroup = (groupId: string): void => {
    shouldFitAfterQueryTabRestoreRef.current = true;
    fitTargetNodeIdsRef.current = null;
    setActiveGroupId(groupId);
    setExpandedChildNodeIds(new Set());
    setExpandedAboveNodeIds(new Set());
    setSelection({ first: null, selected: new Set() });
    setCountSelectedNodeIds(new Set());
    setGeneratedSparql("");
    setActiveQueryTabId(CURRENT_QUERY_TAB_ID);
  };

  const handleFlowNodeClick = (event: React.MouseEvent, node: Node): void => {
    if (!flow) {
      return;
    }
    if (event.shiftKey) {
      const nodeId = node.id;
      if (countBlockedNodeIds.has(node.id)) {
        setSelection((prev) => toggleNodeSelection(prev, node.id, flow.edges));
        return;
      }
      const nodeAlreadySelected = selection.selected.has(nodeId);
      const nodeAlreadyCount = countSelectedNodeIds.has(nodeId);
      const bridgePath = findShortestPathToSelected(
        nodeId,
        effectiveSelectedNodeIds,
        flow.edges,
      );
      const canToggleCount =
        nodeAlreadyCount || nodeAlreadySelected || bridgePath !== null;
      if (!canToggleCount) {
        return;
      }
      setSelection((prev) => {
        if (prev.selected.has(nodeId)) {
          return prev;
        }
        return toggleNodeSelection(prev, nodeId, flow.edges);
      });
      setCountSelectedNodeIds((prev) => {
        const next = new Set(prev);
        if (next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        return next;
      });
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const nodeId = node.id;
    setSelection((prev) => toggleNodeSelection(prev, nodeId, flow.edges));
  };

  const handleQueryTabSelection = (nextTabId: string): void => {
    if (
      activeQueryTabId === CURRENT_QUERY_TAB_ID &&
      nextTabId !== CURRENT_QUERY_TAB_ID
    ) {
      setCurrentSelectionDraft({
        sourceLabel: xmlSourceLabel,
        groupId: activeGroupId,
        selectedNodeIds: Array.from(selection.selected),
        countNodeIds: Array.from(countSelectedNodeIds),
        firstSelectedNodeId: selection.first,
        expandedChildNodeIds: Array.from(expandedChildNodeIds),
        expandedAboveNodeIds: Array.from(expandedAboveNodeIds),
        includeZeroCountResults,
        includeFullPrefixConstraints,
        makeAllFieldsOptional,
        makeAllEntityReferencesOptional,
        disregardTypesOfNonRootNodes,
        omitClassConstraints,
        namedGraphInput,
        orderByDirection: selectedOrderByDirection,
        queryLimit,
        query: generatedSparql,
      });
    }
    setActiveQueryTabId(nextTabId);
    setCountSelectedNodeIds(new Set());
    if (nextTabId === CURRENT_QUERY_TAB_ID) {
      if (currentSelectionDraft.sourceLabel !== xmlSourceLabel) {
        fitTargetNodeIdsRef.current = null;
        setSelection({ first: null, selected: new Set() });
        setExpandedChildNodeIds(new Set());
        setExpandedAboveNodeIds(new Set());
        setIncludeZeroCountResults(true);
        setIncludeFullPrefixConstraints(true);
        setMakeAllFieldsOptional(false);
        setMakeAllEntityReferencesOptional(false);
        setDisregardTypesOfNonRootNodes(false);
        setOmitClassConstraints(false);
        setNamedGraphInput("");
        setSelectedOrderByDirection("DESC");
        setQueryLimit(100);
        setGeneratedSparql("");
        return;
      }

      shouldFitAfterQueryTabRestoreRef.current = true;
      fitTargetNodeIdsRef.current = [...currentSelectionDraft.selectedNodeIds];
      if (currentSelectionDraft.groupId) {
        setActiveGroupId(currentSelectionDraft.groupId);
      }
      setExpandedChildNodeIds(
        new Set(currentSelectionDraft.expandedChildNodeIds),
      );
      setExpandedAboveNodeIds(
        new Set(currentSelectionDraft.expandedAboveNodeIds),
      );
      setSelection({
        first: currentSelectionDraft.firstSelectedNodeId,
        selected: new Set(currentSelectionDraft.selectedNodeIds),
      });
      setCountSelectedNodeIds(new Set(currentSelectionDraft.countNodeIds));
      setIncludeZeroCountResults(currentSelectionDraft.includeZeroCountResults);
      setIncludeFullPrefixConstraints(
        currentSelectionDraft.includeFullPrefixConstraints,
      );
      setMakeAllFieldsOptional(currentSelectionDraft.makeAllFieldsOptional);
      setMakeAllEntityReferencesOptional(
        currentSelectionDraft.makeAllEntityReferencesOptional,
      );
      setDisregardTypesOfNonRootNodes(
        currentSelectionDraft.disregardTypesOfNonRootNodes,
      );
      setOmitClassConstraints(currentSelectionDraft.omitClassConstraints);
      setNamedGraphInput(currentSelectionDraft.namedGraphInput);
      setSelectedOrderByDirection(currentSelectionDraft.orderByDirection);
      setQueryLimit(currentSelectionDraft.queryLimit);
      setGeneratedSparql(currentSelectionDraft.query);
      return;
    }
    const tab = visibleSavedTabs.find((entry) => entry.id === nextTabId);
    if (tab) {
      shouldFitAfterQueryTabRestoreRef.current = true;
      fitTargetNodeIdsRef.current = [...tab.selectedNodeIds];
      setActiveGroupId(tab.groupId);
      setExpandedChildNodeIds(new Set(tab.expandedChildNodeIds));
      setExpandedAboveNodeIds(new Set(tab.expandedAboveNodeIds));
      setSelection({
        first: tab.firstSelectedNodeId,
        selected: new Set(tab.selectedNodeIds),
      });
      setCountSelectedNodeIds(new Set(tab.countNodeIds));
      setIncludeZeroCountResults(tab.includeZeroCountResults);
      setIncludeFullPrefixConstraints(tab.includeFullPrefixConstraints);
      setMakeAllFieldsOptional(tab.makeAllFieldsOptional);
      setMakeAllEntityReferencesOptional(tab.makeAllEntityReferencesOptional);
      setDisregardTypesOfNonRootNodes(tab.disregardTypesOfNonRootNodes);
      setOmitClassConstraints(tab.omitClassConstraints);
      setNamedGraphInput(tab.namedGraphInput);
      setSelectedOrderByDirection(tab.orderByDirection);
      setQueryLimit(tab.queryLimit);
    }
  };

  return (
    <main className="mx-auto w-full max-w-[96rem] p-4 text-neutral-900">
      <div className="flex w-full flex-col gap-4 xl:flex-row">
        <div className="min-w-0 rounded-xl border border-neutral-300 bg-white p-4 shadow-sm xl:flex-1">
          <h1 className="text-3xl font-bold">Releven model explorer</h1>
        </div>
        <div className="min-w-0 rounded-xl border border-neutral-300 bg-white p-4 shadow-sm xl:flex-1">
          <XmlLoaderSection
            xmlUrlInput={xmlUrlInput}
            isLoadingFromUrl={isLoadingFromUrl}
            onXmlUrlInputChange={setXmlUrlInput}
            onUploadFile={handleUploadXmlFile}
            onLoadUrl={handleLoadXmlUrl}
          />
          {xmlLoadError || graphParseError ? (
            <p className="mt-2 text-sm font-medium text-red-700">
              {xmlLoadError ?? graphParseError}
            </p>
          ) : null}
        </div>
      </div>
      <ModelViewer
        graphPathCount={Object.keys(graph.byId).length}
        xmlSourceLabel={xmlSourceLabel}
        sortedGroups={sortedGroups}
        groupReferenceCounts={groupReferenceCounts}
        activeGroupId={activeGroupId}
        onSelectGroup={handleSelectGroup}
        showNoModelMessage={
          graph.groups.length === 0 && !xmlLoadError && !graphParseError
        }
        activeGroup={
          activeGroup
            ? {
                name: activeGroup.name,
                typeLabel: abbreviateType(activeGroup.type),
              }
            : null
        }
        flowViewportRef={flowViewportRef}
        flow={flow}
        onFlowInit={(instance) => {
          reactFlowInstanceRef.current = instance;
        }}
        onFlowNodeClick={handleFlowNodeClick}
        activeQueryTabId={activeQueryTabId}
        currentSelectionCount={currentSelectionDraft.selectedNodeIds.length}
        visibleSavedTabs={visibleSavedTabViews}
        hasUnsavedChangesForActiveSavedTab={hasUnsavedChangesForActiveSavedTab}
        displayedSelectedCount={displayedSelectedCount}
        isCurrentQueryTab={isCurrentQueryTab}
        canSaveOrClearSelection={selection.selected.size > 0}
        canUpdateSelection={hasUnsavedChangesForActiveSavedTab}
        includeZeroCountResults={includeZeroCountResults}
        disableIncludeZeroCountResults={disableIncludeZeroCountResults}
        includeFullPrefixConstraints={includeFullPrefixConstraints}
        disableIncludeFullPrefixConstraints={
          disableIncludeFullPrefixConstraints
        }
        makeAllFieldsOptional={makeAllFieldsOptional}
        makeAllEntityReferencesOptional={makeAllEntityReferencesOptional}
        disregardTypesOfNonRootNodes={disregardTypesOfNonRootNodes}
        onSelectTab={handleQueryTabSelection}
        onDeleteSavedTab={(tabId) => {
          setSavedSelectionTabs((prev) =>
            prev.filter((entry) => entry.id !== tabId),
          );
          if (activeQueryTabId === tabId) {
            setActiveQueryTabId(CURRENT_QUERY_TAB_ID);
          }
        }}
        onSaveSelection={saveSelectionAsNewTab}
        onClearSelection={() => {
          setSelection({ first: null, selected: new Set() });
        }}
        onUpdateSelection={updateActiveSavedSelection}
        onSaveNewSelection={saveSelectionAsNewTab}
        onDiscardChanges={discardActiveSavedSelectionChanges}
        onIncludeZeroCountResultsChange={setIncludeZeroCountResults}
        onIncludeFullPrefixConstraintsChange={setIncludeFullPrefixConstraints}
        onMakeAllFieldsOptionalChange={handleMakeAllFieldsOptionalChange}
        onMakeAllEntityReferencesOptionalChange={
          handleMakeAllEntityReferencesOptionalChange
        }
        onDisregardTypesOfNonRootNodesChange={
          setDisregardTypesOfNonRootNodes
        }
        queryText={queryText}
        onQueryTextChange={setQueryText}
        namedGraphInput={namedGraphInput}
        onNamedGraphInputChange={setNamedGraphInput}
        selectedOrderByVariable={selectedOrderByVariable}
        onSelectedOrderByVariableChange={setSelectedOrderByVariable}
        selectedOrderByDirection={selectedOrderByDirection}
        onSelectedOrderByDirectionChange={setSelectedOrderByDirection}
        queryLimit={queryLimit}
        onQueryLimitChange={setQueryLimit}
        orderByVariableOptions={orderByVariableOptions}
      />

      {!activeGroup &&
      graph.groups.length > 0 &&
      !xmlLoadError &&
      !graphParseError ? (
        <section className="mt-4 flex min-h-[20rem] items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white/70 px-4 py-10 text-center text-neutral-600 shadow-sm">
          <div className="max-w-2xl text-sm">
            <p className="text-lg font-semibold text-neutral-900">
              Select a root model to visualize.
            </p>
            <p className="mt-2">
              Choose one of the root buttons above to display the model graph.
              Once selected, the graph and inspection panel will appear here.
            </p>
          </div>
        </section>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
