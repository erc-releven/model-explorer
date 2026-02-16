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

interface OrderByVariableOption {
  value: string;
  label: string;
}

interface SparqlQuerySectionProps {
  displayedQuery: string;
  copiedQuery: boolean;
  namedGraphInput: string;
  selectedOrderByVariable: string;
  selectedOrderByDirection: "ASC" | "DESC";
  queryLimit: number;
  isExecutingQuery: boolean;
  generatedSparql: string;
  orderByVariableOptions: Array<OrderByVariableOption>;
  queryExecutionError: string | null;
  queryExecutionTable: SparqlJsonResultTable | null;
  sortedQueryExecutionRows: Array<Record<string, SparqlResultCell>>;
  queryResultSort: QueryResultSort | null;
  queryExecutionResult: string;
  onCopyQuery: () => void;
  onNamedGraphInputChange: (value: string) => void;
  onSelectedOrderByVariableChange: (value: string) => void;
  onSelectedOrderByDirectionChange: (value: "ASC" | "DESC") => void;
  onQueryLimitChange: (value: number) => void;
  onExecuteQuery: () => void;
  onToggleQuerySort: (column: string) => void;
}

const RESOURCE_INSPECTOR_BASE_URL =
  "https://releven-graphdb.acdh-dev.oeaw.ac.at/resource?uri=";

function isUriValue(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:[^\s]+$/.test(value);
}

export function SparqlQuerySection({
  displayedQuery,
  copiedQuery,
  namedGraphInput,
  selectedOrderByVariable,
  selectedOrderByDirection,
  queryLimit,
  isExecutingQuery,
  generatedSparql,
  orderByVariableOptions,
  queryExecutionError,
  queryExecutionTable,
  sortedQueryExecutionRows,
  queryResultSort,
  queryExecutionResult,
  onCopyQuery,
  onNamedGraphInputChange,
  onSelectedOrderByVariableChange,
  onSelectedOrderByDirectionChange,
  onQueryLimitChange,
  onExecuteQuery,
  onToggleQuerySort,
}: SparqlQuerySectionProps) {
  return (
    <>
      <pre className="mt-3 max-h-[30lh] overflow-auto rounded-lg bg-neutral-900 p-3 text-xs text-neutral-100">
        <button
          type="button"
          className="sticky right-2 top-2 float-right mb-2 ml-2 inline-flex items-center gap-1 rounded-md border border-neutral-500 bg-neutral-800/85 px-2 py-1 text-[11px] font-semibold text-neutral-100 hover:bg-neutral-700"
          onClick={onCopyQuery}
          title="Copy query to clipboard"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path d="M9 2.25A2.25 2.25 0 0 0 6.75 4.5v1.5H6A2.25 2.25 0 0 0 3.75 8.25v10.5A2.25 2.25 0 0 0 6 21h8.25a2.25 2.25 0 0 0 2.25-2.25V17.5H18A2.25 2.25 0 0 0 20.25 15V4.5A2.25 2.25 0 0 0 18 2.25H9Zm-.75 3.75V4.5a.75.75 0 0 1 .75-.75H18a.75.75 0 0 1 .75.75V15a.75.75 0 0 1-.75.75h-1.5v-7.5A2.25 2.25 0 0 0 14.25 6H8.25Z" />
          </svg>
          {copiedQuery ? "Copied" : "Copy to clipboard"}
        </button>
        {displayedQuery}
      </pre>
      <div className="mt-3">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-sm text-neutral-700">
            <span>named graph</span>
            <input
              type="text"
              value={namedGraphInput}
              onChange={(event) => {
                onNamedGraphInputChange(event.target.value);
              }}
              placeholder="https://example.org/graph"
              className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900"
            />
          </label>
          <label className="flex min-w-[11rem] flex-col gap-1 text-sm text-neutral-700">
            <span>order by variable</span>
            <select
              value={selectedOrderByVariable}
              onChange={(event) => {
                onSelectedOrderByVariableChange(event.target.value);
              }}
              disabled={orderByVariableOptions.length === 0}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 disabled:bg-neutral-100 disabled:text-neutral-500"
            >
              {orderByVariableOptions.length === 0 ? (
                <option value="">No projected variables</option>
              ) : (
                orderByVariableOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="flex w-[6.5rem] flex-col gap-1 text-sm text-neutral-700">
            <span>direction</span>
            <select
              value={selectedOrderByDirection}
              onChange={(event) => {
                const next = event.target.value;
                if (next === "ASC" || next === "DESC") {
                  onSelectedOrderByDirectionChange(next);
                }
              }}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900"
            >
              <option value="ASC">ASC</option>
              <option value="DESC">DESC</option>
            </select>
          </label>
          <label className="flex w-[6.5rem] flex-col gap-1 text-sm text-neutral-700">
            <span>limit</span>
            <input
              type="number"
              min={1}
              step={1}
              value={Number.isNaN(queryLimit) ? "" : queryLimit}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                if (Number.isNaN(parsed)) {
                  onQueryLimitChange(Number.NaN);
                  return;
                }
                onQueryLimitChange(parsed);
              }}
              className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900"
            />
          </label>
          <button
            type="button"
            className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isExecutingQuery || generatedSparql.trim().length === 0}
            onClick={onExecuteQuery}
          >
            {isExecutingQuery ? "Executing..." : "Execute query"}
          </button>
        </div>
        {queryExecutionError ? (
          <p className="mt-2 text-sm font-medium text-red-700">{queryExecutionError}</p>
        ) : null}
        {queryExecutionTable ? (
          <div className="mt-2">
            <p className="mb-1 text-sm text-neutral-700">
              Results: {String(sortedQueryExecutionRows.length)}
            </p>
            <div className="max-h-72 overflow-auto rounded-lg border border-neutral-300 bg-white">
              <table className="w-max table-auto border-collapse text-xs text-neutral-900">
                <thead className="sticky top-0 bg-neutral-100">
                  <tr>
                    {queryExecutionTable.vars.map((variable) => (
                      <th
                        key={variable}
                        className="border-b border-neutral-300 px-2 py-1 text-left font-semibold whitespace-nowrap"
                      >
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-neutral-200"
                          onClick={() => {
                            onToggleQuerySort(variable);
                          }}
                        >
                          <span>{variable}</span>
                          {queryResultSort?.column === variable ? (
                            <span>{queryResultSort.direction === "asc" ? "▲" : "▼"}</span>
                          ) : null}
                        </button>
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
                          className="border-b border-neutral-200 px-2 py-1 align-top whitespace-nowrap"
                        >
                          {isUriValue(row[variable].value) ? (
                            <a
                              href={`${RESOURCE_INSPECTOR_BASE_URL}${encodeURIComponent(row[variable].value)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-700 underline hover:text-blue-900"
                            >
                              {row[variable].value}
                            </a>
                          ) : (
                            row[variable].value
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        {queryExecutionResult ? (
          <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-neutral-300 bg-white p-3 text-xs text-neutral-900">
            {queryExecutionResult}
          </pre>
        ) : null}
      </div>
    </>
  );
}

export type { QueryResultSort, SparqlJsonResultTable, SparqlResultCell };
