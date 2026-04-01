import {
  Button,
  Checkbox,
  Divider,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
} from "@mui/material";
import { type NodeProps, Position } from "@xyflow/react";
import { useMemo, useState, type MouseEvent } from "react";

import type { PathNodeExpansionOption } from "../../../serializer/graph";
import { abbreviateType } from "../../../serializer/prefixes";
import { graphNodeBorderColors } from "../../../theme/colors";
import type { GraphNode as FlowGraphNode } from "../graph-layout";
import { HiddenHandle } from "./HiddenHandle";
import { HoverTooltip } from "./HoverTooltip";

function renderExpansionIcon(
  direction: "top" | "bottom",
  visibleCount: number,
  totalCount: number,
) {
  if (direction === "top") {
    if (visibleCount === 0) {
      return <span className="text-sm leading-none">△</span>;
    }

    if (visibleCount === totalCount) {
      return <span className="text-sm leading-none">▲</span>;
    }

    return <span className="text-sm leading-none">◭</span>;
  }

  if (visibleCount === 0) {
    return <span className="text-sm leading-none">▽</span>;
  }

  if (visibleCount === totalCount) {
    return <span className="text-sm leading-none">▼</span>;
  }

  return <span className="inline-block rotate-180 text-sm leading-none">◭</span>;
}

function getExpansionTooltip(
  direction: "top" | "bottom",
  visibleCount: number,
  totalCount: number,
  options: Array<PathNodeExpansionOption>,
): string {
  if (totalCount === 1) {
    const option = options[0];
    const targetLabel = direction === "top" ? "parent" : "child";

    if (option == null) {
      return targetLabel;
    }

    return option.visible ? `hide ${targetLabel}: ${option.label}` : `show ${targetLabel}: ${option.label}`;
  }

  const label = direction === "top" ? "parents" : "children";

  if (visibleCount === 0) {
    return `show ${String(totalCount)} available ${label}; shift-click to show all`;
  }

  if (visibleCount === totalCount) {
    return `all ${String(totalCount)} ${label} visible; shift-click to hide all`;
  }

  return `${String(visibleCount)} of ${String(totalCount)} ${label} visible; shift-click to show all`;
}

interface ExpansionMenuProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  options: Array<PathNodeExpansionOption>;
  onClose: () => void;
  onToggle: (optionPath: Array<string>) => void;
  onToggleAll: (nextVisible: boolean) => void;
}

