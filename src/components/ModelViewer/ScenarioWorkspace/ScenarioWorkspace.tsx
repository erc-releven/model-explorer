import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SaveIcon from "@mui/icons-material/Save";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  IconButton,
  Tab,
  Tabs,
} from "@mui/material";
import { type Dispatch, type ReactNode, useEffect, useRef, useState } from "react";

import type { Scenario, ScenarioAction } from "../../../scenario";
import { parseNamedScenario, parseScenario } from "../../../scenario-io";
import type { PathbuilderPath } from "../../../serializer/pathbuilder";
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
  const createTabValue = "action:create";
  const [activeTab, setActiveTab] = useState("current");
  const [isRootPanelExpanded, setIsRootPanelExpanded] = useState(true);
  const [storedScenarios, setStoredScenarios] = useState<Array<StoredScenario>>([]);
  const lastXmlSource = useRef(scenario.xmlSource);

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
    if (scenario.nodes.length === 0) {
      setIsRootPanelExpanded(true);
    }
  }, [scenario.nodes.length]);

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

  return (
    <div className="rounded-panel border border-ui-border">
      <div className="border-b border-ui-border px-3">
        <Tabs
          value={activeTab}
          onChange={(_event, nextValue: string) => {
            if (nextValue === createTabValue) {
              onSaveCurrentScenario();
              return;
            }

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
          }}
        >
          <Tab label="current" value="current" />
          {storedScenarios.map((entry) => (
            <Tab
              key={entry.name}
              label={
                activeTab === `saved:${entry.name}` ? (
                  <span className="inline-flex items-center gap-1">
                    <span>{entry.name}</span>
                    <IconButton
                      aria-label={`Save ${entry.name}`}
                      disabled={areScenariosEqual(scenario, entry.scenario)}
                      size="small"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onSaveStoredScenario(entry.name);
                      }}
                    >
                      <SaveIcon fontSize="inherit" />
                    </IconButton>
                    <IconButton
                      aria-label={`Delete ${entry.name}`}
                      size="small"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onDeleteStoredScenario(entry.name);
                      }}
                    >
                      <CloseIcon fontSize="inherit" />
                    </IconButton>
                  </span>
                ) : (
                  entry.name
                )
              }
              value={`saved:${entry.name}`}
            />
          ))}
          <Tab
            aria-label="Create named model state from current"
            icon={<AddIcon />}
            value={createTabValue}
          />
        </Tabs>
      </div>
      <div className="flex flex-col gap-4 p-4">
        <Accordion
          disableGutters
          expanded={scenario.nodes.length === 0 ? true : isRootPanelExpanded}
          onChange={(_event, expanded) => {
            if (scenario.nodes.length === 0) {
              return;
            }

            setIsRootPanelExpanded(expanded);
          }}
        >
          <AccordionSummary className="px-0" expandIcon={<ExpandMoreIcon />}>
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
              pathsWithReferences={pathsWithReferences}
              xmlLoadError={xmlLoadError}
            />
          </AccordionDetails>
        </Accordion>
        {children}
      </div>
    </div>
  );
}
