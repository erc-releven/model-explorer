import { CircularProgress, ToggleButton, ToggleButtonGroup } from "@mui/material";
import { DataGrid, type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";
import { useEffect, useMemo, useState } from "react";

import { highlightCodeToHtml } from "./highlight";

interface SparqlBindingValue {
  datatype?: string;
  "xml:lang"?: string;
  type: "bnode" | "literal" | "uri";
  value: string;
}

interface SparqlJsonResult {
  head?: { vars?: Array<string> };
  results?: {
    bindings?: Array<Record<string, SparqlBindingValue>>;
  };
}

interface SparqlResultsProps {
  error: null | string;
  isLoading: boolean;
  payloadSizeBytes: null | number;
  queryDurationMs: null | number;
  result: null | string;
}

const xsdIntegerDatatype = "http://www.w3.org/2001/XMLSchema#integer";

function getSortableCellValue(cell: SparqlBindingValue | undefined): number | string {
  if (cell == null) {
    return "";
  }

  if (cell.datatype === xsdIntegerDatatype) {
    const parsedInteger = Number.parseInt(cell.value, 10);

    return Number.isNaN(parsedInteger) ? cell.value : parsedInteger;
  }

  return cell.value;
}

export function SparqlResults({
  error,
  isLoading,
  payloadSizeBytes,
  queryDurationMs,
  result,
}: SparqlResultsProps) {
  const [viewMode, setViewMode] = useState<"raw" | "table">("table");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [highlightedHtml, setHighlightedHtml] = useState(
    '<pre class="shiki github-light" style="background-color:#fff;color:#24292e"><code></code></pre>',
  );

  useEffect(() => {
    let active = true;

    async function highlight(): Promise<void> {
      const rawText = result ?? "";
      let html = "";

      try {
        html = await highlightCodeToHtml(rawText, "json");
      } catch {
        html = await highlightCodeToHtml(rawText, "text");
      }

      if (!active) {
        return;
      }

      setHighlightedHtml(html);
    }

    void highlight();

    return () => {
      active = false;
    };
  }, [result]);

  useEffect(() => {
    if (!isLoading) {
      setElapsedSeconds(0);
      return;
    }

    const startedAt = Date.now();
    setElapsedSeconds(0);

    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [isLoading]);

  const parsedResult = useMemo(() => {
    if (result == null) {
      return null;
    }

    try {
      return JSON.parse(result) as SparqlJsonResult;
    } catch {
      return null;
    }
  }, [result]);

  const tableColumns = useMemo<Array<GridColDef>>(() => {
    const vars = parsedResult?.head?.vars ?? [];

    return [
      {
        field: "rowNumber",
        headerName: "#",
        renderCell: (params: GridRenderCellParams) => {
          return String(params.api.getRowIndexRelativeToVisibleRows(params.id) + 1);
        },
        sortable: false,
        width: 72,
      },
      ...vars.map((variable): GridColDef => {
        return {
          field: variable,
          minWidth: 180,
          renderCell: (params: GridRenderCellParams) => {
            const row = params.row as Record<string, SparqlBindingValue | undefined>;
            const cell = row[variable];

            if (cell == null) {
              return "";
            }

            if (cell.type === "uri") {
              const targetUrl = `https://releven-graphdb.acdh-dev.oeaw.ac.at/resource?uri=${encodeURIComponent(cell.value)}`;

              return (
                <a href={targetUrl} rel="noreferrer" target="_blank">
                  {cell.value}
                </a>
              );
            }

            return cell.value;
          },
          sortable: true,
          sortComparator: (left, right) => {
            if (typeof left === "number" && typeof right === "number") {
              return left - right;
            }

            return String(left).localeCompare(String(right), undefined, {
              numeric: true,
            });
          },
          valueGetter: (_value, row) => {
            const typedRow = row as Record<string, SparqlBindingValue | undefined>;
            const cell = typedRow[variable];
            return getSortableCellValue(cell);
          },
        };
      }),
    ];
  }, [parsedResult]);

  const tableRows = useMemo(() => {
    const bindings = parsedResult?.results?.bindings ?? [];

    return bindings.map((binding, index) => {
      return {
        id: index,
        ...binding,
      };
    });
  }, [parsedResult]);

  const hasSuccessfulResult = !isLoading && error == null && result != null;
  const resultCount = tableRows.length;

  if (isLoading) {
    return (
      <div aria-label="SPARQL results" className="panel h-screen max-h-screen w-full p-4">
        <div className="flex items-center justify-center gap-2">
          <CircularProgress color="secondary" size={24} />
          <p className="mb-0 text-sm">{`Executing query... ${String(elapsedSeconds)}s`}</p>
        </div>
      </div>
    );
  }

  return (
    <div aria-label="SPARQL results" className="panel max-h-screen w-full p-4">
      <div className="flex items-center justify-between gap-3">
        {hasSuccessfulResult ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-panel border border-ui-border bg-surface-alt px-2 py-1 text-text-strong">
              <strong>Results:</strong> {resultCount.toLocaleString()}
            </span>
            <span className="rounded-panel border border-ui-border bg-surface-alt px-2 py-1 text-text-strong">
              <strong>Time:</strong> {queryDurationMs?.toFixed(0) ?? "0"} ms
            </span>
            <span className="rounded-panel border border-ui-border bg-surface-alt px-2 py-1 text-text-strong">
              <strong>Payload:</strong> {payloadSizeBytes?.toLocaleString() ?? "0"} bytes
            </span>
          </div>
        ) : (
          <div />
        )}
        <ToggleButtonGroup
          color="secondary"
          exclusive
          size="small"
          value={viewMode}
          onChange={(_event, nextValue: "raw" | "table" | null) => {
            if (nextValue != null) {
              setViewMode(nextValue);
            }
          }}
        >
          <ToggleButton value="raw">Raw</ToggleButton>
          <ToggleButton value="table">Table</ToggleButton>
        </ToggleButtonGroup>
      </div>
      {error != null ? (
        <pre className="app-code-surface mt-2 max-h-[calc(100vh-14rem)] min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-panel border border-ui-border p-3 text-sm">
          {error}
        </pre>
      ) : null}
      {error == null && result == null ? (
        <div className="flex h-full items-center justify-center">
          <p className="mb-0 text-sm text-muted">No query executed yet.</p>
        </div>
      ) : null}
      {error == null && result != null && viewMode === "raw" ? (
        <div
          className="app-code-surface mt-2 max-h-[calc(100vh-14rem)] min-w-0 overflow-auto rounded-panel border border-ui-border p-3 text-sm [&_pre]:m-0 [&_pre]:max-w-full [&_pre]:!bg-transparent [&_pre]:p-0 [&_pre]:whitespace-pre-wrap [&_code]:break-words"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      ) : null}
      {error == null && result != null && viewMode === "table" ? (
        parsedResult == null ? (
          <p className="mb-0 mt-2 text-sm text-muted">Result is not valid SPARQL JSON.</p>
        ) : (
          <div className="mt-2 w-full rounded-panel border border-ui-border">
            <DataGrid
              autosizeOnMount
              autosizeOptions={{ expand: false, includeHeaders: true }}
              className="h-[40rem]"
              columns={tableColumns}
              disableColumnFilter
              disableRowSelectionOnClick
              hideFooter
              rows={tableRows}
              sortingOrder={["asc", "desc"]}
            />
          </div>
        )
      ) : null}
    </div>
  );
}
