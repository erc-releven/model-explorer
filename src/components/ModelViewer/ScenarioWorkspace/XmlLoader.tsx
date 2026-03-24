import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import LinkIcon from "@mui/icons-material/Link";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  type ChangeEvent,
  type Dispatch,
  type MouseEvent,
  type SyntheticEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { defaultScenario, type ScenarioAction } from "../../../scenario";
import { resolveXmlSourceForFetch } from "../../../utils/resolve-xml-source";

interface XmlLoaderProps {
  currentXmlSource: string;
  dispatchModelState: Dispatch<ScenarioAction>;
  isLoading: boolean;
  loadError: null | string;
  loadedSource: null | string;
  pathCount: number;
  rootClassCount: number;
}

const xmlShortcuts = ["releven_expanded_20251216.xml", "releven_inferred_20260219.xml"] as const;

export function XmlLoader({
  currentXmlSource,
  dispatchModelState,
  isLoading,
  loadError,
  loadedSource,
  pathCount,
  rootClassCount,
}: XmlLoaderProps) {
  const [isUrlDialogOpen, setIsUrlDialogOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const createdObjectUrls = useRef(new Set<string>());

  useEffect(() => {
    return () => {
      for (const objectUrl of createdObjectUrls.current) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, []);

  function loadXmlSource(source: string): void {
    dispatchModelState({
      payload: {
        scenario: {
          ...defaultScenario,
          xmlSource: source,
        },
      },
      type: "state/replace",
    });
  }

  function onFileSelected(event: ChangeEvent<HTMLInputElement>): void {
    const selectedFile = event.target.files?.[0];
    event.target.value = "";

    if (selectedFile == null) {
      return;
    }

    const objectUrl = URL.createObjectURL(selectedFile);
    createdObjectUrls.current.add(objectUrl);
    loadXmlSource(objectUrl);
  }

  function onLoadFromUrl(): void {
    const normalizedUrl = urlInput.trim();

    if (normalizedUrl.length === 0) {
      return;
    }

    loadXmlSource(normalizedUrl);
    setIsUrlDialogOpen(false);
  }

  function onOpenMenu(event: MouseEvent<HTMLElement>): void {
    event.stopPropagation();
    setMenuAnchor(event.currentTarget);
  }

  function onCloseMenu(): void {
    setMenuAnchor(null);
  }

  function preventAccordionToggle(event: SyntheticEvent): void {
    event.stopPropagation();
  }

  const hasXmlSource = currentXmlSource.trim().length > 0;
  const displayedSource = loadedSource ?? currentXmlSource;

  return (
    <div
      aria-label="XML loader"
      className="rounded-panel bg-surface-alt px-3 py-2 text-text-strong"
      onClick={preventAccordionToggle}
      onFocus={preventAccordionToggle}
      onMouseDown={preventAccordionToggle}
    >
      <Stack spacing={2}>
        {hasXmlSource ? (
          <div className="flex min-h-8 flex-wrap items-center gap-2">
            <Typography
              component="p"
              sx={{
                alignItems: "center",
                display: "flex",
                flexWrap: "wrap",
                gap: 0.5,
                lineHeight: 1.2,
                minHeight: 32,
              }}
              variant="subtitle2"
            >
              <span>
                Pathbuilder: parsed
                {` ${String(pathCount)} paths and ${String(rootClassCount)} root classes from`}
              </span>
              <button
                className="inline-flex cursor-pointer items-center gap-1 rounded-panel border border-ui-border bg-surface px-2 py-1 text-left text-sm text-text-strong hover:bg-surface-hover"
                type="button"
                onMouseDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={onOpenMenu}
              >
                <code>{displayedSource}</code>
                <ExpandMoreIcon fontSize="inherit" />
              </button>
            </Typography>
          </div>
        ) : (
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
            <Button component="label" disabled={isLoading} size="small" variant="contained">
              Upload XML
              <input
                accept=".xml,text/xml,application/xml"
                hidden
                type="file"
                onChange={(event) => {
                  onFileSelected(event);
                }}
              />
            </Button>
            <Button
              disabled={isLoading}
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
                disabled={isLoading}
                size="small"
                variant="outlined"
                onClick={() => {
                  loadXmlSource(resolveXmlSourceForFetch(shortcut));
                }}
              >
                {shortcut}
              </Button>
            ))}
          </div>
        )}
        {loadError != null ? <Alert severity="error">{loadError}</Alert> : null}
      </Stack>
      <Menu
        anchorEl={menuAnchor}
        open={menuAnchor != null}
        onClose={(_event) => {
          onCloseMenu();
        }}
      >
        <MenuItem
          component="label"
          disabled={isLoading}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <ListItemIcon>
            <UploadFileIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Upload XML" />
          <input
            accept=".xml,text/xml,application/xml"
            hidden
            type="file"
            onChange={(event) => {
              onCloseMenu();
              onFileSelected(event);
            }}
          />
        </MenuItem>
        <MenuItem
          disabled={isLoading}
          onClick={(event) => {
            event.stopPropagation();
            onCloseMenu();
            setIsUrlDialogOpen(true);
          }}
        >
          <ListItemIcon>
            <LinkIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Load XML from URL" />
        </MenuItem>
        {xmlShortcuts.map((shortcut) => (
          <MenuItem
            key={shortcut}
            disabled={isLoading}
            onClick={(event) => {
              event.stopPropagation();
              onCloseMenu();
              loadXmlSource(resolveXmlSourceForFetch(shortcut));
            }}
          >
            <ListItemIcon>
              <InsertDriveFileOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary={<span className="font-mono text-sm">{shortcut}</span>}
            />
          </MenuItem>
        ))}
      </Menu>
      <Dialog
        fullWidth
        maxWidth="sm"
        open={isUrlDialogOpen}
        onClose={() => {
          if (!isLoading) {
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
            disabled={isLoading}
            onClick={() => {
              setIsUrlDialogOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            disabled={isLoading || urlInput.trim().length === 0}
            variant="contained"
            onClick={() => {
              onLoadFromUrl();
            }}
          >
            {isLoading ? "Loading..." : "Load XML"}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
