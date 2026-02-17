import type { Edge, Node, ReactFlowInstance } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { GraphDisplaySection } from "./GraphDisplaySection";
import { GraphParseStatus } from "./GraphParseStatus";
import {
  SparqlConfigSection,
  type SavedQueryTabView,
} from "./SparqlConfigSection";
import { SparqlQuerySection } from "./SparqlQuerySection";
import {
  type QueryResultSort,
  type SparqlJsonResultTable,
  SparqlResultsSection,
} from "./SparqlResultsSection";

const GRAPHDB_ENDPOINT =
  "https://releven-graphdb.acdh-dev.oeaw.ac.at/repositories/owl-max";

interface RootGroupOption {
  id: string;
  name: string;
}

interface ActiveGroupSummary {
  name: string;
  typeLabel: string;
}

interface OrderByVariableOption {
  value: string;
  label: string;
}

interface ModelViewerProps {
  graphPathCount: number;
  xmlSourceLabel: string;
  sortedGroups: Array<RootGroupOption>;
  groupReferenceCounts: Record<string, number>;
  activeGroupId: string;
  onSelectGroup: (groupId: string) => void;
  showNoModelMessage: boolean;
  activeGroup: ActiveGroupSummary | null;
  flowViewportRef: React.RefObject<HTMLDivElement | null>;
  flow: { nodes: Array<Node>; edges: Array<Edge> } | null;
  onFlowInit: (instance: ReactFlowInstance) => void;
  onFlowNodeClick: (event: React.MouseEvent, node: Node) => void;
  activeQueryTabId: string;
  currentSelectionCount: number;
  visibleSavedTabs: Array<SavedQueryTabView>;
  hasUnsavedChangesForActiveSavedTab: boolean;
  displayedSelectedCount: number;
  isCurrentQueryTab: boolean;
  canSaveOrClearSelection: boolean;
  canUpdateSelection: boolean;
  includeZeroCountResults: boolean;
  disableIncludeZeroCountResults: boolean;
  includeFullPrefixConstraints: boolean;
  disableIncludeFullPrefixConstraints: boolean;
  makeAllFieldsOptional: boolean;
  makeAllEntityReferencesOptional: boolean;
  disregardTypesOfNonRootNodes: boolean;
  onSelectTab: (tabId: string) => void;
  onDeleteSavedTab: (tabId: string) => void;
  onSaveSelection: () => void;
  onClearSelection: () => void;
  onUpdateSelection: () => void;
  onSaveNewSelection: () => void;
  onDiscardChanges: () => void;
  onIncludeZeroCountResultsChange: (selected: boolean) => void;
  onIncludeFullPrefixConstraintsChange: (selected: boolean) => void;
  onMakeAllFieldsOptionalChange: (selected: boolean) => void;
  onMakeAllEntityReferencesOptionalChange: (selected: boolean) => void;
  onDisregardTypesOfNonRootNodesChange: (selected: boolean) => void;
  queryText: string;
  onQueryTextChange: (value: string) => void;
  namedGraphInput: string;
  onNamedGraphInputChange: (value: string) => void;
  selectedOrderByVariable: string;
  onSelectedOrderByVariableChange: (value: string) => void;
  selectedOrderByDirection: "ASC" | "DESC";
  onSelectedOrderByDirectionChange: (value: "ASC" | "DESC") => void;
  queryLimit: number;
  onQueryLimitChange: (value: number) => void;
  orderByVariableOptions: Array<OrderByVariableOption>;
}

