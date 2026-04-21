import { Button, Tooltip } from "@mui/material";
import {
  DataGrid,
  type GridColDef,
  type GridRenderCellParams,
} from "@mui/x-data-grid";
import { type Dispatch, useMemo } from "react";

import { createDefaultNodeState, type ScenarioAction } from "../../../scenario";
import type { PathbuilderPath } from "../../../serializer/pathbuilder";

interface RootClassesPanelProps {
  dispatchModelState: Dispatch<ScenarioAction>;
  instanceCountByPathId: Record<string, number>;
  pathsWithReferences: Array<PathbuilderPath>;
  xmlLoadError: null | string;
}

interface RootClassRow {
  id: string;
  instanceCount: number | undefined;
  name: string;
  rdfType: string;
  referenceCount: number;
  references: Array<string>;
  rootNodeId: string;
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

  const columns = useMemo<Array<GridColDef<RootClassRow>>>(() => {
    return [
      {
        field: "rowNumber",
        headerName: "#",
        renderCell: (params: GridRenderCellParams) => {
          return String(
            params.api.getRowIndexRelativeToVisibleRows(params.id) + 1,
          );
        },
        sortable: false,
        width: 72,
      },
      {
        field: "name",
        headerName: "Entity name",
        minWidth: 240,
        renderCell: (params: GridRenderCellParams<RootClassRow, string>) => {
          const rootNodeId = params.row.rootNodeId;

          return (
            <Tooltip title="start new model selection centered on this class">
              <Button
                size="small"
                sx={{
                  justifyContent: "flex-start",
                  maxWidth: "100%",
                  textAlign: "left",
                  textTransform: "none",
                }}
                variant="outlined"
                onClick={(event) => {
                  event.stopPropagation();
                  showOnlyRootNode(rootNodeId);
                }}
              >
                {params.value ?? ""}
              </Button>
            </Tooltip>
          );
        },
      },
      {
        field: "rdfType",
        headerName: "RDF type",
        minWidth: 220,
        renderCell: (params: GridRenderCellParams<RootClassRow, string>) => {
          const rdfType = params.value ?? "";

          return rdfType.startsWith("http://") ||
            rdfType.startsWith("https://") ? (
            <a
              className="text-sm text-blue-700 underline visited:text-purple-700 hover:text-blue-800"
              href={rdfType}
              rel="noreferrer"
              target="_blank"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              {rdfType}
            </a>
          ) : (
            rdfType
          );
        },
      },
      {
        field: "referenceCount",
        headerName: "# model references",
        minWidth: 150,
        renderCell: (params: GridRenderCellParams<RootClassRow, number>) => {
          const references = params.row.references;
          const referenceCount = params.value ?? 0;
          const title =
            references.length > 0
              ? `this entity type is referenced from the following fields: ${references.join(", ")}`
              : "this entity type is not referenced from any entity_reference fields";

          return (
            <Tooltip title={title}>
              <span>{String(referenceCount)}</span>
            </Tooltip>
          );
        },
        width: 150,
      },
      {
        field: "instanceCount",
        headerName: "# instances",
        minWidth: 140,
        renderCell: (params: GridRenderCellParams<RootClassRow, number>) => {
          if (params.value == null) {
            return "...";
          }

          const count = params.value;

          return (
            <Tooltip
              title={`${String(count)} instances of this type found in the triple store`}
            >
              <span>{String(count)}</span>
            </Tooltip>
          );
        },
        width: 140,
      },
    ];
  }, []);

  const rows = useMemo<Array<RootClassRow>>(() => {
    return pathsWithReferences.map((path) => {
      return {
        id: path.id,
        instanceCount: instanceCountByPathId[path.id],
        name: path.name,
        references: path.references,
        rdfType: path.rdf_type || "(unknown type)",
        referenceCount: path.references.length,
        rootNodeId: path.id,
      };
    });
  }, [instanceCountByPathId, pathsWithReferences]);

  return (
    <div className="rounded-panel p-3 text-text-strong">
      {pathsWithReferences.length > 0 ? (
        <div className="w-full rounded-panel">
          <DataGrid
            autosizeOnMount
            autosizeOptions={{ expand: false, includeHeaders: true }}
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
