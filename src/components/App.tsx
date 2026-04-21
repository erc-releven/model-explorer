import { createTheme, CssBaseline, ThemeProvider } from "@mui/material";
import type {} from "@mui/x-data-grid/themeAugmentation";
import { useEffect, useMemo, useRef } from "react";

import { useScenario } from "../scenario";
import {
  parseModelStateFromSearch,
  serializeModelStateToSearch,
} from "../serializer/url";
import { ModelViewer } from "./ModelViewer/ModelViewer";

export function App() {
  const [modelState, dispatchModelState] = useScenario();
  const didHydrateFromUrl = useRef(false);
  const muiTheme = useMemo(() => createTheme(), []);

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

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <div className="mx-auto flex min-h-full w-full flex-col gap-4 p-4">
        <div className="min-h-0 flex-1">
          <ModelViewer
            dispatchModelState={dispatchModelState}
            scenario={modelState}
          />
        </div>
      </div>
    </ThemeProvider>
  );
}
