import {
  DataGrid,
  type GridColDef,
  type GridRenderCellParams,
} from "@mui/x-data-grid";
import { type Dispatch, useMemo } from "react";

import {
  createDefaultNodeState,
  type ScenarioAction,
} from "../../../scenario";
import type { PathbuilderPath } from "../../../serializer/pathbuilder";

interface RootClassesPanelProps {
  dispatchModelState: Dispatch<ScenarioAction>;
  instanceCountByPathId: Record<string, number>;
  pathsWithReferences: Array<PathbuilderPath>;
  xmlLoadError: null | string;
}

export function RootClassesPanel({
  dispatchModelState,
  instanceCountByPathId,
  pathsWithReferences,
  xmlLoadError,
}: RootClassesPanelProps) {
  function showOnlyRootNode(rootNodeId: string): void {
    dispatchModelState({
      payload: { nodes: [createDefaultNodeState([rootNodeId])] },
      type: "state/setNodes",
    });
  }

  const columns = useMemo<Array<GridColDef>>(() => {
    return [
      {
        field: "name",
        flex: 1,
        headerName: "Root class",
        minWidth: 240,
        renderCell: (params: GridRenderCellParams<{ rootNodeId: string }>) => {
          const rootNodeId = params.row.rootNodeId;

          return (
            <button
              className="rounded-panel border border-ui-border bg-surface px-2 py-1 text-left text-sm text-text-strong hover:bg-surface-hover"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                showOnlyRootNode(rootNodeId);
              }}
            >
              {String(params.value ?? "")}
            </button>
          );
        },
      },
      {
        field: "instanceCount",
        headerName: "Instance count",
        minWidth: 140,
        width: 140,
      },
      {
        field: "referenceCount",
        headerName: "Entity references",
        minWidth: 150,
        width: 150,
      },
      {
        field: "rdfType",
        flex: 1,
        headerName: "RDF type",
        minWidth: 220,
      },
    ];
  }, []);

  const rows = useMemo(() => {
    return pathsWithReferences.map((path) => {
      return {
        id: path.id,
        instanceCount: instanceCountByPathId[path.id] ?? -1,
        name: path.name,
        rdfType: path.rdf_type || "(unknown type)",
        referenceCount: path.references.length,
        rootNodeId: path.id,
      };
    });
  }, [instanceCountByPathId, pathsWithReferences]);

  return (
    <div className="rounded-panel bg-surface-alt p-3 text-text-strong">
      {pathsWithReferences.length > 0 ? (
        <div className="w-full rounded-panel border border-ui-border">
          <DataGrid
            className="h-[50vh] max-h-[50vh]"
            columns={columns}
            disableColumnFilter
            disableColumnSelector
            disableRowSelectionOnClick
            hideFooter
            hideFooterSelectedRowCount
            initialState={{
              sorting: {
                sortModel: [{ field: "referenceCount", sort: "desc" }],
              },
            }}
            rows={rows}
            sortingOrder={["desc", "asc"]}
          />
        </div>
      ) : (
        <p className="mb-0 text-sm text-muted">
          {xmlLoadError == null
            ? "No PathbuilderPaths with references."
            : "Pathbuilder file could not be parsed."}
        </p>
      )}
    </div>
  );
}
