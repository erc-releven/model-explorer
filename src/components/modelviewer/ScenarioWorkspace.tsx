import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import SaveIcon from "@mui/icons-material/Save";
import { IconButton, Tab, Tabs } from "@mui/material";
import { type Dispatch, type ReactNode, useEffect, useState } from "react";

import {
  normalizeNodeState,
  normalizeSparqlConfig,
  type Scenario,
  type ScenarioAction,
} from "../../scenario";

interface ScenarioWorkspaceProps {
  children: ReactNode;
  dispatchModelState: Dispatch<ScenarioAction>;
  scenario: Scenario;
  workspaceResetToken: number;
}

interface StoredScenario {
  scenario: Scenario;
  name: string;
}

const localStorageKey = "releven:model-states";
const currentLocalStorageKey = "releven:model-state-current";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null;
}

function isStringArray(value: unknown): value is Array<string> {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function parseScenario(value: unknown): null | Scenario {
  if (!isRecord(value)) {
    return null;
  }

  const nodes = value.nodes;

  if (!Array.isArray(nodes) || nodes.some((node) => !isRecord(node) || !isStringArray(node.id))) {
    return null;
  }

  const normalizedNodes = nodes.map((node) => {
    const nodeRecord = node as Record<string, unknown>;

    return normalizeNodeState({
      id: nodeRecord.id as Array<string>,
      selected: nodeRecord.selected as Scenario["nodes"][number]["selected"],
    });
  });
  const normalizedSparqlConfig = normalizeSparqlConfig(
    isRecord(value.sparql) ? value.sparql : undefined,
  );
  const normalizedXmlSource = typeof value.xmlSource === "string" ? value.xmlSource : "";

  return {
    nodes: normalizedNodes,
    sparql: normalizedSparqlConfig,
    xmlSource: normalizedXmlSource,
  };
}

function parseStoredScenario(value: unknown): null | StoredScenario {
  if (!isRecord(value) || typeof value.name !== "string") {
    return null;
  }

  const parsedScenario = parseScenario(value.scenario);

  if (parsedScenario == null) {
    return null;
  }

  return { name: value.name, scenario: parsedScenario };
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
  scenario: scenario,
  workspaceResetToken,
}: ScenarioWorkspaceProps) {
  const createTabValue = "action:create";
  const [activeTab, setActiveTab] = useState("current");
  const [storedScenarios, setStoredScenarios] = useState<Array<StoredScenario>>([]);

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
    setActiveTab("current");
  }, [workspaceResetToken]);

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
      <div className="p-4">{children}</div>
    </div>
  );
}
