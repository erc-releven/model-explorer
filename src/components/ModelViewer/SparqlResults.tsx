import {
  Chip,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import {
  DataGrid,
  type GridColDef,
  type GridRenderCellParams,
} from "@mui/x-data-grid";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

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
  truncatedLineCount: number;
  resultTruncated: boolean;
}

const xsdIntegerDatatype = "http://www.w3.org/2001/XMLSchema#integer";
const maxHighlightedPayloadBytes = 50_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null;
}

function extractFetchErrorMessage(error: string): string {
  const bodyStartIndex = error.indexOf(": ");

  if (bodyStartIndex === -1) {
    return error;
  }

  const responseText = error.slice(bodyStartIndex + 2).trim();

  if (responseText.length === 0) {
    return error;
  }

  try {
    const parsed = JSON.parse(responseText) as unknown;

    if (!isRecord(parsed)) {
      return responseText;
    }

    const message =
      typeof parsed.message === "string"
        ? parsed.message
        : typeof parsed.error === "string"
          ? parsed.error
          : typeof parsed.detail === "string"
            ? parsed.detail
            : undefined;

    return message?.trim().length ? message : responseText;
  } catch {
    return responseText;
  }
}

function getSortableCellValue(
  cell: SparqlBindingValue | undefined,
): number | string {
  if (cell == null) {
    return "";
  }

  if (cell.datatype === xsdIntegerDatatype) {
    const parsedInteger = Number.parseInt(cell.value, 10);

    return Number.isNaN(parsedInteger) ? cell.value : parsedInteger;
  }

  return cell.value;
}

function formatPayloadSize(payloadSizeBytes: null | number): string {
  if (payloadSizeBytes == null) {
    return "...";
  }

  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: payloadSizeBytes < 1_000_000 ? 1 : 2,
    notation: "compact",
    style: "unit",
    unit: "byte",
    unitDisplay: "narrow",
  }).format(payloadSizeBytes);
}

function getRawLineNumbers(rawText: string): string {
  return rawText
    .split("\n")
    .map((_, index) => String(index + 1))
    .join("\n");
}

