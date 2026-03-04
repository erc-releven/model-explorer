import { ToggleButton, ToggleButtonGroup, Tooltip } from "@mui/material";
import {
  type Dispatch,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  createDefaultNodeState,
  type Scenario,
  type ScenarioAction,
} from "../scenario";
import type { Pathbuilder } from "../serializer/pathbuilder";
import { serializeModelStateToPydantic } from "../serializer/pydantic";
import {
  getSelectedVariableNames,
  serializeScenarioToSparql,
} from "../serializer/sparql";
import { fetchCountForNodePath } from "../serializer/sparql-query";
import { GraphViewer } from "./modelviewer/GraphViewer";
import { ScenarioWorkspace } from "./modelviewer/ScenarioWorkspace";
import { SparqlConfig } from "./modelviewer/SparqlConfig";
import { SparqlResults } from "./modelviewer/SparqlResults";

interface ModelViewerProps {
  dispatchModelState: Dispatch<ScenarioAction>;
  scenario: Scenario;
  pathbuilder: null | Pathbuilder;
  workspaceResetToken: number;
}

export function ModelViewer({
  dispatchModelState,
  scenario,
  pathbuilder,
  workspaceResetToken,
}: ModelViewerProps) {
  const allPaths = useMemo(() => pathbuilder?.values() ?? [], [pathbuilder]);
  const referenceEntities = useMemo(
    () => allPaths.filter((path) => path.references.length > 0),
    [allPaths],
  );
  const [rootTypeSort, setRootTypeSort] = useState<
    "alphabetical" | "instanceCount" | "references"
  >("references");
  const [instanceCountByPathId, setInstanceCountByPathId] = useState<
    Record<string, number>
  >({});
  const pathsWithReferences = useMemo(() => {
    return [...referenceEntities].sort((left, right) => {
      if (rootTypeSort === "alphabetical") {
        return left.name.localeCompare(right.name);
      }

      if (rootTypeSort === "instanceCount") {
        const leftCount = instanceCountByPathId[left.id] ?? -1;
        const rightCount = instanceCountByPathId[right.id] ?? -1;
        const countDifference = rightCount - leftCount;

        if (countDifference !== 0) {
          return countDifference;
        }

        return left.name.localeCompare(right.name);
      }

      const referenceCountDifference =
        right.references.length - left.references.length;

      if (referenceCountDifference !== 0) {
        return referenceCountDifference;
      }

      return left.name.localeCompare(right.name);
    });
  }, [instanceCountByPathId, referenceEntities, rootTypeSort]);
  const [sparqlResult, setSparqlResult] = useState<null | string>(null);
  const [sparqlError, setSparqlError] = useState<null | string>(null);
  const [isSparqlLoading, setIsSparqlLoading] = useState(false);
  const [sparqlDurationMs, setSparqlDurationMs] = useState<null | number>(null);
  const [sparqlPayloadBytes, setSparqlPayloadBytes] = useState<null | number>(
    null,
  );
  const sparqlAbortController = useRef<AbortController | null>(null);
  const generatedQuery = serializeScenarioToSparql(scenario, pathbuilder);
  const generatedPydanticModel = serializeModelStateToPydantic(
    scenario,
    pathbuilder,
  );
  const selectedVariables = getSelectedVariableNames(scenario, pathbuilder);

  useEffect(() => {
    const visiblePathIds = new Set(referenceEntities.map((path) => path.id));

    setInstanceCountByPathId((previousState) => {
      const nextState = Object.fromEntries(
        Object.entries(previousState).filter(([pathId]) =>
          visiblePathIds.has(pathId),
        ),
      );

      return Object.keys(nextState).length === Object.keys(previousState).length
        ? previousState
        : nextState;
    });

    if (referenceEntities.length === 0) {
      return;
    }

    let isCancelled = false;

    void Promise.all(
      referenceEntities.map(async (path) => {
        let countResult: { distinctCount: number; totalCount: number };

        try {
          countResult = await fetchCountForNodePath(pathbuilder, [path.id], {
            sparql: scenario.sparql,
          });
        } catch {
          return;
        }

        if (isCancelled) {
          return;
        }

        setInstanceCountByPathId((previousState) => {
          if (previousState[path.id] === countResult.totalCount) {
            return previousState;
          }

          return {
            ...previousState,
            [path.id]: countResult.totalCount,
          };
        });
      }),
    );

    return () => {
      isCancelled = true;
    };
  }, [pathbuilder, referenceEntities, scenario.sparql]);

  const onCancelQuery = useCallback(() => {
    sparqlAbortController.current?.abort();
  }, []);

  const onExecuteQuery = useCallback(
    async (endpoint: string, query: string) => {
      const normalizedEndpoint = endpoint.trim();
      const normalizedQuery = query.trim();

      if (normalizedEndpoint.length === 0) {
        setSparqlError("Please provide an endpoint.");
        setSparqlResult(null);
        return;
      }

      if (normalizedQuery.length === 0) {
        setSparqlError("Please provide a SPARQL query.");
        setSparqlResult(null);
        return;
      }

      sparqlAbortController.current?.abort();
      const controller = new AbortController();
      sparqlAbortController.current = controller;
      const startedAt = performance.now();

      setIsSparqlLoading(true);
      setSparqlError(null);
      setSparqlDurationMs(null);
      setSparqlPayloadBytes(null);

      try {
        const response = await fetch(normalizedEndpoint, {
          body: new URLSearchParams({ query: normalizedQuery }).toString(),
          headers: {
            Accept:
              "application/sparql-results+json, application/json, text/plain;q=0.8",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          },
          method: "POST",
          signal: controller.signal,
        });

        const responseText = await response.text();

        if (!response.ok) {
          throw new Error(
            `Query failed (${String(response.status)}): ${responseText}`,
          );
        }

        const contentType = response.headers.get("content-type") ?? "";
        const payloadSize = new TextEncoder().encode(responseText).length;
        const formattedResult =
          contentType.includes("json") && responseText.length > 0
            ? JSON.stringify(JSON.parse(responseText), null, 2)
            : responseText;

        setSparqlResult(formattedResult);
        setSparqlError(null);
        setSparqlDurationMs(performance.now() - startedAt);
        setSparqlPayloadBytes(payloadSize);
      } catch (error: unknown) {
        if (controller.signal.aborted) {
          setSparqlError("Query cancelled.");
          setSparqlResult(null);
          setSparqlDurationMs(null);
          setSparqlPayloadBytes(null);
          return;
        }

        setSparqlError(
          error instanceof Error
            ? error.message
            : "SPARQL query execution failed.",
        );
        setSparqlResult(null);
        setSparqlDurationMs(null);
        setSparqlPayloadBytes(null);
      } finally {
        if (sparqlAbortController.current === controller) {
          setIsSparqlLoading(false);
        }
      }
    },
    [],
  );

  return (
    <div
      aria-label="Model viewer"
      className="panel flex min-h-[70vh] flex-col gap-4 p-4"
    >
      <header className="rounded-panel border border-ui-border bg-slate-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-base">
            Parsed {String(allPaths.length)} paths from{" "}
            <code>{scenario.xmlSource || "(none)"}</code>, including{" "}
            {String(pathsWithReferences.length)} root classes:
          </h2>
          <ToggleButtonGroup
            aria-label="Sort root types"
            color="primary"
            exclusive
            size="small"
            value={rootTypeSort}
            onChange={(
              _event,
              nextValue: "alphabetical" | "instanceCount" | "references" | null,
            ) => {
              if (nextValue == null) {
                return;
              }

              setRootTypeSort(nextValue);
            }}
          >
            <ToggleButton value="alphabetical">a-z</ToggleButton>
            <ToggleButton value="instanceCount">instance count</ToggleButton>
            <ToggleButton value="references">entity references</ToggleButton>
          </ToggleButtonGroup>
        </div>
        {pathsWithReferences.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {pathsWithReferences.map((path) => (
              <Tooltip
                key={path.id}
                title={
                  <span className="inline-flex flex-col gap-1">
                    <code>{path.rdf_type || "(unknown type)"}</code>
                    <span>
                      {`${String(path.references.length)} entity references to this class`}
                    </span>
                  </span>
                }
              >
                <button
                  className="rounded-panel border border-ui-border bg-white px-2 py-1 text-sm hover:bg-slate-100"
                  type="button"
                  onClick={() => {
                    dispatchModelState({
                      payload: { nodes: [createDefaultNodeState([path.id])] },
                      type: "state/setNodes",
                    });
                  }}
                >
                  {`${path.name} (${String(instanceCountByPathId[path.id] ?? "...")})`}
                </button>
              </Tooltip>
            ))}
          </div>
        ) : (
          <p className="mb-0 mt-2 text-sm text-muted">
            No PathbuilderPaths with references.
          </p>
        )}
      </header>
      <ScenarioWorkspace
        dispatchModelState={dispatchModelState}
        scenario={scenario}
        workspaceResetToken={workspaceResetToken}
      >
        <div className="flex flex-wrap items-stretch gap-4">
          <div className="flex min-h-panel min-w-0 basis-[48rem] flex-1">
            <GraphViewer
              dispatchScenario={dispatchModelState}
              scenario={scenario}
              pathbuilder={pathbuilder}
            />
          </div>
          <div className="flex min-h-panel min-w-0 basis-[48rem] flex-1">
            <SparqlConfig
              dispatchModelState={dispatchModelState}
              generatedPydanticModel={generatedPydanticModel}
              generatedQuery={generatedQuery}
              isExecuting={isSparqlLoading}
              modelState={scenario}
              selectedVariables={selectedVariables}
              onCancelQuery={onCancelQuery}
              onExecuteQuery={onExecuteQuery}
            />
          </div>
        </div>
      </ScenarioWorkspace>
      <div className="w-full">
        <SparqlResults
          error={sparqlError}
          isLoading={isSparqlLoading}
          payloadSizeBytes={sparqlPayloadBytes}
          queryDurationMs={sparqlDurationMs}
          result={sparqlResult}
        />
      </div>
    </div>
  );
}
