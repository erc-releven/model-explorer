import {
  Checkbox,
  Divider,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
} from "@mui/material";

import { abbreviateType } from "../../../serializer/prefixes";
import type { PathNodeExpansionOption } from "./expansion-options";

interface ExpansionMenuProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  options: Array<PathNodeExpansionOption>;
  onClose: () => void;
  onToggle: (optionPath: Array<string>) => void;
  onToggleAll: (nextVisible: boolean) => void;
}

export function ExpansionMenu({
  anchorEl,
  open,
  options,
  onClose,
  onToggle,
  onToggleAll,
}: ExpansionMenuProps) {
  const actionableOptions = options.filter((option) => !option.disabled);
  const visibleCount = actionableOptions.filter((option) => option.visible).length;
  const allVisible = actionableOptions.length > 0 && visibleCount === actionableOptions.length;
  const partiallyVisible = visibleCount > 0 && visibleCount < actionableOptions.length;

  return (
    <Menu anchorEl={anchorEl} open={open} onClose={onClose}>
      <List dense disablePadding sx={{ minWidth: 168 }}>
        <ListItemButton
          dense
          sx={{ minHeight: 28, px: 1 }}
          onClick={(event) => {
            event.stopPropagation();
            onToggleAll(!allVisible);
          }}
        >
          <ListItemIcon sx={{ minWidth: 24 }}>
            <Checkbox
              checked={allVisible}
              edge="start"
              indeterminate={partiallyVisible}
              size="small"
              tabIndex={-1}
              onClick={(event) => {
                event.stopPropagation();
              }}
              onChange={(event) => {
                event.stopPropagation();
                onToggleAll(!allVisible);
              }}
            />
          </ListItemIcon>
          <ListItemText
            primary="Show all"
            primaryTypographyProps={{ fontSize: 12, lineHeight: 1.1 }}
          />
        </ListItemButton>
        <Divider />
        {options.map((option) => (
          <ListItemButton
            key={option.id}
            dense
            disabled={option.disabled}
            sx={{ minHeight: 28, px: 1 }}
            onClick={(event) => {
              event.stopPropagation();
              if (!option.disabled) {
                onToggle(option.path);
              }
            }}
          >
            <ListItemIcon sx={{ minWidth: 24 }}>
              <Checkbox
                checked={option.visible}
                disabled={option.disabled}
                edge="start"
                size="small"
                tabIndex={-1}
                onClick={(event) => {
                  event.stopPropagation();
                }}
                onChange={(event) => {
                  event.stopPropagation();
                  if (!option.disabled) {
                    onToggle(option.path);
                  }
                }}
              />
            </ListItemIcon>
            <ListItemText
              primary={
                <div className="flex items-center gap-2">
                  <span>
                    {option.label}
                    {option.relationLabel != null ? ` (${option.relationLabel})` : ""}
                  </span>
                  <code className="rounded bg-surface-alt px-2 py-0.5 font-mono text-xs text-muted">
                    {abbreviateType(option.rdfType)}
                  </code>
                </div>
              }
              primaryTypographyProps={{ fontSize: 12, lineHeight: 1.1 }}
            />
          </ListItemButton>
        ))}
      </List>
    </Menu>
  );
}
