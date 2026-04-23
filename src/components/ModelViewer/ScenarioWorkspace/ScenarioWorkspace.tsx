import CloseIcon from "@mui/icons-material/Close";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DownloadIcon from "@mui/icons-material/Download";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SaveIcon from "@mui/icons-material/Save";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Tab,
  Tabs,
  Tooltip,
} from "@mui/material";
import { type Dispatch, type ReactNode, useEffect, useRef, useState } from "react";

import type { Scenario, ScenarioAction } from "../../../scenario";
import { parseNamedScenario, parseScenario } from "../../../scenario-io";
import type { PathbuilderPath } from "../../../serializer/pathbuilder";
import { buildTar } from "../../../utils/tar";
import { RootClassesPanel } from "./RootClassesPanel";
import { XmlLoader } from "./XmlLoader";

interface ScenarioWorkspaceProps {
  children: ReactNode;
  dispatchModelState: Dispatch<ScenarioAction>;
  isXmlLoading: boolean;
  instanceCountByPathId: Record<string, number>;
  loadedXmlSource: null | string;
  pathCount: number;
  pathsWithReferences: Array<PathbuilderPath>;
  rootClassCount: number;
  scenario: Scenario;
  xmlLoadError: null | string;
}

interface StoredScenario {
  scenario: Scenario;
  name: string;
}

const localStorageKey = "releven:model-states";
const currentLocalStorageKey = "releven:model-state-current";

function parseStoredScenario(value: unknown): null | StoredScenario {
  const parsedScenario = parseNamedScenario(value);

  if (parsedScenario?.name == null) {
    return null;
  }

  return {
    name: parsedScenario.name,
    scenario: parsedScenario.scenario,
  };
}

function writeStoredScenarios(states: Array<StoredScenario>): void {
  if (states.length === 0) {
    window.localStorage.removeItem(localStorageKey);
    return;
  }

  window.localStorage.setItem(localStorageKey, JSON.stringify(states));
}

function readStoredScenarios(): Array<StoredScenario> {
  const raw = window.localStorage.getItem(localStorageKey);

  if (raw == null) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      window.localStorage.removeItem(localStorageKey);
      return [];
    }

    const validStoredScenarios = parsed
      .map((entry) => parseStoredScenario(entry))
      .filter((entry): entry is StoredScenario => entry != null);

    if (validStoredScenarios.length !== parsed.length) {
      writeStoredScenarios(validStoredScenarios);
    }

    return validStoredScenarios;
  } catch {
    window.localStorage.removeItem(localStorageKey);
    return [];
  }
}

function readCurrentScenario(): Scenario | null {
  const raw = window.localStorage.getItem(currentLocalStorageKey);

  if (raw == null) {
    return null;
  }

  try {
    const parsedScenario = parseScenario(JSON.parse(raw) as unknown);

    if (parsedScenario == null) {
      window.localStorage.removeItem(currentLocalStorageKey);
      return null;
    }

    return parsedScenario;
  } catch {
    window.localStorage.removeItem(currentLocalStorageKey);
    return null;
  }
}

