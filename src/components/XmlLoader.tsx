import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { type ChangeEvent, type Dispatch, useState } from "react";

import { defaultScenario, type ScenarioAction } from "../scenario";
import {
  parsePathbuilderXml,
  type Pathbuilder,
} from "../serializer/pathbuilder";
import { resolveXmlSourceForFetch } from "../utils/resolve-xml-source";

interface XmlLoaderProps {
  dispatchModelState: Dispatch<ScenarioAction>;
  onParsedXmlSourceChange: (
    parsedXmlSource: Pathbuilder,
    source: string,
  ) => void;
  onXmlLoaded: () => void;
}

interface LoadResult {
  source: string;
}

const xmlShortcuts = [
  "releven_expanded_20251216.xml",
  "releven_inferred_20260219.xml",
] as const;

export function XmlLoader({
  dispatchModelState,
  onParsedXmlSourceChange,
  onXmlLoaded,
}: XmlLoaderProps) {
  const [isUrlLoading, setIsUrlLoading] = useState(false);
  const [isUrlDialogOpen, setIsUrlDialogOpen] = useState(false);
  const [loadError, setLoadError] = useState<null | string>(null);
  const [loadResult, setLoadResult] = useState<LoadResult | null>(null);
  const [urlInput, setUrlInput] = useState("");

  function handleParsedXml(xmlContent: string, source: string): void {
    const parsedPathbuilderXml = parsePathbuilderXml(xmlContent);

    setLoadError(null);
    onParsedXmlSourceChange(parsedPathbuilderXml, source);
    dispatchModelState({
      payload: {
        scenario: {
          ...defaultScenario,
          xmlSource: source,
        },
      },
      type: "state/replace",
    });
    onXmlLoaded();
    setLoadResult({ source });
  }

  async function onFileSelected(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const selectedFile = event.target.files?.[0];
    event.target.value = "";

    if (selectedFile == null) {
      return;
    }

    try {
      const xmlContent = await selectedFile.text();
      handleParsedXml(xmlContent, selectedFile.name);
    } catch (error: unknown) {
      setLoadResult(null);
      setLoadError(
        error instanceof Error
          ? error.message
          : "Failed to load the selected XML file.",
      );
    }
  }

  async function onLoadFromUrl(): Promise<void> {
    const normalizedUrl = urlInput.trim();

    if (normalizedUrl.length === 0) {
      setLoadResult(null);
      setLoadError("Please enter a URL.");
      return;
    }

    setIsUrlLoading(true);

    try {
      await loadXmlFromUrl(normalizedUrl);
      setIsUrlDialogOpen(false);
    } catch (error: unknown) {
      setLoadResult(null);
      setLoadError(
        error instanceof Error ? error.message : "Failed to load XML from URL.",
      );
    } finally {
      setIsUrlLoading(false);
    }
  }

  async function loadXmlFromUrl(source: string): Promise<void> {
    const response = await fetch(source);

    if (!response.ok) {
      throw new Error(
        `Failed to download XML file (${String(response.status)}).`,
      );
    }

    const xmlContent = await response.text();
    handleParsedXml(xmlContent, source);
  }

  return (
    <div
      aria-label="XML loader"
      className="min-h-loader rounded-panel bg-surface-alt p-4 text-text-strong"
    >
      <Stack spacing={2}>
        <div className="flex flex-wrap items-center gap-2">
          <Typography
            component="h2"
            sx={{
              alignItems: "center",
              display: "flex",
              justifyContent: "center",
              lineHeight: 1.2,
              minHeight: 32,
              mr: 1,
            }}
            variant="subtitle1"
          >
            Load Pathbuilder File
          </Typography>
          <Button
            component="label"
            disabled={isUrlLoading}
            size="small"
            variant="contained"
          >
            Upload XML
            <input
              accept=".xml,text/xml,application/xml"
              hidden
              type="file"
              onChange={(event) => {
                void onFileSelected(event);
              }}
            />
          </Button>
          <Button
            disabled={isUrlLoading}
            size="small"
            variant="contained"
            onClick={() => {
              setIsUrlDialogOpen(true);
            }}
          >
            Load XML from URL
          </Button>

          {xmlShortcuts.map((shortcut) => (
            <Button
              key={shortcut}
              disabled={isUrlLoading}
              size="small"
              variant="outlined"
              onClick={() => {
                setIsUrlLoading(true);
                void loadXmlFromUrl(resolveXmlSourceForFetch(shortcut))
                  .catch((error: unknown) => {
                    setLoadResult(null);
                    setLoadError(
                      error instanceof Error
                        ? error.message
                        : "Failed to load XML from shortcut.",
                    );
                  })
                  .finally(() => {
                    setIsUrlLoading(false);
                  });
              }}
            >
              {shortcut}
            </Button>
          ))}
        </div>
        {loadError != null ? <Alert severity="error">{loadError}</Alert> : null}
        {loadResult != null ? (
          <Alert severity="success">{`Loaded ${loadResult.source}`}</Alert>
        ) : null}
      </Stack>
      <Dialog
        fullWidth
        maxWidth="sm"
        open={isUrlDialogOpen}
        onClose={() => {
          if (!isUrlLoading) {
            setIsUrlDialogOpen(false);
          }
        }}
      >
        <DialogTitle>Load XML from URL</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            className="mt-2"
            label="XML URL"
            placeholder="https://example.com/model.xml"
            size="small"
            value={urlInput}
            onChange={(event) => {
              setUrlInput(event.target.value);
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button
            disabled={isUrlLoading}
            onClick={() => {
              setIsUrlDialogOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            disabled={isUrlLoading}
            variant="contained"
            onClick={() => {
              void onLoadFromUrl();
            }}
          >
            {isUrlLoading ? "Loading..." : "Load XML"}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
