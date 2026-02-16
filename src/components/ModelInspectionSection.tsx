import { Button, Checkbox, Tab, TabList, Tabs } from "react-aria-components";

interface SavedQueryTabView {
  id: string;
  label: string;
  groupName: string;
  selectedNodeCount: number;
}

interface ModelInspectionSectionProps {
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
  onSelectTab: (tabId: string) => void;
  onDeleteSavedTab: (tabId: string) => void;
  onSaveSelection: () => void;
  onClearSelection: () => void;
  onUpdateSelection: () => void;
  onSaveNewSelection: () => void;
  onDiscardChanges: () => void;
  onIncludeZeroCountResultsChange: (selected: boolean) => void;
  onIncludeFullPrefixConstraintsChange: (selected: boolean) => void;
  children?: React.ReactNode;
}

export function ModelInspectionSection({
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
  onSelectTab,
  onDeleteSavedTab,
  onSaveSelection,
  onClearSelection,
  onUpdateSelection,
  onSaveNewSelection,
  onDiscardChanges,
  onIncludeZeroCountResultsChange,
  onIncludeFullPrefixConstraintsChange,
  children,
}: ModelInspectionSectionProps) {
  return (
    <section className="mt-5 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      <h3 className="text-lg font-semibold">Selected submodel inspection</h3>
      <section className="mt-3 rounded-t-md border border-b-0 border-neutral-300 bg-neutral-100 px-2 pt-2">
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
                    x
                  </Button>
                </span>
              </Tab>
            ))}
          </TabList>
        </Tabs>
      </section>

      <section className="-mt-px rounded-b-md border border-neutral-300 bg-white p-3">
        <p className="text-sm text-neutral-700">
          Selected nodes: <strong>{displayedSelectedCount}</strong>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {isCurrentQueryTab ? (
            <>
              <button
                type="button"
                className="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canSaveOrClearSelection}
                onClick={onSaveSelection}
              >
                Save selection
              </button>
              <button
                type="button"
                className="rounded-md border border-neutral-500 bg-neutral-100 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!canSaveOrClearSelection}
                onClick={onClearSelection}
              >
                Clear selection
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
                Update selection
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
        <div className="mt-3 flex flex-col gap-2">
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
                  {isSelected ? "✓" : ""}
                </span>
                <span>include zero count results</span>
              </>
            )}
          </Checkbox>
          <Checkbox
            isSelected={includeFullPrefixConstraints}
            isDisabled={disableIncludeFullPrefixConstraints}
            onChange={onIncludeFullPrefixConstraintsChange}
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
                  {isSelected ? "✓" : ""}
                </span>
                <span>
                  include full prefix constraints when central node is not a top model
                </span>
              </>
            )}
          </Checkbox>
        </div>

        {children}
      </section>
    </section>
  );
}

export type { SavedQueryTabView };