function areScenariosEqual(left: Scenario, right: Scenario): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function ScenarioWorkspace({
  children,
  dispatchModelState,
  isXmlLoading,
  instanceCountByPathId,
  loadedXmlSource,
  pathCount,
  pathsWithReferences,
  rootClassCount,
  scenario: scenario,
  xmlLoadError,
}: ScenarioWorkspaceProps) {
  const [activeTab, setActiveTab] = useState("current");
  const [isRootPanelExpanded, setIsRootPanelExpanded] = useState(true);
  const [pendingDeleteName, setPendingDeleteName] = useState<null | string>(null);
  const [storedScenarios, setStoredScenarios] = useState<Array<StoredScenario>>([]);
  const lastXmlSource = useRef(scenario.xmlSource);
  const activeSavedScenarioName = activeTab.startsWith("saved:")
    ? activeTab.slice("saved:".length)
    : null;
  const activeStoredScenario =
    activeSavedScenarioName == null
      ? null
      : (storedScenarios.find((entry) => entry.name === activeSavedScenarioName) ?? null);
  const hasVisibleRootModel = scenario.nodes.some((node) => {
    return node.id.length === 1;
  });
  const isRootPanelDisclosureDisabled = !hasVisibleRootModel;

  useEffect(() => {
    setStoredScenarios(readStoredScenarios());
  }, []);

  useEffect(() => {
    if (activeTab !== "current") {
      return;
    }

    window.localStorage.setItem(currentLocalStorageKey, JSON.stringify(scenario));
  }, [activeTab, scenario]);

  useEffect(() => {
    if (lastXmlSource.current === scenario.xmlSource) {
      return;
    }

    lastXmlSource.current = scenario.xmlSource;
    setActiveTab("current");
  }, [scenario.xmlSource]);

  useEffect(() => {
    if (!hasVisibleRootModel) {
      setIsRootPanelExpanded(true);
    }
  }, [hasVisibleRootModel]);

  function onSaveCurrentScenario(): void {
    const name = window.prompt("Enter a name for the current model state:");

    if (name == null) {
      return;
    }

    const trimmedName = name.trim();

    if (trimmedName.length === 0) {
      return;
    }

    const nextStoredScenario = [
      ...storedScenarios.filter((entry) => entry.name !== trimmedName),
      { scenario: scenario, name: trimmedName },
    ];

    setStoredScenarios(nextStoredScenario);
    writeStoredScenarios(nextStoredScenario);
    setActiveTab(`saved:${trimmedName}`);
  }

  function onSaveStoredScenario(name: string): void {
    const nextStoredStates = storedScenarios.map((entry) => {
      if (entry.name !== name) {
        return entry;
      }

      return { ...entry, scenario: scenario };
    });

    setStoredScenarios(nextStoredStates);
    writeStoredScenarios(nextStoredStates);
  }

  function onDeleteStoredScenario(name: string): void {
    const nextStoredStates = storedScenarios.filter((entry) => entry.name !== name);

    setStoredScenarios(nextStoredStates);
    writeStoredScenarios(nextStoredStates);

    if (activeTab === `saved:${name}`) {
      setActiveTab("current");
    }
  }

  function downloadAllScenarios(): void {
    const tar = buildTar(
      storedScenarios.map((entry) => ({
        content: JSON.stringify(entry.scenario, null, 2),
        name: `${entry.name}.json`,
      })),
    );
    const url = URL.createObjectURL(
      new Blob([tar.buffer as ArrayBuffer], { type: "application/x-tar" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    const timestamp = new Date().toISOString().replace("T", "_").replace(/:/g, "-").slice(0, 19);
    anchor.download = `scenarios_${timestamp}.tar`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadScenario(scenarioToDownload: Scenario, name: string): void {
    const blob = new Blob([JSON.stringify(scenarioToDownload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${name}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function onDuplicateStoredScenario(name: string): void {
    const source = storedScenarios.find((entry) => entry.name === name);

    if (source == null) {
      return;
    }

    const newName = window.prompt("Enter a name for the duplicate:", name);

    if (newName == null) {
      return;
    }

    const trimmedName = newName.trim();

    if (trimmedName.length === 0) {
      return;
    }

    const nextStoredStates = [
      ...storedScenarios.filter((entry) => entry.name !== trimmedName),
      { name: trimmedName, scenario: source.scenario },
    ];

    setStoredScenarios(nextStoredStates);
    writeStoredScenarios(nextStoredStates);
    setActiveTab(`saved:${trimmedName}`);
  }

  return (
    <div className="rounded-panel border border-ui-border">
      <div className="flex items-center border-b border-ui-border px-3">
        <Tabs
          value={activeTab}
          onChange={(_event, nextValue: string) => {
            setActiveTab(nextValue);

            if (nextValue === "current") {
              const currentScenario = readCurrentScenario();

              if (currentScenario != null) {
                dispatchModelState({
                  payload: { scenario: currentScenario },
                  type: "state/replace",
                });
              }

              return;
            }

            if (!nextValue.startsWith("saved:")) {
              return;
            }

            const targetName = nextValue.slice("saved:".length);
            const targetState = storedScenarios.find((entry) => entry.name === targetName);

            if (targetState == null) {
              return;
            }

            const parsedScenario = parseScenario(targetState.scenario);

            if (parsedScenario == null) {
              onDeleteStoredScenario(targetName);
              setActiveTab("current");
              return;
            }

            dispatchModelState({
              payload: { scenario: parsedScenario },
              type: "state/replace",
            });
            setIsRootPanelExpanded(false);
          }}
        >
          <Tab
            value="current"
            label={
              activeTab === "current" ? (
                <span className="flex items-center gap-1">
                  current
                  <Tooltip title="Save current scenario as a named state">
                    <IconButton
                      aria-label="Save current scenario as a named state"
                      size="small"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSaveCurrentScenario();
                      }}
                    >
                      <SaveIcon fontSize="inherit" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Download current scenario">
                    <IconButton
                      aria-label="Download current scenario"
                      size="small"
                      onClick={(event) => {
                        event.stopPropagation();
                        downloadScenario(scenario, "current");
                      }}
                    >
                      <DownloadIcon fontSize="inherit" />
                    </IconButton>
                  </Tooltip>
                </span>
              ) : (
                "current"
              )
            }
          />
          {storedScenarios.map((entry) => {
            const isActive = activeTab === `saved:${entry.name}`;
            return (
              <Tab
                key={entry.name}
                value={`saved:${entry.name}`}
                label={
                  <span className="flex items-center gap-1">
                    {entry.name}
                    {isActive ? (
                      <>
                        <Tooltip title={`Download ${entry.name}`}>
                          <IconButton
                            aria-label={`Download ${entry.name}`}
                            size="small"
                            onClick={(event) => {
                              event.stopPropagation();
                              downloadScenario(scenario, entry.name);
                            }}
                          >
                            <DownloadIcon fontSize="inherit" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={`Save current state as ${entry.name}`}>
                          <span>
                            <IconButton
                              aria-label={`Save ${entry.name}`}
                              disabled={
                                activeStoredScenario == null ||
                                areScenariosEqual(scenario, activeStoredScenario.scenario)
                              }
                              size="small"
                              onClick={(event) => {
                                event.stopPropagation();
                                onSaveStoredScenario(entry.name);
                              }}
                            >
                              <SaveIcon fontSize="inherit" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title={`Duplicate ${entry.name}`}>
                          <IconButton
                            aria-label={`Duplicate ${entry.name}`}
                            size="small"
                            onClick={(event) => {
                              event.stopPropagation();
                              onDuplicateStoredScenario(entry.name);
                            }}
                          >
                            <ContentCopyIcon fontSize="inherit" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={`Delete ${entry.name}`}>
                          <IconButton
                            aria-label={`Delete ${entry.name}`}
                            size="small"
                            onClick={(event) => {
                              event.stopPropagation();
                              setPendingDeleteName(entry.name);
                            }}
                          >
                            <CloseIcon fontSize="inherit" />
                          </IconButton>
                        </Tooltip>
                      </>
                    ) : null}
                  </span>
                }
              />
            );
          })}
        </Tabs>
        <div className="ml-auto">
          {storedScenarios.length > 0 ? (
            <Tooltip title="Download all saved scenarios as tar">
              <IconButton
                aria-label="Download all saved scenarios as tar"
                size="small"
                onClick={downloadAllScenarios}
              >
                <DownloadIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-4 p-4">
        <Accordion
          disableGutters
          expanded={isRootPanelDisclosureDisabled || isRootPanelExpanded}
          onChange={(_event, expanded) => {
            if (isRootPanelDisclosureDisabled) {
              return;
            }

            setIsRootPanelExpanded(expanded);
          }}
        >
          <AccordionSummary
            className="px-0"
            expandIcon={<ExpandMoreIcon />}
            sx={{
              "& .MuiAccordionSummary-expandIconWrapper": {
                opacity: isRootPanelDisclosureDisabled ? 0.38 : 1,
              },
            }}
          >
            <XmlLoader
              currentXmlSource={scenario.xmlSource}
              dispatchModelState={dispatchModelState}
              isLoading={isXmlLoading}
              loadError={xmlLoadError}
              loadedSource={loadedXmlSource}
              pathCount={pathCount}
              rootClassCount={rootClassCount}
            />
          </AccordionSummary>
          <AccordionDetails className="px-0 pt-0">
            <RootClassesPanel
              dispatchModelState={dispatchModelState}
              instanceCountByPathId={instanceCountByPathId}
              onRootClassSelected={() => {
                setIsRootPanelExpanded(false);
              }}
              pathsWithReferences={pathsWithReferences}
              xmlLoadError={xmlLoadError}
            />
          </AccordionDetails>
        </Accordion>
        {children}
      </div>
      <Dialog
        open={pendingDeleteName != null}
        onClose={() => {
          setPendingDeleteName(null);
        }}
      >
        <DialogTitle>Delete saved state</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {`Delete "${pendingDeleteName ?? ""}"? This cannot be undone.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setPendingDeleteName(null);
            }}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="outlined"
            onClick={() => {
              if (pendingDeleteName != null) {
                onDeleteStoredScenario(pendingDeleteName);
              }
              setPendingDeleteName(null);
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
