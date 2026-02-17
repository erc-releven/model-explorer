import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";

interface SparqlResultCell {
  value: string;
}

interface SparqlJsonResultTable {
  vars: Array<string>;
  rows: Array<Record<string, SparqlResultCell>>;
}

interface QueryResultSort {
  column: string;
  direction: "asc" | "desc";
}

interface SparqlResultsSectionProps {
  isExecutingQuery: boolean;
  queryExecutionError: string | null;
  queryExecutionTable: SparqlJsonResultTable | null;
  sortedQueryExecutionRows: Array<Record<string, SparqlResultCell>>;
  queryResultSort: QueryResultSort | null;
  queryExecutionResult: string;
  queryExecutionDurationMs: number | null;
  onToggleQuerySort: (column: string) => void;
}

const RESOURCE_INSPECTOR_BASE_URL =
  "https://releven-graphdb.acdh-dev.oeaw.ac.at/resource?uri=";

function isUriValue(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:[^\s]+$/.test(value);
}

export function SparqlResultsSection({
  isExecutingQuery,
  queryExecutionError,
  queryExecutionTable,
  sortedQueryExecutionRows,
  queryResultSort,
  queryExecutionResult,
  queryExecutionDurationMs,
  onToggleQuerySort,
}: SparqlResultsSectionProps) {
  const [showRawJsonResults, setShowRawJsonResults] = useState(false);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const resizeStateRef = useRef<{
    variable: string;
    startX: number;
    startWidth: number;
  } | null>(null);
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const hasLoadedResults =
    queryExecutionTable !== null || queryExecutionResult.trim().length > 0;
  const formattedDuration = useMemo(() => {
    if (queryExecutionDurationMs === null) {
      return null;
    }
    if (queryExecutionDurationMs >= 1000) {
      return `${(queryExecutionDurationMs / 1000).toFixed(2)}s`;
    }
    return `${Math.round(queryExecutionDurationMs)}ms`;
  }, [queryExecutionDurationMs]);
  const resultCountLabel =
    queryExecutionTable !== null
      ? String(sortedQueryExecutionRows.length)
      : "unknown";
  const tableSignature = useMemo(() => {
    if (!queryExecutionTable) {
      return "";
    }
    return `${queryExecutionTable.vars.join("|")}::${String(queryExecutionTable.rows.length)}`;
  }, [queryExecutionTable]);

  useEffect(() => {
    if (!queryExecutionTable || queryExecutionTable.vars.length === 0) {
      setColumnWidths({});
      return;
    }
    const container = tableContainerRef.current;
    if (!container) {
      return;
    }
    const availableWidth = Math.max(container.clientWidth - 2, 200);
    const widthPerColumn = Math.max(
      1,
      Math.floor(availableWidth / queryExecutionTable.vars.length),
    );
    const nextWidths: Record<string, number> = {};
    for (const variable of queryExecutionTable.vars) {
      nextWidths[variable] = widthPerColumn;
    }
    setColumnWidths(nextWidths);
  }, [tableSignature, queryExecutionTable]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent): void => {
      const activeResize = resizeStateRef.current;
      if (!activeResize) {
        return;
      }
      const delta = event.clientX - activeResize.startX;
      const nextWidth = Math.max(72, activeResize.startWidth + delta);
      setColumnWidths((previous) => ({
        ...previous,
        [activeResize.variable]: nextWidth,
      }));
    };

    const handleMouseUp = (): void => {
      resizeStateRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  return (
    <section className="mt-4 h-[32rem] rounded-xl border border-neutral-300 bg-white p-4 shadow-sm">
      <h3 className="text-lg font-semibold">Query results</h3>
      {hasLoadedResults ? (
        <div className="mb-2 mt-2 flex items-center justify-between gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5">
          <p className="text-xs text-neutral-700">
            {`Results: ${resultCountLabel}`}
            {formattedDuration ? ` • ${formattedDuration}` : ""}
          </p>
          <div className="inline-flex items-stretch rounded-md border border-neutral-300 bg-white p-1 text-xs text-neutral-700">
            <button
              type="button"
              className={[
                "rounded px-2 py-0.5",
                !showRawJsonResults
                  ? "bg-neutral-800 text-white"
                  : "hover:bg-neutral-100",
              ].join(" ")}
              onClick={() => {
                setShowRawJsonResults(false);
              }}
            >
              table
            </button>
            <button
              type="button"
              className={[
                "rounded px-2 py-0.5",
                showRawJsonResults
                  ? "bg-neutral-800 text-white"
                  : "hover:bg-neutral-100",
              ].join(" ")}
              onClick={() => {
                setShowRawJsonResults(true);
              }}
            >
              raw JSON
            </button>
          </div>
        </div>
      ) : null}
      {queryExecutionError ? (
        <p className="mt-2 text-sm font-medium text-red-700">{queryExecutionError}</p>
      ) : null}
      {isExecutingQuery ? (
        <div className="mt-2 inline-flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-700">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Executing query...
        </div>
      ) : null}
      {queryExecutionTable ? (
        <div className="mt-2">
          {showRawJsonResults && queryExecutionResult ? (
            <pre className="max-h-72 overflow-auto rounded-lg border border-neutral-300 bg-white p-3 text-xs text-neutral-900">
              {queryExecutionResult}
            </pre>
          ) : (
            <div
              ref={tableContainerRef}
              className="max-h-72 overflow-auto rounded-lg border border-neutral-300 bg-white"
            >
              <table className="w-full table-fixed border-collapse text-xs text-neutral-900">
                <colgroup>
                  {queryExecutionTable.vars.map((variable) => (
                    <col
                      key={variable}
                      style={{
                        width: `${String(columnWidths[variable] ?? 120)}px`,
                      }}
                    />
                  ))}
                </colgroup>
                <thead className="sticky top-0 bg-neutral-100">
                  <tr>
                    {queryExecutionTable.vars.map((variable) => (
                      <th
                        key={variable}
                        className="relative border-b border-neutral-300 px-2 py-1 pr-4 text-left font-semibold"
                      >
                        <button
                          type="button"
                          className="inline-flex max-w-full items-center gap-1 rounded px-1 py-0.5 hover:bg-neutral-200"
                          onClick={() => {
                            onToggleQuerySort(variable);
                          }}
                        >
                          <span className="truncate">{variable}</span>
                          {queryResultSort?.column === variable ? (
                            queryResultSort.direction === "asc" ? (
                              <ChevronUp className="h-3 w-3" aria-hidden="true" />
                            ) : (
                              <ChevronDown className="h-3 w-3" aria-hidden="true" />
                            )
                          ) : null}
                        </button>
                        <span
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={`Resize ${variable} column`}
                          className="absolute right-0 top-0 h-full w-2 cursor-col-resize select-none"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            resizeStateRef.current = {
                              variable,
                              startX: event.clientX,
                              startWidth: columnWidths[variable] ?? 120,
                            };
                          }}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedQueryExecutionRows.map((row, rowIndex) => (
                    <tr key={String(rowIndex)} className="odd:bg-white even:bg-neutral-50">
                      {queryExecutionTable.vars.map((variable) => (
                        <td
                          key={`${variable}_${String(rowIndex)}`}
                          className="border-b border-neutral-200 px-2 py-1 align-top"
                        >
                          {isUriValue(row[variable].value) ? (
                            <a
                              href={`${RESOURCE_INSPECTOR_BASE_URL}${encodeURIComponent(row[variable].value)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="block overflow-hidden text-ellipsis whitespace-nowrap text-blue-700 underline hover:text-blue-900"
                              title={row[variable].value}
                            >
                              {row[variable].value}
                            </a>
                          ) : (
                            <span
                              className="block overflow-hidden text-ellipsis whitespace-nowrap"
                              title={row[variable].value}
                            >
                              {row[variable].value}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
      {queryExecutionResult && !queryExecutionTable ? (
        <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-neutral-300 bg-white p-3 text-xs text-neutral-900">
          {queryExecutionResult}
        </pre>
      ) : null}
      {!queryExecutionError &&
      !queryExecutionTable &&
      !queryExecutionResult &&
      !isExecutingQuery ? (
        <div className="mt-2 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-3 text-xs text-neutral-500">
          Query results will appear here after execution (table and raw JSON view).
        </div>
      ) : null}
    </section>
  );
}

export type { QueryResultSort, SparqlJsonResultTable, SparqlResultCell };
