import {
  Button,
  Checkbox,
  Input,
  Label,
  Tab,
  TabList,
  Tabs,
  TextField,
} from "react-aria-components";
import { Check, X } from "lucide-react";

interface SavedQueryTabView {
  id: string;
  label: string;
  groupName: string;
  selectedNodeCount: number;
}
interface OrderByVariableOption {
  value: string;
  label: string;
}

interface SparqlConfigSectionProps {
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
  namedGraphInput: string;
  selectedOrderByVariable: string;
  selectedOrderByDirection: "ASC" | "DESC";
  queryLimit: number;
  orderByVariableOptions: Array<OrderByVariableOption>;
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
  onNamedGraphInputChange: (value: string) => void;
  onSelectedOrderByVariableChange: (value: string) => void;
  onSelectedOrderByDirectionChange: (value: "ASC" | "DESC") => void;
  onQueryLimitChange: (value: number) => void;
  children?: React.ReactNode;
}
const DEFAULT_NAMED_GRAPH = "https://r11.eu/rdf/resource/tables";

export function SparqlConfigSection({
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
  namedGraphInput,
  selectedOrderByVariable,
  selectedOrderByDirection,
  queryLimit,
  orderByVariableOptions,
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
  onNamedGraphInputChange,
  onSelectedOrderByVariableChange,
  onSelectedOrderByDirectionChange,
  onQueryLimitChange,
  children,
}: SparqlConfigSectionProps) {
  return (
    <div>
      <h3 className="text-lg font-semibold">Query generation</h3>
      <div className="mt-3 rounded-t-md border border-b-0 border-neutral-300 bg-neutral-100 px-2 pt-2">
        <Tabs
          selectedKey={activeQueryTabId}
          onSelectionChange={(key) => {
            onSelectTab(String(key));
          }}
        >
          <TabList
            aria-label="Query selection tabs"
            className="flex flex-nowrap gap-2 overflow-x-auto outline-none"
          >
            <Tab
              id="__current__"
              className={({ isSelected }) =>
                [
                  "relative -mb-px cursor-pointer rounded-t-md rounded-b-none border border-b-0 px-3 py-1.5 text-sm outline-none",
                  isSelected
                    ? "z-10 border-neutral-700 bg-white font-semibold ring-2 ring-neutral-800/20"
                    : "border-neutral-300 bg-neutral-100 hover:bg-white",
                ].join(" ")
              }
            >
              {`current selection (${String(currentSelectionCount)})`}
            </Tab>
            {visibleSavedTabs.map((tab) => (
              <Tab
                key={tab.id}
                id={tab.id}
                className={({ isSelected }) =>
                  [
                    "relative -mb-px cursor-pointer rounded-t-md rounded-b-none border border-b-0 px-3 py-1.5 text-sm outline-none",
                    isSelected
                      ? "z-10 border-neutral-700 bg-white font-semibold ring-2 ring-neutral-800/20"
                      : "border-neutral-300 bg-neutral-100 hover:bg-white",
                  ].join(" ")
                }
              >
                <span className="inline-flex items-center gap-2">
                  <span>{`${tab.groupName}: ${tab.label} (${String(tab.selectedNodeCount)})${tab.id === activeQueryTabId && hasUnsavedChangesForActiveSavedTab ? " *" : ""}`}</span>
                  <Button
                    aria-label={`Delete selection ${tab.label}`}
                    className="rounded-sm border border-neutral-400 bg-white/80 px-1 text-[10px] leading-4 text-neutral-700 hover:bg-red-100 hover:text-red-700"
                    onPress={() => {
                      onDeleteSavedTab(tab.id);
                    }}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </Button>
                </span>
              </Tab>
            ))}
          </TabList>
        </Tabs>
      </div>

      <div className="-mt-px rounded-b-md border border-neutral-300 bg-white p-3">
        <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Checkbox
              isSelected={disregardTypesOfNonRootNodes}
              onChange={onDisregardTypesOfNonRootNodesChange}
              className="inline-flex items-center gap-2 text-sm text-neutral-700"
            >
              {({ isDisabled, isSelected }) => (
                <>
                  <span
                    aria-hidden="true"
                    className={[
                      "inline-flex h-4 w-4 items-center justify-center rounded border text-[11px] leading-none",
                      isDisabled
                        ? "border-neutral-300 bg-neutral-100 text-neutral-400"
                        : "border-neutral-500 bg-white text-neutral-900",
                    ].join(" ")}
                  >
                    {isSelected ? (
                      <Check className="h-3 w-3" aria-hidden="true" />
                    ) : null}
                  </span>
                  <span>disregard types of non-root nodes</span>
                </>
              )}
            </Checkbox>
            <Checkbox
              isSelected={makeAllEntityReferencesOptional}
              onChange={onMakeAllEntityReferencesOptionalChange}
              className="inline-flex items-center gap-2 text-sm text-neutral-700"
            >
              {({ isDisabled, isSelected }) => (
                <>
                  <span
                    aria-hidden="true"
                    className={[
                      "inline-flex h-4 w-4 items-center justify-center rounded border text-[11px] leading-none",
                      isDisabled
                        ? "border-neutral-300 bg-neutral-100 text-neutral-400"
                        : "border-neutral-500 bg-white text-neutral-900",
                    ].join(" ")}
                  >
                    {isSelected ? (
                      <Check className="h-3 w-3" aria-hidden="true" />
                    ) : null}
                  </span>
                  <span>make entity references optional</span>
                </>
              )}
            </Checkbox>
            <Checkbox
              isSelected={makeAllFieldsOptional}
              isDisabled={!makeAllEntityReferencesOptional}
              onChange={onMakeAllFieldsOptionalChange}
              className="ml-6 inline-flex items-center gap-2 text-sm text-neutral-700"
            >
              {({ isDisabled, isSelected }) => (
                <>
                  <span
                    aria-hidden="true"
                    className={[
                      "inline-flex h-4 w-4 items-center justify-center rounded border text-[11px] leading-none",
                      isDisabled
                        ? "border-neutral-300 bg-neutral-100 text-neutral-400"
                        : "border-neutral-500 bg-white text-neutral-900",
                    ].join(" ")}
                  >
                    {isSelected ? (
                      <Check className="h-3 w-3" aria-hidden="true" />
                    ) : null}
                  </span>
                  <span>make all fields optional</span>
                </>
              )}
            </Checkbox>
            <Checkbox
              isSelected={includeFullPrefixConstraints}
              isDisabled={disableIncludeFullPrefixConstraints}
              onChange={onIncludeFullPrefixConstraintsChange}
              className="inline-flex items-start gap-2 text-sm text-neutral-700"
            >
              {({ isDisabled, isSelected }) => (
                <>
                  <span
                    aria-hidden="true"
                    className={[
                      "inline-flex h-4 w-4 items-center justify-center rounded border text-[11px] leading-none",
                      isDisabled
                        ? "border-neutral-300 bg-neutral-100 text-neutral-400"
                        : "border-neutral-500 bg-white text-neutral-900",
                    ].join(" ")}
                  >
                    {isSelected ? (
                      <Check className="h-3 w-3" aria-hidden="true" />
                    ) : null}
                  </span>
                  <span>
                    include full prefix constraints when central node is not a top
                    model
                  </span>
                </>
              )}
            </Checkbox>
            <Checkbox
              isSelected={includeZeroCountResults}
              isDisabled={disableIncludeZeroCountResults}
              onChange={onIncludeZeroCountResultsChange}
              className="inline-flex items-center gap-2 text-sm text-neutral-700"
            >
              {({ isDisabled, isSelected }) => (
                <>
                  <span
                    aria-hidden="true"
                    className={[
                      "inline-flex h-4 w-4 items-center justify-center rounded border text-[11px] leading-none",
                      isDisabled
                        ? "border-neutral-300 bg-neutral-100 text-neutral-400"
                        : "border-neutral-500 bg-white text-neutral-900",
                    ].join(" ")}
                  >
                    {isSelected ? (
                      <Check className="h-3 w-3" aria-hidden="true" />
                    ) : null}
                  </span>
                  <span>include zero count results</span>
                </>
              )}
            </Checkbox>
          </div>
          <div className="flex flex-col gap-2">
            <TextField
              aria-label="named graph input"
              className="mt-1 flex min-w-0 flex-col gap-1 text-sm text-neutral-700"
            >
              <div className="flex items-center gap-2">
                <Label>named graph</Label>
                <Button
                  className="w-fit text-left underline decoration-dotted underline-offset-2 hover:text-neutral-900"
                  onPress={() => {
                    onNamedGraphInputChange(DEFAULT_NAMED_GRAPH);
                  }}
                >
                  use default
                </Button>
              </div>
              <Input
                type="text"
                aria-label="named graph"
                value={namedGraphInput}
                onChange={(event) => {
                  onNamedGraphInputChange(event.target.value);
                }}
                placeholder="https://example.org/graph"
                className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900"
              />
            </TextField>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="flex min-w-0 flex-col gap-1 text-sm text-neutral-700 sm:col-span-2">
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
              <label className="flex min-w-0 flex-col gap-1 text-sm text-neutral-700">
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
            </div>
            <TextField
              aria-label="limit input"
              className="flex w-[8rem] flex-col gap-1 text-sm text-neutral-700"
            >
              <Label>limit</Label>
              <Input
                type="number"
                aria-label="limit"
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
            </TextField>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {isCurrentQueryTab ? (
            <>
              <button
                type="button"
                className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canSaveOrClearSelection}
                onClick={onSaveSelection}
              >
                Save query config
              </button>
              <button
                type="button"
                className="rounded-md border border-neutral-500 bg-neutral-100 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canSaveOrClearSelection}
                onClick={onClearSelection}
              >
                Start with fresh query config
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canUpdateSelection}
                onClick={onUpdateSelection}
              >
                Update query config
              </button>
              {hasUnsavedChangesForActiveSavedTab ? (
                <>
                  <button
                    type="button"
                    className="rounded-md border border-neutral-600 bg-white px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-neutral-100"
                    onClick={onSaveNewSelection}
                  >
                    Save new selection
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-neutral-500 bg-neutral-100 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-neutral-200"
                    onClick={onDiscardChanges}
                  >
                    Discard changes
                  </button>
                </>
              ) : null}
            </>
          )}
        </div>

        {children}
      </div>
    </div>
  );
}

export type { SavedQueryTabView };
