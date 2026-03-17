import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Accordion, AccordionDetails, AccordionSummary } from "@mui/material";
import { type Dispatch, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Scenario, ScenarioAction } from "../../scenario";
import { parsePathbuilderXml, type Pathbuilder } from "../../serializer/pathbuilder";
import { serializeModelStateToPydantic } from "../../serializer/pydantic";
import { getSelectedVariableNames, serializeScenarioToSparql } from "../../serializer/sparql";
import { executeSparqlQuery } from "../../serializer/sparql-execution";
import { fetchCountForNodePath } from "../../serializer/sparql-query";
import { resolveXmlSourceForFetch } from "../../utils/resolve-xml-source";
import { GraphViewer } from "./GraphViewer";
import { ScenarioWorkspace } from "./ScenarioWorkspace/ScenarioWorkspace";
import { SparqlConfig } from "./SparqlConfig";
import { SparqlResults } from "./SparqlResults";

interface ModelViewerProps {
  dispatchModelState: Dispatch<ScenarioAction>;
  scenario: Scenario;
}

export function ModelViewer({ dispatchModelState, scenario }: ModelViewerProps) {
  const [pathbuilder, setPathbuilder] = useState<null | Pathbuilder>(null);
  const [xmlLoadError, setXmlLoadError] = useState<null | string>(null);
  const [isXmlLoading, setIsXmlLoading] = useState(false);
  const [loadedXmlSource, setLoadedXmlSource] = useState<null | string>(null);
  const [isResultsExpanded, setIsResultsExpanded] = useState(false);
  const allPaths = useMemo(() => pathbuilder?.values() ?? [], [pathbuilder]);
  const referenceEntities = useMemo(
    () => allPaths.filter((path) => path.references.length > 0),
    [allPaths],
  );
  const [instanceCountByPathId, setInstanceCountByPathId] = useState<Record<string, number>>({});
  const [sparqlResult, setSparqlResult] = useState<null | string>(null);
  const [sparqlError, setSparqlError] = useState<null | string>(null);
  const [isSparqlLoading, setIsSparqlLoading] = useState(false);
  const [sparqlDurationMs, setSparqlDurationMs] = useState<null | number>(null);
  const [sparqlPayloadBytes, setSparqlPayloadBytes] = useState<null | number>(null);
  const resultsSummaryRef = useRef<HTMLDivElement | null>(null);
  const sparqlAbortController = useRef<AbortController | null>(null);
  const generatedQuery = serializeScenarioToSparql(scenario, pathbuilder);
  const generatedPydanticModel = serializeModelStateToPydantic(scenario, pathbuilder);
  const selectedVariables = getSelectedVariableNames(scenario, pathbuilder);

  useEffect(() => {
    const rawSource = scenario.xmlSource.trim();

    if (rawSource.length === 0) {
      setIsXmlLoading(false);
      setPathbuilder(null);
      setXmlLoadError(null);
      setLoadedXmlSource(null);
      return;
    }

    let isCancelled = false;
    const controller = new AbortController();

    setIsXmlLoading(true);
    setPathbuilder(null);
    setXmlLoadError(null);
    setLoadedXmlSource(null);

    async function loadAndParseXmlSource(): Promise<void> {
      try {
        const source = resolveXmlSourceForFetch(rawSource);
        const response = await fetch(source, { signal: controller.signal });

        if (!response.ok) {
          throw new Error(`Failed to load XML file (${String(response.status)}).`);
        }

        const xmlContent = await response.text();
        const nextPathbuilder = parsePathbuilderXml(xmlContent);

        if (isCancelled) {
          return;
        }

        setPathbuilder(nextPathbuilder);
        setXmlLoadError(null);
        setLoadedXmlSource(rawSource);
      } catch (error: unknown) {
        if (controller.signal.aborted || isCancelled) {
          return;
        }

        setPathbuilder(null);
        setXmlLoadError(error instanceof Error ? error.message : "Failed to load XML file.");
      } finally {
        if (!isCancelled) {
          setIsXmlLoading(false);
        }
      }
    }

    void loadAndParseXmlSource();

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [scenario.xmlSource]);

  useEffect(() => {
    const visiblePathIds = new Set(referenceEntities.map((path) => path.id));

    setInstanceCountByPathId((previousState) => {
      const nextState = Object.fromEntries(
        Object.entries(previousState).filter(([pathId]) => visiblePathIds.has(pathId)),
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

  const onExecuteQuery = useCallback(async (endpoint: string, query: string) => {
    setIsResultsExpanded(true);
    requestAnimationFrame(() => {
      resultsSummaryRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      resultsSummaryRef.current?.focus();
    });
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

    setIsSparqlLoading(true);
    setSparqlError(null);
    setSparqlDurationMs(null);
    setSparqlPayloadBytes(null);

    try {
      const executionResult = await executeSparqlQuery(
        normalizedEndpoint,
        normalizedQuery,
        controller.signal,
      );

      setSparqlResult(executionResult.result);
      setSparqlError(null);
      setSparqlDurationMs(executionResult.durationMs);
      setSparqlPayloadBytes(executionResult.payloadBytes);
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        setSparqlError("Query cancelled.");
        setSparqlResult(null);
        setSparqlDurationMs(null);
        setSparqlPayloadBytes(null);
        return;
      }

      setSparqlError(error instanceof Error ? error.message : "SPARQL query execution failed.");
      setSparqlResult(null);
      setSparqlDurationMs(null);
      setSparqlPayloadBytes(null);
    } finally {
      if (sparqlAbortController.current === controller) {
        setIsSparqlLoading(false);
      }
    }
  }, []);

  return (
    <div
      aria-label="Model viewer"
      className="mx-auto flex min-h-[70vh] max-w-screen-2xl flex-col gap-4"
    >
      <Accordion defaultExpanded disableGutters>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <span className="text-sm font-semibold text-text-strong">Scenario Workspace</span>
        </AccordionSummary>
        <AccordionDetails className="p-0">
          <ScenarioWorkspace
            dispatchModelState={dispatchModelState}
            isXmlLoading={isXmlLoading}
            instanceCountByPathId={instanceCountByPathId}
            loadedXmlSource={loadedXmlSource}
            pathCount={allPaths.length}
            pathsWithReferences={referenceEntities}
            rootClassCount={referenceEntities.length}
            scenario={scenario}
            xmlLoadError={xmlLoadError}
          >
            <div className="flex flex-wrap items-stretch gap-4">
              <div className="flex min-h-[36rem] min-w-[40rem] flex-1">
                <GraphViewer
                  dispatchScenario={dispatchModelState}
                  scenario={scenario}
                  pathbuilder={pathbuilder}
                />
              </div>
              <div className="flex min-w-[40rem] flex-1">
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
        </AccordionDetails>
      </Accordion>
      <Accordion
        disableGutters
        expanded={isResultsExpanded}
        onChange={(_event, expanded) => {
          setIsResultsExpanded(expanded);
        }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />} ref={resultsSummaryRef}>
          <span className="text-sm font-semibold text-text-strong">SPARQL Results</span>
        </AccordionSummary>
        <AccordionDetails className="p-0">
          <SparqlResults
            error={sparqlError}
            isLoading={isSparqlLoading}
            payloadSizeBytes={sparqlPayloadBytes}
            queryDurationMs={sparqlDurationMs}
            result={sparqlResult}
          />
        </AccordionDetails>
      </Accordion>
    </div>
  );
}
