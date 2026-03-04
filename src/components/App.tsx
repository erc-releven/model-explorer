import DarkModeOutlined from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlined from "@mui/icons-material/LightModeOutlined";
import {
  createTheme,
  CssBaseline,
  IconButton,
  ThemeProvider,
  Tooltip,
} from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";

import { useScenario } from "../scenario";
import {
  parsePathbuilderXml,
  type Pathbuilder,
} from "../serializer/pathbuilder";
import {
  parseModelStateFromSearch,
  serializeModelStateToSearch,
} from "../serializer/url";
import { resolveXmlSourceForFetch } from "../utils/resolve-xml-source";
import { ModelViewer } from "./ModelViewer";
import { XmlLoader } from "./XmlLoader";

export function App() {
  const [modelState, dispatchModelState] = useScenario();
  const [mode, setMode] = useState<"dark" | "light">("light");
  const [parsedXmlSource, setParsedXmlSource] = useState<null | Pathbuilder>(
    null,
  );
  const [workspaceResetToken, setWorkspaceResetToken] = useState(0);
  const lastParsedXmlSource = useRef("");
  const didHydrateFromUrl = useRef(false);
  const muiTheme = useMemo(() => createTheme({ palette: { mode } }), [mode]);

  function onParsedXmlSourceChange(
    parsedXmlSource: Pathbuilder,
    source: string,
  ): void {
    setParsedXmlSource(parsedXmlSource);
    lastParsedXmlSource.current = source;
  }

  useEffect(() => {
    const parsedModelState = parseModelStateFromSearch(window.location.search);
    dispatchModelState({
      payload: { scenario: parsedModelState },
      type: "state/replace",
    });
  }, [dispatchModelState]);

  useEffect(() => {
    if (!didHydrateFromUrl.current) {
      return;
    }

    const nextSearch = serializeModelStateToSearch(modelState);

    if (nextSearch === window.location.search) {
      return;
    }

    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);
  }, [modelState]);

  useEffect(() => {
    didHydrateFromUrl.current = true;
  }, []);

  useEffect(() => {
    async function loadAndParseXmlSource(): Promise<void> {
      const rawSource = modelState.xmlSource.trim();

      if (rawSource.length === 0 || rawSource === lastParsedXmlSource.current) {
        return;
      }

      const source = resolveXmlSourceForFetch(rawSource);
      const response = await fetch(source);

      if (!response.ok) {
        throw new Error(
          `Failed to load default XML (${String(response.status)}).`,
        );
      }

      const xmlContent = await response.text();
      const parsedXmlSource = parsePathbuilderXml(xmlContent);

      onParsedXmlSourceChange(parsedXmlSource, rawSource);
    }

    void loadAndParseXmlSource();
  }, [modelState.xmlSource]);

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <div className="mx-auto flex min-h-full w-full max-w-screen-3xl flex-col gap-4 p-4">
        <div className="flex items-center justify-end">
          <Tooltip
            title={`Switch to ${mode === "light" ? "dark" : "light"} mode`}
          >
            <IconButton
              aria-label="Toggle color mode"
              size="small"
              onClick={() => {
                setMode((currentMode) =>
                  currentMode === "light" ? "dark" : "light",
                );
              }}
            >
              {mode === "light" ? <DarkModeOutlined /> : <LightModeOutlined />}
            </IconButton>
          </Tooltip>
        </div>
        <div>
          <XmlLoader
            dispatchModelState={dispatchModelState}
            onParsedXmlSourceChange={onParsedXmlSourceChange}
            onXmlLoaded={() => {
              setWorkspaceResetToken((current) => current + 1);
            }}
          />
        </div>
        <div className="min-h-0 flex-1">
          <ModelViewer
            dispatchModelState={dispatchModelState}
            scenario={modelState}
            pathbuilder={parsedXmlSource}
            workspaceResetToken={workspaceResetToken}
          />
        </div>
      </div>
    </ThemeProvider>
  );
}