export function ModelViewer({
  graphPathCount,
  xmlSourceLabel,
  sortedGroups,
  groupReferenceCounts,
  activeGroupId,
  onSelectGroup,
  showNoModelMessage,
  activeGroup,
  flowViewportRef,
  flow,
  onFlowInit,
  onFlowNodeClick,
  activeQueryTabId,
  currentSelectionCount,
  visibleSavedTabs,
  hasUnsavedChangesForActiveSavedTab,
  displayedSelectedCount,
  isCurrentQueryTab,
  canSaveOrClearSelection,
  canUpdateSelection,
  includeZeroCountResults,
  disableIncludeZeroCountResults,
  includeFullPrefixConstraints,
  disableIncludeFullPrefixConstraints,
  makeAllFieldsOptional,
  makeAllEntityReferencesOptional,
  disregardTypesOfNonRootNodes,
  onSelectTab,
  onDeleteSavedTab,
  onSaveSelection,
  onClearSelection,
  onUpdateSelection,
  onSaveNewSelection,
  onDiscardChanges,
  onIncludeZeroCountResultsChange,
  onIncludeFullPrefixConstraintsChange,
  onMakeAllFieldsOptionalChange,
  onMakeAllEntityReferencesOptionalChange,
  onDisregardTypesOfNonRootNodesChange,
  queryText,
  onQueryTextChange,
  namedGraphInput,
  onNamedGraphInputChange,
  selectedOrderByVariable,
  onSelectedOrderByVariableChange,
  selectedOrderByDirection,
  onSelectedOrderByDirectionChange,
  queryLimit,
  onQueryLimitChange,
  orderByVariableOptions,
}: ModelViewerProps) {
  const [copiedQuery, setCopiedQuery] = useState(false);
  const [isExecutingQuery, setIsExecutingQuery] = useState(false);
  const [queryExecutionResult, setQueryExecutionResult] = useState("");
  const [queryExecutionTable, setQueryExecutionTable] =
    useState<SparqlJsonResultTable | null>(null);
  const [queryExecutionDurationMs, setQueryExecutionDurationMs] = useState<
    number | null
  >(null);
  const [queryResultSort, setQueryResultSort] =
    useState<QueryResultSort | null>(null);
  const [queryExecutionError, setQueryExecutionError] = useState<string | null>(
    null,
  );
  const queryAbortControllerRef = useRef<AbortController | null>(null);
  const sortedQueryExecutionRows = useMemo(() => {
    if (!queryExecutionTable) {
      return [];
    }
    if (
      !queryResultSort ||
      !queryExecutionTable.vars.includes(queryResultSort.column)
    ) {
      return queryExecutionTable.rows;
    }
    const factor = queryResultSort.direction === "asc" ? 1 : -1;
    return queryExecutionTable.rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const aValue = a.row[queryResultSort.column].value;
        const bValue = b.row[queryResultSort.column].value;
        return aValue.localeCompare(bValue) * factor || a.index - b.index;
      })
      .map((entry) => entry.row);
  }, [queryExecutionTable, queryResultSort]);

  const clearQueryExecutionOutputs = (): void => {
    setQueryExecutionResult("");
    setQueryExecutionTable(null);
    setQueryExecutionError(null);
    setQueryExecutionDurationMs(null);
    setQueryResultSort(null);
  };

  useEffect(() => {
    clearQueryExecutionOutputs();
  }, [activeGroupId, activeQueryTabId]);

  const handleExecuteQuery = (): void => {
    void (async () => {
      const query = queryText.trim();
      if (query.length === 0) {
        setQueryExecutionError("No query is currently generated.");
        setQueryExecutionResult("");
        return;
      }

      setIsExecutingQuery(true);
      setQueryExecutionError(null);
      setQueryExecutionResult("");
      setQueryExecutionTable(null);
      setQueryExecutionDurationMs(null);
      setQueryResultSort(null);
      const abortController = new AbortController();
      queryAbortControllerRef.current = abortController;
      const startedAtMs = performance.now();

      try {
        const params = new URLSearchParams({ query });
        const namedGraph = namedGraphInput.trim();
        if (namedGraph.length > 0) {
          params.set("named-graph-uri", namedGraph);
        }
        const response = await fetch(GRAPHDB_ENDPOINT, {
          method: "POST",
          signal: abortController.signal,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Accept:
              "application/sparql-results+json, application/json;q=0.9, text/plain;q=0.8",
          },
          body: params.toString(),
        });

        const contentType =
          response.headers.get("content-type")?.toLowerCase() ?? "";
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Query failed (${String(response.status)}): ${errorText}`,
          );
        }

        if (contentType.includes("json")) {
          const payload = (await response.json()) as unknown;
          setQueryExecutionResult(JSON.stringify(payload, null, 2));
          const maybeTable = (() => {
            if (typeof payload !== "object" || payload === null) {
              return null;
            }
            const data = payload as {
              head?: { vars?: unknown };
              results?: { bindings?: unknown };
            };
            if (
              !data.head ||
              !Array.isArray(data.head.vars) ||
              !data.results ||
              !Array.isArray(data.results.bindings)
            ) {
              return null;
            }
            const vars = data.head.vars.filter(
              (entry): entry is string =>
                typeof entry === "string" && entry.trim().length > 0,
            );
            if (vars.length === 0) {
              return null;
            }
            const rows = data.results.bindings
              .filter(
                (
                  entry,
                ): entry is Partial<Record<string, { value?: unknown }>> =>
                  typeof entry === "object" && entry !== null,
              )
              .map((entry) => {
                const row: Record<string, { value: string }> = {};
                for (const variable of vars) {
                  const cell = entry[variable];
                  row[variable] = {
                    value: typeof cell?.value === "string" ? cell.value : "",
                  };
                }
                return row;
              });
            return { vars, rows };
          })();
          if (maybeTable) {
            setQueryExecutionTable(maybeTable);
          }
        } else {
          const text = await response.text();
          setQueryExecutionResult(text);
        }
        setQueryExecutionDurationMs(performance.now() - startedAtMs);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          setQueryExecutionError("Query cancelled.");
          return;
        }
        setQueryExecutionError(
          error instanceof Error ? error.message : "Failed to execute query.",
        );
      } finally {
        if (queryAbortControllerRef.current === abortController) {
          queryAbortControllerRef.current = null;
        }
        setIsExecutingQuery(false);
      }
    })();
  };

  const handleCancelQuery = (): void => {
    queryAbortControllerRef.current?.abort();
  };

  const handleCopyQuery = (): void => {
    void (async () => {
      const textToCopy =
        queryText.trim().length > 0
          ? queryText
          : "# Query updates automatically when graph selection changes.";
      try {
        await navigator.clipboard.writeText(textToCopy);
        setCopiedQuery(true);
        window.setTimeout(() => {
          setCopiedQuery(false);
        }, 1200);
      } catch {
        setCopiedQuery(false);
      }
    })();
  };

  const handleToggleQuerySort = (variable: string): void => {
    setQueryResultSort((prev) => {
      if (prev?.column !== variable) {
        return { column: variable, direction: "asc" };
      }
      return {
        column: variable,
        direction: prev.direction === "asc" ? "desc" : "asc",
      };
    });
  };

  return (
    <div className="mt-4 rounded-xl border border-neutral-300 bg-white p-4 shadow-sm">
      <div className="rounded-xl border border-neutral-300 bg-white p-4 shadow-sm">
        <GraphParseStatus
          graphPathCount={graphPathCount}
          xmlSourceLabel={xmlSourceLabel}
        />
      </div>
      <div className="mt-4 flex w-full flex-col gap-4 xl:flex-row">
        <div className="min-w-0 w-full rounded-xl border border-neutral-300 bg-white p-4 shadow-sm xl:flex-1">
          <GraphDisplaySection
            sortedGroups={sortedGroups}
            groupReferenceCounts={groupReferenceCounts}
            activeGroupId={activeGroupId}
            onSelectGroup={onSelectGroup}
            showNoModelMessage={showNoModelMessage}
            activeGroup={activeGroup}
            flowViewportRef={flowViewportRef}
            flow={flow}
            onFlowInit={onFlowInit}
            onFlowNodeClick={onFlowNodeClick}
          />
        </div>
        <div className="min-w-0 w-full rounded-xl border border-neutral-300 bg-white p-4 shadow-sm xl:flex-1">
          <SparqlConfigSection
            activeQueryTabId={activeQueryTabId}
            currentSelectionCount={currentSelectionCount}
            visibleSavedTabs={visibleSavedTabs}
            hasUnsavedChangesForActiveSavedTab={
              hasUnsavedChangesForActiveSavedTab
            }
            displayedSelectedCount={displayedSelectedCount}
            isCurrentQueryTab={isCurrentQueryTab}
            canSaveOrClearSelection={canSaveOrClearSelection}
            canUpdateSelection={canUpdateSelection}
            includeZeroCountResults={includeZeroCountResults}
            disableIncludeZeroCountResults={disableIncludeZeroCountResults}
            includeFullPrefixConstraints={includeFullPrefixConstraints}
            disableIncludeFullPrefixConstraints={
              disableIncludeFullPrefixConstraints
            }
            makeAllFieldsOptional={makeAllFieldsOptional}
            makeAllEntityReferencesOptional={makeAllEntityReferencesOptional}
            disregardTypesOfNonRootNodes={disregardTypesOfNonRootNodes}
            namedGraphInput={namedGraphInput}
            selectedOrderByVariable={selectedOrderByVariable}
            selectedOrderByDirection={selectedOrderByDirection}
            queryLimit={queryLimit}
            orderByVariableOptions={orderByVariableOptions}
            onSelectTab={onSelectTab}
            onDeleteSavedTab={onDeleteSavedTab}
            onSaveSelection={onSaveSelection}
            onClearSelection={onClearSelection}
            onUpdateSelection={onUpdateSelection}
            onSaveNewSelection={onSaveNewSelection}
            onDiscardChanges={onDiscardChanges}
            onIncludeZeroCountResultsChange={onIncludeZeroCountResultsChange}
            onIncludeFullPrefixConstraintsChange={
              onIncludeFullPrefixConstraintsChange
            }
            onMakeAllFieldsOptionalChange={onMakeAllFieldsOptionalChange}
            onMakeAllEntityReferencesOptionalChange={
              onMakeAllEntityReferencesOptionalChange
            }
            onDisregardTypesOfNonRootNodesChange={
              onDisregardTypesOfNonRootNodesChange
            }
            onNamedGraphInputChange={onNamedGraphInputChange}
            onSelectedOrderByVariableChange={onSelectedOrderByVariableChange}
            onSelectedOrderByDirectionChange={onSelectedOrderByDirectionChange}
            onQueryLimitChange={onQueryLimitChange}
          >
            <SparqlQuerySection
              queryText={queryText}
              copiedQuery={copiedQuery}
              isExecutingQuery={isExecutingQuery}
              onCopyQuery={handleCopyQuery}
              onQueryTextChange={onQueryTextChange}
              onExecuteQuery={handleExecuteQuery}
              onCancelQuery={handleCancelQuery}
            />
          </SparqlConfigSection>
        </div>
      </div>
      {activeGroup ? (
        <SparqlResultsSection
          isExecutingQuery={isExecutingQuery}
          queryExecutionError={queryExecutionError}
          queryExecutionTable={queryExecutionTable}
          sortedQueryExecutionRows={sortedQueryExecutionRows}
          queryResultSort={queryResultSort}
          queryExecutionResult={queryExecutionResult}
          queryExecutionDurationMs={queryExecutionDurationMs}
          onToggleQuerySort={handleToggleQuerySort}
        />
      ) : null}
    </div>
  );
}