export function SparqlResults({
  error,
  isLoading,
  payloadSizeBytes,
  queryDurationMs,
  result,
  truncatedLineCount,
  resultTruncated,
}: SparqlResultsProps) {
  const [viewMode, setViewMode] = useState<"raw" | "table">("table");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [highlightedHtml, setHighlightedHtml] = useState(
    '<pre class="shiki github-light" style="background-color:#fff;color:#24292e"><code></code></pre>',
  );
  const deferredResult = useDeferredValue(result);
  const isResultDeferred = result !== deferredResult;
  const shouldHighlightRawResult =
    result != null &&
    (payloadSizeBytes == null ||
      payloadSizeBytes <= maxHighlightedPayloadBytes);

  useEffect(() => {
    let active = true;

    async function highlight(): Promise<void> {
      const rawText = deferredResult ?? "";
      let html = "";

      if (!shouldHighlightRawResult) {
        if (active) {
          setHighlightedHtml("");
        }

        return;
      }

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
  }, [deferredResult, shouldHighlightRawResult]);

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
    if (deferredResult == null) {
      return null;
    }

    try {
      return JSON.parse(deferredResult) as SparqlJsonResult;
    } catch {
      return null;
    }
  }, [deferredResult]);

  const tableColumns = useMemo<Array<GridColDef>>(() => {
    const vars = parsedResult?.head?.vars ?? [];

    return [
      {
        field: "rowNumber",
        headerName: "#",
        renderCell: (params: GridRenderCellParams) => {
          return String(
            params.api.getRowIndexRelativeToVisibleRows(params.id) + 1,
          );
        },
        sortable: false,
        width: 72,
      },
      ...vars.map((variable): GridColDef => {
        return {
          field: variable,
          minWidth: 180,
          renderCell: (params: GridRenderCellParams) => {
            const row = params.row as Record<
              string,
              SparqlBindingValue | undefined
            >;
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
            const typedRow = row as Record<
              string,
              SparqlBindingValue | undefined
            >;
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
  const rawLineNumbers = useMemo(() => {
    if (result == null) {
      return "";
    }

    const baseLineNumbers = getRawLineNumbers(result);

    if (!resultTruncated || truncatedLineCount <= 0) {
      return baseLineNumbers;
    }

    return `${baseLineNumbers}\n\n...`;
  }, [result, resultTruncated, truncatedLineCount]);
  const rawTextPreview = useMemo(() => {
    if (result == null) {
      return "";
    }

    if (!resultTruncated || truncatedLineCount <= 0) {
      return result;
    }

    return `${result}\n\n${truncatedLineCount.toLocaleString()} more lines ...`;
  }, [result, resultTruncated, truncatedLineCount]);

  const hasSuccessfulResult = !isLoading && error == null && result != null;
  const resultCount = tableRows.length;
  const displayedError = useMemo(() => {
    return error == null ? null : extractFetchErrorMessage(error);
  }, [error]);

  if (isLoading) {
    return (
      <div
        aria-label="SPARQL results"
        className="panel h-screen max-h-screen w-full p-4"
      >
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
            <Chip
              label={`Results: ${resultCount.toLocaleString()}`}
              size="small"
              variant="outlined"
            />
            <Chip
              label={`Time: ${queryDurationMs?.toFixed(0) ?? "0"} ms`}
              size="small"
              variant="outlined"
            />
            <Chip
              label={`Payload: ${formatPayloadSize(payloadSizeBytes)}`}
              size="small"
              variant="outlined"
            />
            {resultTruncated ? (
              <Chip color="warning" label="Preview truncated" size="small" />
            ) : null}
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
      {displayedError != null ? (
        <pre className="app-code-surface mt-2 max-h-[calc(100vh-14rem)] min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-panel border border-ui-border p-3 text-sm">
          {displayedError}
        </pre>
      ) : null}
      {error == null && result == null ? (
        <div className="flex h-full items-center justify-center">
          <p className="mb-0 text-sm text-muted">No query executed yet.</p>
        </div>
      ) : null}
      {error == null && result != null && viewMode === "raw" ? (
        <>
          {resultTruncated ? (
            <div className="mt-2 rounded-panel border border-ui-border p-3 text-sm text-muted">
              The response preview was truncated because the payload was too
              large to safely render in the browser.
            </div>
          ) : null}
          {shouldHighlightRawResult ? (
            <div
              className="app-code-surface mt-2 max-h-[calc(100vh-14rem)] min-w-0 overflow-auto rounded-panel border border-ui-border p-3 text-sm [&_pre]:m-0 [&_pre]:max-w-full [&_pre]:!bg-transparent [&_pre]:p-0 [&_pre]:whitespace-pre-wrap [&_code]:break-words"
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          ) : (
            <div className="app-code-surface mt-2 grid max-h-[calc(100vh-14rem)] min-w-0 grid-cols-[auto,minmax(0,1fr)] overflow-auto rounded-panel border border-ui-border text-sm">
              <pre className="m-0 select-none border-r border-ui-border px-3 py-3 text-right text-muted">
                {rawLineNumbers}
              </pre>
              <pre className="m-0 overflow-auto whitespace-pre px-3 py-3">
                {rawTextPreview}
              </pre>
            </div>
          )}
        </>
      ) : null}
      {error == null && result != null && viewMode === "table" ? (
        isResultDeferred ? (
          <div className="mt-2 rounded-panel border border-ui-border p-3 text-sm text-muted">
            Parsing query result...
          </div>
        ) : resultTruncated ? (
          <div className="mt-2 rounded-panel border border-ui-border p-3 text-sm text-muted">
            The response preview was truncated because the payload was too large
            for safe table rendering. Add a `LIMIT` to display the result in the
            table, or switch to Raw to inspect the preview.
          </div>
        ) : parsedResult == null ? (
          <p className="mb-0 mt-2 text-sm text-muted">
            Result is not valid SPARQL JSON.
          </p>
        ) : (
          <div
            className="mt-2 w-full rounded-panel border border-ui-border"
            style={{ height: "calc(100vh - 10rem)" }}
          >
            <DataGrid
              autosizeOnMount
              autosizeOptions={{ expand: false, includeHeaders: true }}
              sx={{ height: "100%" }}
              columns={tableColumns}
              disableColumnFilter
              disableRowSelectionOnClick
              initialState={{
                pagination: { paginationModel: { pageSize: 100 } },
              }}
              pageSizeOptions={[100]}
              rows={tableRows}
              sortingOrder={["asc", "desc"]}
            />
          </div>
        )
      ) : null}
    </div>
  );
}
