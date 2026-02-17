export const SAVED_SELECTIONS_STORAGE_KEY = "releven_saved_selections_v1";
export const LAST_ACTIVE_SAVED_TAB_STORAGE_KEY =
	"releven_last_active_saved_tab_by_source_v1";
export const CURRENT_SELECTION_DRAFTS_STORAGE_KEY =
	"releven_current_selection_drafts_by_source_v1";

export interface SavedSelectionTab {
	id: string;
	label: string;
	sourceLabel: string;
	groupId: string;
	selectedNodeIds: Array<string>;
	countNodeIds: Array<string>;
	firstSelectedNodeId: string | null;
	expandedChildNodeIds: Array<string>;
	expandedAboveNodeIds: Array<string>;
	includeZeroCountResults: boolean;
	includeFullPrefixConstraints: boolean;
	makeAllFieldsOptional: boolean;
	makeAllEntityReferencesOptional: boolean;
	disregardTypesOfNonRootNodes: boolean;
	omitClassConstraints: boolean;
	namedGraphInput: string;
	orderByDirection: "ASC" | "DESC";
	queryLimit: number;
	query: string;
}

export interface CurrentSelectionDraft {
	sourceLabel: string;
	groupId: string;
	selectedNodeIds: Array<string>;
	countNodeIds: Array<string>;
	firstSelectedNodeId: string | null;
	expandedChildNodeIds: Array<string>;
	expandedAboveNodeIds: Array<string>;
	includeZeroCountResults: boolean;
	includeFullPrefixConstraints: boolean;
	makeAllFieldsOptional: boolean;
	makeAllEntityReferencesOptional: boolean;
	disregardTypesOfNonRootNodes: boolean;
	omitClassConstraints: boolean;
	namedGraphInput: string;
	orderByDirection: "ASC" | "DESC";
	queryLimit: number;
	query: string;
}

export interface NodeSelectionEntry {
	id: string;
	isCount: boolean;
}

export interface DerivedSelectionState {
	first: string | null;
	selected: Set<string>;
}

export function buildNodeSelectionEntries({
	selectedNodeIds,
	countNodeIds,
	firstSelectedNodeId,
}: {
	selectedNodeIds: Array<string>;
	countNodeIds: Array<string>;
	firstSelectedNodeId: string | null;
}): Array<NodeSelectionEntry> {
	const seen = new Set<string>();
	const orderedSelectedIds = selectedNodeIds.filter((id) => {
		if (seen.has(id)) {
			return false;
		}
		seen.add(id);
		return true;
	});
	const firstId = (firstSelectedNodeId ?? "").trim();
	if (firstId !== "" && seen.has(firstId)) {
		const index = orderedSelectedIds.indexOf(firstId);
		if (index > 0) {
			orderedSelectedIds.splice(index, 1);
			orderedSelectedIds.unshift(firstId);
		}
	}
	const countSet = new Set(countNodeIds);
	return orderedSelectedIds.map((id) => ({
		id,
		isCount: countSet.has(id),
	}));
}

export function deriveSelectionState(
	entries: Array<NodeSelectionEntry>,
): DerivedSelectionState {
	const selected = new Set(entries.map((entry) => entry.id));
	return {
		first: entries[0]?.id ?? null,
		selected,
	};
}

export function mergeSelectionStateWithPreviousEntries(
	previousEntries: Array<NodeSelectionEntry>,
	nextSelection: DerivedSelectionState,
): Array<NodeSelectionEntry> {
	if (
		!nextSelection.first ||
		!nextSelection.selected.has(nextSelection.first)
	) {
		return [];
	}

	const orderedIds = [
		nextSelection.first,
		...Array.from(nextSelection.selected).filter(
			(id) => id !== nextSelection.first,
		),
	];
	const previousCountIds = new Set(
		previousEntries.filter((entry) => entry.isCount).map((entry) => entry.id),
	);
	return orderedIds.map((id) => ({
		id,
		isCount: previousCountIds.has(id),
	}));
}

export function sameNodeSelectionEntries(
	a: Array<NodeSelectionEntry>,
	b: Array<NodeSelectionEntry>,
): boolean {
	if (a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i += 1) {
		if (a[i].id !== b[i].id || a[i].isCount !== b[i].isCount) {
			return false;
		}
	}
	return true;
}

