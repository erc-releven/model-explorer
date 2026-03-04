import { Alert, Button, Stack, TextField, Typography } from "@mui/material";
import { type ChangeEvent, type Dispatch, useState } from "react";

import {
  parsePathbuilderXml,
  type Pathbuilder,
} from "../serializer/pathbuilder";
import { defaultScenario, type ScenarioAction } from "../scenario";
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
    <div aria-label="XML loader" className="loader-shell min-h-loader p-4">
      <Stack spacing={2}>
        <Typography component="h2" variant="h6">
          XML Loader
        </Typography>
        <Stack spacing={1}>
          <Typography variant="subtitle2">Upload file</Typography>
          <Button
            component="label"
            size="small"
            sx={{ alignSelf: "flex-start" }}
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
        </Stack>
        <Stack spacing={1}>
          <Typography variant="subtitle2">Fixed files</Typography>
          <Stack direction="row" spacing={1}>
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
          </Stack>
        </Stack>
        <Stack spacing={1}>
          <Typography variant="subtitle2">Load from URL</Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              className="w-[28rem]"
              label="XML URL"
              placeholder="https://example.com/model.xml"
              size="small"
              value={urlInput}
              onChange={(event) => {
                setUrlInput(event.target.value);
              }}
            />
            <Button
              disabled={isUrlLoading}
              variant="contained"
              onClick={() => {
                void onLoadFromUrl();
              }}
            >
              {isUrlLoading ? "Loading..." : "Load XML"}
            </Button>
          </Stack>
        </Stack>
        {loadError != null ? <Alert severity="error">{loadError}</Alert> : null}
        {loadResult != null ? (
          <Alert severity="success">{`Loaded ${loadResult.source}`}</Alert>
        ) : null}
      </Stack>
    </div>
  );
}
