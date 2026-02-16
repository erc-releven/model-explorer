import {
  Background,
  Controls,
  type Edge,
  type Node,
  ReactFlow,
  type ReactFlowInstance,
} from "@xyflow/react";
import { Button } from "react-aria-components";

interface RootGroupOption {
  id: string;
  name: string;
}

interface ActiveGroupSummary {
  name: string;
  typeLabel: string;
}

interface GraphDisplaySectionProps {
  graphPathCount: number;
  xmlSourceLabel: string;
  sortedGroups: Array<RootGroupOption>;
  groupReferenceCounts: Record<string, number>;
  activeGroupId: string;
  onSelectGroup: (groupId: string) => void;
  showNoModelMessage: boolean;
  activeGroup: ActiveGroupSummary | null;
  flowViewportRef: React.RefObject<HTMLDivElement | null>;
  flow: { nodes: Array<Node>; edges: Array<Edge> } | null;
  onFlowInit: (instance: ReactFlowInstance) => void;
  onFlowNodeClick: (event: React.MouseEvent, node: Node) => void;
  children?: React.ReactNode;
}

export function GraphDisplaySection({
  graphPathCount,
  xmlSourceLabel,
  sortedGroups,
  groupReferenceCounts,
  activeGroupId,
  onSelectGroup,
  showNoModelMessage,
  activeGroup,
  flowViewportRef,
  flow,
  onFlowInit,
  onFlowNodeClick,
  children,
}: GraphDisplaySectionProps) {
  return (
    <>
      <section className="mt-4 rounded-t-xl border border-b-0 border-neutral-300 bg-neutral-50 px-3 py-2">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 pb-2 text-sm text-neutral-600">
          <span>
            Parsed <strong>{graphPathCount}</strong> paths from{" "}
            <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">
              {xmlSourceLabel}
            </code>
          </span>
        </div>
        <p className="mt-2 text-sm font-medium text-neutral-700">
          {`Choose one of ${String(sortedGroups.length)} root type(s) to begin exploring the model:`}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {sortedGroups.map((group) => (
            <Button
              key={group.id}
              className="rounded-full border border-neutral-400 bg-white px-2.5 py-1 text-xs font-medium text-neutral-900 shadow-sm hover:bg-neutral-100"
              onPress={() => {
                if (group.id === activeGroupId) {
                  return;
                }
                onSelectGroup(group.id);
              }}
            >
              {group.name} [{groupReferenceCounts[group.id] ?? 0}]
            </Button>
          ))}
        </div>
      </section>

      {showNoModelMessage ? (
        <p className="rounded-md border border-neutral-300 bg-white p-3 text-neutral-700">
          No model elements found in the loaded XML file.
        </p>
      ) : null}

      {activeGroup ? (
        <section className="-mt-px rounded-b-xl border border-neutral-300 bg-white p-4 shadow-sm">
          <h2 className="text-xl font-semibold">
            Model centered on {activeGroup.name} (<code>{activeGroup.typeLabel}</code>)
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            Click on nodes to add them to a model sub-selection, shift click to add
            them as count nodes.
          </p>

          <div className="mt-4">
            <div
              ref={flowViewportRef}
              className="h-[42rem] w-full overflow-hidden rounded-xl border border-neutral-200"
            >
              {flow ? (
                <ReactFlow
                  onInit={onFlowInit}
                  fitView
                  fitViewOptions={{ padding: 0.15 }}
                  minZoom={0.02}
                  nodes={flow.nodes}
                  edges={flow.edges}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  onNodeClick={onFlowNodeClick}
                >
                  <Controls />
                  <Background gap={16} />
                </ReactFlow>
              ) : null}
            </div>
          </div>

          {children}
        </section>
      ) : null}
    </>
  );
}