function ExpansionMenu({
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
          onClick={(event) => {
            event.stopPropagation();
            onToggleAll(!allVisible);
          }}
          sx={{ minHeight: 28, px: 1 }}
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
            onClick={(event) => {
              event.stopPropagation();
              if (!option.disabled) {
                onToggle(option.path);
              }
            }}
            disabled={option.disabled}
            sx={{ minHeight: 28, px: 1 }}
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

export function GraphNode({ data }: NodeProps<FlowGraphNode>) {
  const nodeBorderColor =
    data.selected === "count"
      ? graphNodeBorderColors.count
      : data.selected != null
        ? graphNodeBorderColors.selected
        : graphNodeBorderColors.default;
  const [topAnchor, setTopAnchor] = useState<HTMLElement | null>(null);
  const [bottomAnchor, setBottomAnchor] = useState<HTMLElement | null>(null);
  const actionableTopOptions = useMemo(() => {
    return data.topExpansionOptions.filter((option) => !option.disabled);
  }, [data.topExpansionOptions]);
  const actionableBottomOptions = useMemo(() => {
    return data.bottomExpansionOptions.filter((option) => !option.disabled);
  }, [data.bottomExpansionOptions]);
  const topVisibleCount = useMemo(() => {
    return actionableTopOptions.filter((option) => option.visible).length;
  }, [actionableTopOptions]);
  const bottomVisibleCount = useMemo(() => {
    return actionableBottomOptions.filter((option) => option.visible).length;
  }, [actionableBottomOptions]);
  const allTopVisible =
    actionableTopOptions.length > 0 && topVisibleCount === actionableTopOptions.length;
  const allBottomVisible =
    actionableBottomOptions.length > 0 &&
    bottomVisibleCount === actionableBottomOptions.length;
  const buttonSx = {
    bgcolor: "background.paper",
    borderColor: nodeBorderColor,
    borderRadius: 1,
    color: nodeBorderColor,
    height: 24,
    minWidth: 0,
    p: 0,
    width: 24,
    "&:hover": {
      borderColor: nodeBorderColor,
    },
  };

  function onOpenTopMenu(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();

    if (event.shiftKey && actionableTopOptions.length >= 2) {
      data.onSetTopOptionsVisibility(
        data.id_array,
        actionableTopOptions.map((option) => option.path),
        !allTopVisible,
      );
      return;
    }

    if (actionableTopOptions.length === 1) {
      data.onToggleTopOption(data.id_array, actionableTopOptions[0]!.path);
      return;
    }

    setTopAnchor(event.currentTarget);
  }

  function onOpenBottomMenu(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();

    if (event.shiftKey && actionableBottomOptions.length >= 2) {
      data.onSetBottomOptionsVisibility(
        data.id_array,
        actionableBottomOptions.map((option) => option.path),
        !allBottomVisible,
      );
      return;
    }

    if (actionableBottomOptions.length === 1) {
      data.onToggleBottomOption(data.id_array, actionableBottomOptions[0]!.path);
      return;
    }

    setBottomAnchor(event.currentTarget);
  }

  return (
    <div>
      <HiddenHandle id="top" position={Position.Top} type="target" />
      {actionableTopOptions.length > 0 ? (
        <HoverTooltip
          title={getExpansionTooltip(
            "top",
            topVisibleCount,
            actionableTopOptions.length,
            actionableTopOptions,
          )}
        >
          <Button
            aria-label="Expand upwards"
            size="small"
            sx={{
              left: "50%",
              position: "absolute",
              top: 0,
              transform: "translate(-50%, -100%)",
              ...buttonSx,
            }}
            variant="outlined"
            onClick={onOpenTopMenu}
          >
            {renderExpansionIcon("top", topVisibleCount, actionableTopOptions.length)}
          </Button>
        </HoverTooltip>
      ) : null}
      <div
        className="relative min-w-[12rem] rounded-panel border bg-surface px-4 py-3 text-center text-text-strong shadow-sm"
        style={{ borderColor: nodeBorderColor }}
        onClick={(event) => {
          data.onSelectNode(data.id_array, event.shiftKey);
        }}
      >
        <div className="inline-block w-full">
          <div className="flex items-start justify-between gap-2 text-left">
            <HoverTooltip placement="top" title={data.id_array.join(" ")}>
              <span className="block text-sm font-semibold">{data.targetPath.name}</span>
            </HoverTooltip>
            <HoverTooltip
              placement="top"
              title={
                data.countDistinct == null || data.countTotal == null
                  ? "fetching instance count..."
                  : `${String(data.countDistinct)} distinct instances, ${String(data.countTotal)} instances total`
              }
            >
              <span className="rounded bg-surface-alt px-2 py-0.5 font-mono text-xs text-muted">
                {data.countDistinct == null || data.countTotal == null
                  ? "..."
                  : data.countDistinct === data.countTotal
                    ? String(data.countTotal)
                    : `${String(data.countDistinct)} / ${String(data.countTotal)}`}
              </span>
            </HoverTooltip>
          </div>
          <code className="mt-1 block rounded bg-surface-alt px-2 py-1 font-mono text-xs text-muted">
            {abbreviateType(data.targetPath.rdf_type)}
          </code>
        </div>
      </div>
      {actionableBottomOptions.length > 0 ? (
        <HoverTooltip
          title={getExpansionTooltip(
            "bottom",
            bottomVisibleCount,
            actionableBottomOptions.length,
            actionableBottomOptions,
          )}
        >
          <Button
            aria-label="Expand downwards"
            size="small"
            sx={{
              bottom: 0,
              left: "50%",
              position: "absolute",
              transform: "translate(-50%, 100%)",
              ...buttonSx,
            }}
            variant="outlined"
            onClick={onOpenBottomMenu}
          >
            {renderExpansionIcon(
              "bottom",
              bottomVisibleCount,
              actionableBottomOptions.length,
            )}
          </Button>
        </HoverTooltip>
      ) : null}
      {actionableTopOptions.length > 1 ? (
        <ExpansionMenu
          anchorEl={topAnchor}
          open={topAnchor != null}
          options={data.topExpansionOptions}
          onClose={() => {
            setTopAnchor(null);
          }}
          onToggleAll={(nextVisible) => {
            data.onSetTopOptionsVisibility(
              data.id_array,
              actionableTopOptions.map((option) => option.path),
              nextVisible,
            );
          }}
          onToggle={(optionPath) => {
            data.onToggleTopOption(data.id_array, optionPath);
          }}
        />
      ) : null}
      {actionableBottomOptions.length > 1 ? (
        <ExpansionMenu
          anchorEl={bottomAnchor}
          open={bottomAnchor != null}
          options={data.bottomExpansionOptions}
          onClose={() => {
            setBottomAnchor(null);
          }}
          onToggleAll={(nextVisible) => {
            data.onSetBottomOptionsVisibility(
              data.id_array,
              actionableBottomOptions.map((option) => option.path),
              nextVisible,
            );
          }}
          onToggle={(optionPath) => {
            data.onToggleBottomOption(data.id_array, optionPath);
          }}
        />
      ) : null}
      <HiddenHandle id="bottom" position={Position.Bottom} type="source" />
    </div>
  );
}
