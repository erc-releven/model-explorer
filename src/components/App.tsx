import DarkModeOutlined from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlined from "@mui/icons-material/LightModeOutlined";
import {
  createTheme,
  CssBaseline,
  IconButton,
  ThemeProvider,
  Tooltip,
} from "@mui/material";
import type {} from "@mui/x-data-grid/themeAugmentation";
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
  const muiTheme = useMemo(() => {
    const lightSurface = "rgb(255 255 255)";
    const lightSurfaceAlt = "rgb(245 246 250)";
    const lightDivider = "rgb(186 194 214)";
    const lightText = "rgb(0 6 38)";

    return createTheme({
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            body: {
              backgroundColor: mode === "light" ? "#f5f6fa" : "#11151d",
            },
          },
        },
        MuiDataGrid: {
          styleOverrides: {
            columnHeaders: {
              backgroundColor: mode === "light" ? lightDivider : "#1d2633",
              borderBottomColor: mode === "light" ? lightDivider : "#323f52",
              borderBottomStyle: "solid",
              borderBottomWidth: 2,
              color: mode === "light" ? lightText : "#e6edf8",
            },
            columnHeaderTitle: {
              fontWeight: 700,
            },
            root: {
              backgroundColor: mode === "light" ? lightSurface : "#161e2a",
              borderColor: mode === "light" ? lightDivider : "#323f52",
              color: mode === "light" ? lightText : "#e6edf8",
              "& .MuiDataGrid-cell": {
                borderBottomColor: mode === "light" ? lightDivider : "#323f52",
              },
              "& .MuiDataGrid-columnSeparator": {
                color: mode === "light" ? lightDivider : "#323f52",
              },
              "& .MuiDataGrid-footerContainer": {
                backgroundColor: mode === "light" ? lightSurfaceAlt : "#1d2633",
                borderTopColor: mode === "light" ? lightDivider : "#323f52",
              },
              "& .MuiDataGrid-row:hover": {
                backgroundColor: mode === "light" ? lightSurfaceAlt : "#202b3b",
              },
            },
            row: {
              backgroundColor: mode === "light" ? lightSurface : "#161e2a",
              "&:nth-of-type(even)": {
                backgroundColor: mode === "light" ? lightSurfaceAlt : "#1b2534",
              },
              "&.Mui-selected": {
                backgroundColor: mode === "light" ? lightSurfaceAlt : "#1d2633",
              },
              "&.Mui-selected:hover": {
                backgroundColor: mode === "light" ? lightSurfaceAlt : "#202b3b",
              },
            },
          },
        },
        MuiIconButton: {
          styleOverrides: {
            root: ({ ownerState }) => {
              const isSecondary = ownerState.color === "secondary";

              return {
                alignSelf: "center",
                backgroundColor: mode === "light" ? "#ffffff" : "#161e2a",
                border: "1px solid",
                borderColor: isSecondary
                  ? mode === "light"
                    ? "rgb(143 108 26)"
                    : "rgb(224 190 112)"
                  : mode === "light"
                    ? "rgb(0 17 102)"
                    : "#323f52",
                borderRadius: 8,
                color: isSecondary
                  ? mode === "light"
                    ? "#8f6c1a"
                    : "#e0be70"
                  : mode === "light"
                    ? "#2d3a68"
                    : "#e6edf8",
                "&:hover": {
                  backgroundColor: isSecondary
                    ? mode === "light"
                      ? "rgb(255 192 46)"
                      : "rgb(143 108 26)"
                    : mode === "light"
                      ? "rgb(0 21 128)"
                      : "#202b3b",
                },
              };
            },
          },
        },
        MuiTab: {
          styleOverrides: {
            root: {
              color: mode === "light" ? "rgb(0 9 51)" : "#9fb0c8",
              textTransform: "none",
              "&.Mui-selected": {
                color: mode === "light" ? "#2d3a68" : "#ffffff",
              },
            },
          },
        },
        MuiTabs: {
          styleOverrides: {
            indicator: {
              backgroundColor: mode === "light" ? "#4c64d9" : "#a3b2ff",
            },
          },
        },
        MuiTextField: {
          defaultProps: {
            variant: "outlined",
          },
        },
        MuiToggleButton: {
          styleOverrides: {
            root: ({ ownerState }) => {
              const isSecondary = ownerState.color === "secondary";

              return {
                borderColor: isSecondary
                  ? mode === "light"
                    ? "rgb(143 108 26)"
                    : "rgb(224 190 112)"
                  : mode === "light"
                    ? "rgb(0 17 102)"
                    : "#323f52",
                color: isSecondary
                  ? mode === "light"
                    ? "#8f6c1a"
                    : "#e0be70"
                  : mode === "light"
                    ? "#000933a6"
                    : "#9fb0c8",
                "&.Mui-selected": {
                  backgroundColor: isSecondary
                    ? mode === "light"
                      ? "#8f6c1a"
                      : "#e0be70"
                    : mode === "light"
                      ? "#4c64d9"
                      : "#2d3a68",
                  color: "#ffffff",
                  "&:hover": {
                    backgroundColor: isSecondary
                      ? mode === "light"
                        ? "#725615"
                        : "#caa85f"
                      : mode === "light"
                        ? "#475f9a"
                        : "#4c64d9",
                  },
                },
                "&:hover": {
                  backgroundColor: isSecondary
                    ? mode === "light"
                      ? "rgb(255 192 46)"
                      : "rgb(224 190 112)"
                    : mode === "light"
                      ? "rgb(0 21 128)"
                      : "#202b3b",
                },
              };
            },
          },
        },
      },
      palette: {
        background: {
          default: mode === "light" ? "#f5f6fa" : "#11151d",
          paper: mode === "light" ? "#ffffff" : "#161e2a",
        },
        divider: mode === "light" ? "rgb(0 17 102)" : "#323f52",
        mode,
        primary: {
          dark: mode === "light" ? "#2d3a68" : "#4c64d9",
          main: mode === "light" ? "#4c64d9" : "#a3b2ff",
        },
        secondary: {
          dark: mode === "light" ? "#725615" : "#caa85f",
          main: mode === "light" ? "#8f6c1a" : "#e0be70",
        },
        success: {
          main: "#067a57",
        },
        text: {
          primary: mode === "light" ? "rgb(0 6 38)" : "#e6edf8",
          secondary: mode === "light" ? "rgb(0 9 51)" : "#9fb0c8",
        },
      },
      shape: {
        borderRadius: 8,
      },
    });
  }, [mode]);

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
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <XmlLoader
              dispatchModelState={dispatchModelState}
              onParsedXmlSourceChange={onParsedXmlSourceChange}
              onXmlLoaded={() => {
                setWorkspaceResetToken((current) => current + 1);
              }}
            />
          </div>
          <Tooltip
            title={`Switch to ${mode === "light" ? "dark" : "light"} mode`}
          >
            <IconButton
              aria-label="Toggle color mode"
              color="secondary"
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
