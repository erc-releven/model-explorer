import {
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { type Dispatch, useEffect, useRef, useState } from "react";
import { Parser as SparqlParser } from "sparqljs";

import type {
  OrderByState,
  Scenario,
  ScenarioAction,
} from "../../scenario";
import { DEFAULT_SPARQL_ENDPOINT } from "../../serializer/sparql-query";
import { ClearableInput } from "../ui/ClearableInput";
import { LabeledBorderBox } from "../ui/LabeledBorderBox";
import { highlightCodeToHtml } from "./highlight";

interface SparqlConfigProps {
  dispatchModelState: Dispatch<ScenarioAction>;
  generatedPydanticModel: string;
  generatedQuery: string;
  isExecuting: boolean;
  modelState: Scenario;
  selectedVariables: Array<string>;
  onCancelQuery: () => void;
  onExecuteQuery: (endpoint: string, query: string) => Promise<void>;
}

const emptySelectionPlaceholder =
  "Select (click) or count-select (shift-click) some model nodes to generate a query.";

export function SparqlConfig({
  dispatchModelState,
  generatedPydanticModel,
  generatedQuery,
  isExecuting,
  modelState,
  selectedVariables,
  onCancelQuery,
  onExecuteQuery,
}: SparqlConfigProps) {
  const sparql = modelState.sparql;
  const hasCountNode = modelState.nodes.some((node) => node.selected === "count");
  const hasSelectedNode = modelState.nodes.some((node) => node.selected !== "no");
  const displayedGeneratedQuery = hasSelectedNode
    ? generatedQuery
    : emptySelectionPlaceholder;
  const displayedGeneratedPydanticModel = hasSelectedNode
    ? generatedPydanticModel
    : emptySelectionPlaceholder;
  const textAreaRef = useRef<null | HTMLTextAreaElement>(null);
  const highlightedCodeRef = useRef<null | HTMLDivElement>(null);
  const pydanticTextAreaRef = useRef<null | HTMLTextAreaElement>(null);
  const pydanticHighlightedCodeRef = useRef<null | HTMLDivElement>(null);
  const [endpoint, setEndpoint] = useState(DEFAULT_SPARQL_ENDPOINT);
  const [activeTab, setActiveTab] = useState<"pydantic" | "sparql">("sparql");
  const [queryText, setQueryText] = useState(displayedGeneratedQuery);
  const [pydanticText, setPydanticText] = useState(displayedGeneratedPydanticModel);
  const [highlightedHtml, setHighlightedHtml] = useState(
    '<pre class="shiki github-light" style="background-color:#fff;color:#24292e"><code></code></pre>',
  );
  const [highlightedPydanticHtml, setHighlightedPydanticHtml] = useState(
    '<pre class="shiki github-light" style="background-color:#fff;color:#24292e"><code></code></pre>',
  );
  const [querySyntaxError, setQuerySyntaxError] = useState<null | string>(null);
  const sparqlParserRef = useRef(new SparqlParser());

  useEffect(() => {
    let active = true;

    async function highlight(): Promise<void> {
      let html = "";

      try {
        html = await highlightCodeToHtml(queryText, "sparql");
      } catch {
        html = await highlightCodeToHtml(queryText, "text");
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
  }, [queryText]);

  useEffect(() => {
    let active = true;

    async function highlightPydantic(): Promise<void> {
      let html = "";

      try {
        html = await highlightCodeToHtml(pydanticText, "python");
      } catch {
        html = await highlightCodeToHtml(pydanticText, "text");
      }

      if (!active) {
        return;
      }

      setHighlightedPydanticHtml(html);
    }

    void highlightPydantic();

    return () => {
      active = false;
    };
  }, [pydanticText]);

  useEffect(() => {
    if (textAreaRef.current == null) {
      return;
    }

    textAreaRef.current.value = displayedGeneratedQuery;
    setQueryText(displayedGeneratedQuery);
  }, [displayedGeneratedQuery]);

  useEffect(() => {
    if (pydanticTextAreaRef.current == null) {
      return;
    }

    pydanticTextAreaRef.current.value = displayedGeneratedPydanticModel;
    setPydanticText(displayedGeneratedPydanticModel);
  }, [displayedGeneratedPydanticModel]);

  useEffect(() => {
    if (!hasSelectedNode) {
      setQuerySyntaxError(null);
      return;
    }

    const trimmedQuery = queryText.trim();

    if (trimmedQuery.length === 0) {
      setQuerySyntaxError(null);
      return;
    }

    try {
      sparqlParserRef.current.parse(trimmedQuery);
      setQuerySyntaxError(null);
    } catch (error: unknown) {
      setQuerySyntaxError(
        error instanceof Error ? error.message : "Invalid SPARQL syntax.",
      );
    }
  }, [hasSelectedNode, queryText]);

  useEffect(() => {
    if (sparql.orderBy === "none") {
      return;
    }

    if (selectedVariables.includes(sparql.orderBy)) {
      return;
    }

    dispatchModelState({
      payload: { sparql: { orderBy: "none" } },
      type: "state/setSparqlConfig",
    });
  }, [dispatchModelState, selectedVariables, sparql.orderBy]);

  function onTextAreaScroll(): void {
    if (textAreaRef.current == null || highlightedCodeRef.current == null) {
      return;
    }

    highlightedCodeRef.current.scrollTop = textAreaRef.current.scrollTop;
    highlightedCodeRef.current.scrollLeft = textAreaRef.current.scrollLeft;
  }

  function onPydanticTextAreaScroll(): void {
    if (
      pydanticTextAreaRef.current == null ||
      pydanticHighlightedCodeRef.current == null
    ) {
      return;
    }

    pydanticHighlightedCodeRef.current.scrollTop =
      pydanticTextAreaRef.current.scrollTop;
    pydanticHighlightedCodeRef.current.scrollLeft =
      pydanticTextAreaRef.current.scrollLeft;
  }

  return (
    <div
      aria-label="SPARQL configuration"
      className="panel flex min-h-panel flex-1 p-4"
    >
      <div className="flex w-full flex-col gap-4">
        <h2 className="m-0 text-base">SPARQL Configuration</h2>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <LabeledBorderBox label="counting">
              <div className="flex flex-col">
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={sparql.includeZeroCountResults}
                      disabled={!hasCountNode}
                      onChange={(event) => {
                        dispatchModelState({
                          payload: {
                            sparql: {
                              includeZeroCountResults: event.target.checked,
                            },
                          },
                          type: "state/setSparqlConfig",
                        });
                      }}
                    />
                  }
                  label="include zero count results"
                />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={sparql.countDistinct}
                      disabled={!hasCountNode}
                      onChange={(event) => {
                        dispatchModelState({
                          payload: {
                            sparql: {
                              countDistinct: event.target.checked,
                            },
                          },
                          type: "state/setSparqlConfig",
                        });
                      }}
                    />
                  }
                  label="count DISTINCT"
                />
              </div>
            </LabeledBorderBox>
            <LabeledBorderBox label="debugging">
              <FormControlLabel
                control={
                  <Checkbox
                    checked={sparql.disregardTypesOfNonRootNodes}
                    onChange={(event) => {
                      dispatchModelState({
                        payload: {
                          sparql: {
                            disregardTypesOfNonRootNodes: event.target.checked,
                          },
                        },
                        type: "state/setSparqlConfig",
                      });
                    }}
                  />
                }
                label="disregard types of non-root nodes"
              />
              <div className="flex flex-col">
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={sparql.makeEntityReferencesOptional}
                      onChange={(event) => {
                        const enabled = event.target.checked;

                        dispatchModelState({
                          payload: {
                            sparql: {
                              makeAllFieldsOptional: enabled
                                ? sparql.makeAllFieldsOptional
                                : false,
                              makeEntityReferencesOptional: enabled,
                            },
                          },
                          type: "state/setSparqlConfig",
                        });
                      }}
                    />
                  }
                  label="make entity references optional"
                />
                <div className="pl-8">
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={sparql.makeAllFieldsOptional}
                        disabled={!sparql.makeEntityReferencesOptional}
                        onChange={(event) => {
                          dispatchModelState({
                            payload: {
                              sparql: {
                                makeAllFieldsOptional: event.target.checked,
                              },
                            },
                            type: "state/setSparqlConfig",
                          });
                        }}
                      />
                    }
                    label="make all fields optional"
                  />
                </div>
              </div>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={sparql.alwaysIncludeFullPrefixConstraints}
                    onChange={(event) => {
                      dispatchModelState({
                        payload: {
                          sparql: {
                            alwaysIncludeFullPrefixConstraints:
                              event.target.checked,
                          },
                        },
                        type: "state/setSparqlConfig",
                      });
                    }}
                  />
                }
                label="always include full prefix constraints"
              />
            </LabeledBorderBox>
          </div>

          <div className="flex flex-col gap-4">
            <LabeledBorderBox label="named graph">
              <Button
                className="mb-2"
                size="small"
                variant="text"
                onClick={() => {
                  dispatchModelState({
                    payload: {
                      sparql: {
                        namedGraph: "https://r11.eu/rdf/resource/tables",
                      },
                    },
                    type: "state/setSparqlConfig",
                  });
                }}
              >
                use tables graph
              </Button>
              <ClearableInput
                fullWidth
                label="named graph"
                onClear={() => {
                  dispatchModelState({
                    payload: { sparql: { namedGraph: "" } },
                    type: "state/setSparqlConfig",
                  });
                }}
                placeholder="https://example.org/graph"
                size="small"
                value={sparql.namedGraph}
                onChange={(event) => {
                  dispatchModelState({
                    payload: { sparql: { namedGraph: event.target.value } },
                    type: "state/setSparqlConfig",
                  });
                }}
              />
            </LabeledBorderBox>
            <LabeledBorderBox label="result">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <FormControl fullWidth size="small">
                  <InputLabel id="order-by-label">order by</InputLabel>
                  <Select<OrderByState>
                    label="order by"
                    labelId="order-by-label"
                    value={sparql.orderBy}
                    onChange={(event) => {
                      dispatchModelState({
                        payload: {
                          sparql: { orderBy: event.target.value as OrderByState },
                        },
                        type: "state/setSparqlConfig",
                      });
                    }}
                  >
                    <MenuItem value="none">none</MenuItem>
                    {selectedVariables.map((variable) => (
                      <MenuItem key={variable} value={variable}>
                        {variable}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl fullWidth size="small">
                  <InputLabel id="direction-label">direction</InputLabel>
                  <Select<"ASC" | "DESC">
                    disabled={sparql.orderBy === "none"}
                    label="direction"
                    labelId="direction-label"
                    value={sparql.direction}
                    onChange={(event) => {
                      dispatchModelState({
                        payload: { sparql: { direction: event.target.value } },
                        type: "state/setSparqlConfig",
                      });
                    }}
                  >
                    <MenuItem value="ASC">ASC</MenuItem>
                    <MenuItem value="DESC">DESC</MenuItem>
                  </Select>
                </FormControl>
              </div>
              <div className="mt-3">
                <ClearableInput
                  fullWidth
                  label="limit"
                  onClear={() => {
                    dispatchModelState({
                      payload: { sparql: { limit: undefined } },
                      type: "state/setSparqlConfig",
                    });
                  }}
                  size="small"
                  slotProps={{
                    htmlInput: {
                      min: 0,
                      step: 1,
                      style: { MozAppearance: "textfield" as const },
                    },
                  }}
                  sx={{
                    "& input[type=number]::-webkit-inner-spin-button, & input[type=number]::-webkit-outer-spin-button":
                      {
                        margin: 0,
                        WebkitAppearance: "none",
                      },
                  }}
                  type="number"
                  value={sparql.limit == null ? "" : String(sparql.limit)}
                  onChange={(event) => {
                    if (event.target.value.trim() === "") {
                      dispatchModelState({
                        payload: {
                          sparql: { limit: undefined },
                        },
                        type: "state/setSparqlConfig",
                      });
                      return;
                    }

                    const parsed = Number.parseInt(event.target.value, 10);
                    dispatchModelState({
                      payload: {
                        sparql: {
                          limit: Number.isFinite(parsed) ? parsed : undefined,
                        },
                      },
                      type: "state/setSparqlConfig",
                    });
                  }}
                />
              </div>
            </LabeledBorderBox>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-2">
          <div className="flex items-center justify-between">
            <Tabs
              value={activeTab}
              onChange={(_event, value: "pydantic" | "sparql") => {
                setActiveTab(value);
              }}
            >
              <Tab label="SPARQL query" value="sparql" />
              <Tab label="Pydantic model" value="pydantic" />
            </Tabs>
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                const content =
                  activeTab === "sparql"
                    ? (textAreaRef.current?.value ?? "")
                    : (pydanticTextAreaRef.current?.value ?? "");
                void navigator.clipboard.writeText(content);
              }}
            >
              copy to clipboard
            </Button>
          </div>
          {activeTab === "sparql" ? (
            <div className="relative min-h-[18rem] overflow-hidden rounded-panel border border-ui-border">
              <div
                ref={highlightedCodeRef}
                className="pointer-events-none h-full overflow-y-auto overflow-x-hidden p-3 font-mono text-sm [&_pre]:m-0 [&_pre]:min-h-full [&_pre]:!bg-transparent [&_pre]:p-0 [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_code]:whitespace-pre-wrap [&_code]:break-words"
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
              <textarea
                ref={textAreaRef}
                className="absolute inset-0 h-full w-full resize-none overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words bg-transparent p-3 font-mono text-sm text-transparent caret-slate-900 outline-none"
                defaultValue={displayedGeneratedQuery}
                wrap="soft"
                onInput={(event) => {
                  setQueryText(event.currentTarget.value);
                }}
                onScroll={onTextAreaScroll}
              />
            </div>
          ) : (
            <div className="relative min-h-[18rem] overflow-hidden rounded-panel border border-ui-border">
              <div
                ref={pydanticHighlightedCodeRef}
                className="pointer-events-none h-full overflow-y-auto overflow-x-hidden p-3 font-mono text-sm [&_pre]:m-0 [&_pre]:min-h-full [&_pre]:!bg-transparent [&_pre]:p-0 [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_code]:whitespace-pre-wrap [&_code]:break-words"
                dangerouslySetInnerHTML={{ __html: highlightedPydanticHtml }}
              />
              <textarea
                ref={pydanticTextAreaRef}
                className="absolute inset-0 h-full w-full resize-none overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words bg-transparent p-3 font-mono text-sm text-transparent caret-slate-900 outline-none"
                defaultValue={displayedGeneratedPydanticModel}
                wrap="soft"
                onInput={(event) => {
                  setPydanticText(event.currentTarget.value);
                }}
                onScroll={onPydanticTextAreaScroll}
              />
            </div>
          )}
          {activeTab === "sparql" && querySyntaxError != null ? (
            <Typography color="warning.main" variant="caption">
              {querySyntaxError}
            </Typography>
          ) : null}
          <div className="flex justify-end gap-2">
            <TextField
              className="min-w-[22rem] flex-1"
              label="endpoint"
              size="small"
              value={endpoint}
              onChange={(event) => {
                setEndpoint(event.target.value);
              }}
            />
            <Button
              disabled={isExecuting || querySyntaxError != null}
              variant="contained"
              onClick={() => {
                const query = textAreaRef.current?.value ?? "";
                void onExecuteQuery(endpoint, query);
              }}
            >
              Execute query
            </Button>
            <Button
              disabled={!isExecuting}
              variant="outlined"
              onClick={() => {
                onCancelQuery();
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
