import { useMemo, useRef } from "react";
import { Copy } from "lucide-react";
import { Parser } from "sparqljs";

interface SparqlQuerySectionProps {
  queryText: string;
  copiedQuery: boolean;
  isExecutingQuery: boolean;
  onCopyQuery: () => void;
  onQueryTextChange: (value: string) => void;
  onExecuteQuery: () => void;
  onCancelQuery: () => void;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractTripleVariables(value: unknown): Array<string> {
  if (!isObjectRecord(value)) {
    return [];
  }
  const terms = [value.subject, value.predicate, value.object];
  const variables = new Set<string>();
  for (const term of terms) {
    if (!isObjectRecord(term)) {
      continue;
    }
    if (term.termType === "Variable" && typeof term.value === "string") {
      const variableName = term.value.trim();
      if (variableName.length > 0) {
        variables.add(variableName);
      }
    }
  }
  return [...variables];
}

function collectTripleVariableSets(node: unknown, target: Array<Array<string>>): void {
  if (Array.isArray(node)) {
    for (const entry of node) {
      collectTripleVariableSets(entry, target);
    }
    return;
  }
  if (!isObjectRecord(node)) {
    return;
  }
  if ("subject" in node && "predicate" in node && "object" in node) {
    target.push(extractTripleVariables(node));
  }
  for (const value of Object.values(node)) {
    collectTripleVariableSets(value, target);
  }
}

const VARIABLE_COMPONENT_COLORS = [
  "#fca5a5",
  "#93c5fd",
  "#86efac",
  "#fcd34d",
  "#c4b5fd",
  "#f9a8d4",
  "#67e8f9",
  "#fdba74",
];

function analyzeVariableConnectivity(queryText: string): {
  warning: string | null;
  componentByVariable: Map<string, number>;
} {
  const trimmed = queryText.trim();
  if (trimmed.length === 0) {
    return { warning: null, componentByVariable: new Map<string, number>() };
  }
  try {
    const parser = new Parser();
    const parsed = parser.parse(trimmed);
    const tripleVariableSets: Array<Array<string>> = [];
    collectTripleVariableSets(parsed, tripleVariableSets);

    const allVariables = new Set<string>();
    const adjacency = new Map<string, Set<string>>();

    for (const variables of tripleVariableSets) {
      for (const variableName of variables) {
        allVariables.add(variableName);
        if (!adjacency.has(variableName)) {
          adjacency.set(variableName, new Set<string>());
        }
      }
      for (let i = 0; i < variables.length; i += 1) {
        for (let j = i + 1; j < variables.length; j += 1) {
          adjacency.get(variables[i])?.add(variables[j]);
          adjacency.get(variables[j])?.add(variables[i]);
        }
      }
    }

    const variableList = [...allVariables];
    const componentByVariable = new Map<string, number>();
    const visited = new Set<string>();
    let componentCount = 0;
    for (const variableName of variableList) {
      if (visited.has(variableName)) {
        continue;
      }
      const componentId = componentCount;
      componentCount += 1;
      const queue = [variableName];
      visited.add(variableName);
      componentByVariable.set(variableName, componentId);
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const next of adjacency.get(current) ?? []) {
          if (visited.has(next)) {
            continue;
          }
          visited.add(next);
          componentByVariable.set(next, componentId);
          queue.push(next);
        }
      }
    }

    if (variableList.length <= 1 || componentCount <= 1) {
      return { warning: null, componentByVariable };
    }
    return {
      warning: `Warning: disconnected graph pattern detected (${String(componentCount)} variable components).`,
      componentByVariable,
    };
  } catch {
    return {
      warning: "Warning: query could not be parsed for connectivity checks.",
      componentByVariable: new Map<string, number>(),
    };
  }
}

export function SparqlQuerySection({
  queryText,
  copiedQuery,
  isExecutingQuery,
  onCopyQuery,
  onQueryTextChange,
  onExecuteQuery,
  onCancelQuery,
}: SparqlQuerySectionProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const { warning: disconnectedVariableWarning, componentByVariable } = useMemo(
    () => analyzeVariableConnectivity(queryText),
    [queryText],
  );
  const highlightedQueryParts = useMemo(() => {
    if (queryText.length === 0) {
      return [];
    }
    return queryText.split(/(\?[A-Za-z_]\w*)/g).map((part, index) => {
      const match = /^\?([A-Za-z_]\w*)$/.exec(part);
      if (!match) {
        return {
          key: `plain_${String(index)}`,
          text: part,
          color: "#f5f5f5",
        };
      }
      const componentId = componentByVariable.get(match[1]);
      const color =
        componentId === undefined
          ? "#f5f5f5"
          : VARIABLE_COMPONENT_COLORS[
              componentId % VARIABLE_COMPONENT_COLORS.length
            ];
      return { key: `var_${String(index)}`, text: part, color };
    });
  }, [componentByVariable, queryText]);

  return (
    <div className="w-full max-w-[56rem]">
      <div className="relative mt-3 h-[30lh] rounded-lg bg-neutral-900 ring-1 ring-neutral-700 focus-within:ring-2 focus-within:ring-neutral-500">
        <button
          type="button"
          className="absolute right-2 top-2 z-20 inline-flex items-center gap-1 rounded-md border border-neutral-500 bg-neutral-800/85 px-2 py-1 text-[11px] font-semibold text-neutral-100 hover:bg-neutral-700"
          onClick={onCopyQuery}
          title="Copy query to clipboard"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          {copiedQuery ? "Copied" : "Copy to clipboard"}
        </button>
        <pre
          ref={highlightRef}
          aria-hidden="true"
          className="pointer-events-none h-full overflow-auto whitespace-pre-wrap break-words p-3 pr-36 font-mono text-xs text-neutral-100"
        >
          {queryText.length === 0 ? (
            <span className="text-neutral-500">
              # Query updates automatically when graph selection changes.
            </span>
          ) : (
            highlightedQueryParts.map((part) => (
              <span key={part.key} style={{ color: part.color }}>
                {part.text}
              </span>
            ))
          )}
        </pre>
        <textarea
          ref={textareaRef}
          value={queryText}
          onChange={(event) => {
            onQueryTextChange(event.target.value);
          }}
          onScroll={(event) => {
            if (!highlightRef.current) {
              return;
            }
            highlightRef.current.scrollTop = event.currentTarget.scrollTop;
            highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
          }}
          spellCheck={false}
          className="absolute inset-0 z-10 h-full w-full resize-y overflow-auto rounded-lg border-0 bg-transparent p-3 pr-36 font-mono text-xs text-transparent caret-neutral-100 outline-none selection:bg-neutral-600/70 selection:text-transparent"
        />
      </div>
      {disconnectedVariableWarning ? (
        <p className="mt-2 text-sm font-medium text-amber-700">
          {disconnectedVariableWarning}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isExecutingQuery || queryText.trim().length === 0}
          onClick={onExecuteQuery}
        >
          {isExecutingQuery ? "Executing..." : "Execute query"}
        </button>
        <button
          type="button"
          className="rounded-md border border-neutral-500 bg-neutral-100 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!isExecutingQuery}
          onClick={onCancelQuery}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