export function normalizeList(values: Array<string>): Array<string> {
	return [...values].sort();
}

export function sameList(a: Array<string>, b: Array<string>): boolean {
	if (a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i += 1) {
		if (a[i] !== b[i]) {
			return false;
		}
	}
	return true;
}

export function sanitizeSavedSelectionTab(
	entry: SavedSelectionTab,
): SavedSelectionTab {
	return {
		...entry,
		countNodeIds: Array.isArray(entry.countNodeIds) ? entry.countNodeIds : [],
		includeZeroCountResults:
			typeof entry.includeZeroCountResults === "boolean"
				? entry.includeZeroCountResults
				: true,
		includeFullPrefixConstraints:
			typeof entry.includeFullPrefixConstraints === "boolean"
				? entry.includeFullPrefixConstraints
				: true,
		makeAllFieldsOptional:
			typeof entry.makeAllFieldsOptional === "boolean"
				? entry.makeAllFieldsOptional
				: false,
		makeAllEntityReferencesOptional:
			typeof entry.makeAllEntityReferencesOptional === "boolean"
				? entry.makeAllEntityReferencesOptional
				: false,
		disregardTypesOfNonRootNodes:
			typeof entry.disregardTypesOfNonRootNodes === "boolean"
				? entry.disregardTypesOfNonRootNodes
				: false,
		omitClassConstraints:
			typeof entry.omitClassConstraints === "boolean"
				? entry.omitClassConstraints
				: false,
		namedGraphInput:
			typeof entry.namedGraphInput === "string" ? entry.namedGraphInput : "",
		orderByDirection: entry.orderByDirection === "ASC" ? "ASC" : "DESC",
		queryLimit:
			typeof entry.queryLimit === "number" &&
			Number.isFinite(entry.queryLimit) &&
			entry.queryLimit > 0
				? Math.trunc(entry.queryLimit)
				: 100,
	};
}

export function parseSavedSelectionTabsFromStorage(
	raw: string | null,
): Array<SavedSelectionTab> {
	if (!raw) {
		return [];
	}
	const parsed = JSON.parse(raw) as Array<SavedSelectionTab>;
	if (!Array.isArray(parsed)) {
		return [];
	}
	return parsed
		.filter(
			(entry) =>
				typeof entry.id === "string" &&
				typeof entry.label === "string" &&
				typeof entry.sourceLabel === "string" &&
				typeof entry.groupId === "string" &&
				Array.isArray(entry.selectedNodeIds) &&
				Array.isArray(entry.expandedChildNodeIds) &&
				Array.isArray(entry.expandedAboveNodeIds) &&
				typeof entry.query === "string",
		)
		.map((entry) => sanitizeSavedSelectionTab(entry));
}

export function sanitizeCurrentSelectionDraft(
	entry: CurrentSelectionDraft,
): CurrentSelectionDraft {
	return {
		...entry,
		countNodeIds: Array.isArray(entry.countNodeIds) ? entry.countNodeIds : [],
		includeZeroCountResults:
			typeof entry.includeZeroCountResults === "boolean"
				? entry.includeZeroCountResults
				: true,
		includeFullPrefixConstraints:
			typeof entry.includeFullPrefixConstraints === "boolean"
				? entry.includeFullPrefixConstraints
				: true,
		makeAllFieldsOptional:
			typeof entry.makeAllFieldsOptional === "boolean"
				? entry.makeAllFieldsOptional
				: false,
		makeAllEntityReferencesOptional:
			typeof entry.makeAllEntityReferencesOptional === "boolean"
				? entry.makeAllEntityReferencesOptional
				: false,
		disregardTypesOfNonRootNodes:
			typeof entry.disregardTypesOfNonRootNodes === "boolean"
				? entry.disregardTypesOfNonRootNodes
				: false,
		omitClassConstraints:
			typeof entry.omitClassConstraints === "boolean"
				? entry.omitClassConstraints
				: false,
		namedGraphInput:
			typeof entry.namedGraphInput === "string" ? entry.namedGraphInput : "",
		orderByDirection: entry.orderByDirection === "ASC" ? "ASC" : "DESC",
		queryLimit:
			typeof entry.queryLimit === "number" &&
			Number.isFinite(entry.queryLimit) &&
			entry.queryLimit > 0
				? Math.trunc(entry.queryLimit)
				: 100,
	};
}
