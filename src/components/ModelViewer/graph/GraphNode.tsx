import { Button } from "@mui/material";
import { type NodeProps, Position } from "@xyflow/react";
import { useMemo, useState, type MouseEvent } from "react";

import { abbreviateType } from "../../../serializer/prefixes";
import { graphNodeBorderColors } from "../../../theme/colors";
import type { GraphNode as FlowGraphNode } from "../graph-layout";
import { ExpansionMenu } from "./ExpansionMenu";
import { getExpansionTooltip, renderExpansionIcon } from "./expansion-ui";
import { HiddenHandle } from "./HiddenHandle";
import { HoverTooltip } from "./HoverTooltip";

export function GraphNode({ data }: NodeProps<FlowGraphNode>) {
  const nodeBorderColor =
    data.selected === "count"
      ? graphNodeBorderColors.count
      : data.selected != null
        ? graphNodeBorderColors.selected
        : graphNodeBorderColors.default;
  const [topAnchor, setTopAnchor] = useState<HTMLElement | null>(null);
  const [bottomAnchor, setBottomAnchor] = useState<HTMLElement | null>(null);
  // All real connections, excluding phantom "incoming" mirror entries — used for rendering.
  const displayTopOptions = useMemo(() => {
    return data.topExpansionOptions.filter(
      (option) => option.relationLabel !== "incoming",
    );
  }, [data.topExpansionOptions]);
  const displayBottomOptions = useMemo(() => {
    return data.bottomExpansionOptions.filter(
      (option) => option.relationLabel !== "incoming",
    );
  }, [data.bottomExpansionOptions]);
  // Subset of display options that can actually be toggled — excludes selection-locked ones.
  const toggleableTopOptions = useMemo(() => {
    return displayTopOptions.filter((option) => !option.disabled);
  }, [displayTopOptions]);
  const toggleableBottomOptions = useMemo(() => {
    return displayBottomOptions.filter((option) => !option.disabled);
  }, [displayBottomOptions]);
  const topVisibleCount = useMemo(() => {
    return displayTopOptions.filter((option) => option.visible).length;
  }, [displayTopOptions]);
  const bottomVisibleCount = useMemo(() => {
    return displayBottomOptions.filter((option) => option.visible).length;
  }, [displayBottomOptions]);
  const hasTopMenu = displayTopOptions.length > 1;
  const hasBottomMenu = displayBottomOptions.length > 1;
  const allTopVisible =
    displayTopOptions.length > 0 &&
    topVisibleCount === displayTopOptions.length;
  const allBottomVisible =
    displayBottomOptions.length > 0 &&
    bottomVisibleCount === displayBottomOptions.length;
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

    if (event.shiftKey && toggleableTopOptions.length >= 2) {
      data.onSetTopOptionsVisibility(
        data.id_array,
        toggleableTopOptions.map((option) => option.path),
        !allTopVisible,
      );
      return;
    }

    if (!hasTopMenu && toggleableTopOptions.length === 1) {
      data.onToggleTopOption(data.id_array, toggleableTopOptions[0]!.path);
      return;
    }

    setTopAnchor(event.currentTarget);
  }

  function onOpenBottomMenu(event: MouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();

    if (event.shiftKey && toggleableBottomOptions.length >= 2) {
      data.onSetBottomOptionsVisibility(
        data.id_array,
        toggleableBottomOptions.map((option) => option.path),
        !allBottomVisible,
      );
      return;
    }

    if (!hasBottomMenu && toggleableBottomOptions.length === 1) {
      data.onToggleBottomOption(
        data.id_array,
        toggleableBottomOptions[0]!.path,
      );
      return;
    }

    setBottomAnchor(event.currentTarget);
  }

  return (
    <div>
      <HiddenHandle id="top" position={Position.Top} type="target" />
      {displayTopOptions.length > 0 ? (
        <HoverTooltip
          title={getExpansionTooltip(
            "top",
            topVisibleCount,
            displayTopOptions.length,
            displayTopOptions,
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
            {renderExpansionIcon(
              "top",
              topVisibleCount,
              displayTopOptions.length,
            )}
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
              <span className="block text-sm font-semibold">
                {data.targetPath.name}
              </span>
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
      {displayBottomOptions.length > 0 ? (
        <HoverTooltip
          title={getExpansionTooltip(
            "bottom",
            bottomVisibleCount,
            displayBottomOptions.length,
            displayBottomOptions,
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
              displayBottomOptions.length,
            )}
          </Button>
        </HoverTooltip>
      ) : null}
      {hasTopMenu ? (
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
              toggleableTopOptions.map((option) => option.path),
              nextVisible,
            );
          }}
          onToggle={(optionPath) => {
            data.onToggleTopOption(data.id_array, optionPath);
          }}
        />
      ) : null}
      {hasBottomMenu ? (
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
              toggleableBottomOptions.map((option) => option.path),
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
