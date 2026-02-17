export interface UrlSelectionState {
	groupId: string;
	expandedChildNodeIds: Array<string>;
	expandedAboveNodeIds: Array<string>;
	firstSelectedNodeId: string | null;
	selectedNodeIds: Array<string>;
	countNodeIds: Array<string>;
	includeZeroCountResults: boolean;
	includeFullPrefixConstraints: boolean;
	makeAllFieldsOptional: boolean;
	makeAllEntityReferencesOptional: boolean;
	disregardTypesOfNonRootNodes: boolean;
	omitClassConstraints: boolean;
	namedGraphInput: string;
	orderByVariable: string;
	orderByDirection: "ASC" | "DESC";
	queryLimit: number;
}

function readCsvList(value: string | null): Array<string> {
	return (value ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

export function parseUrlSelectionState(search: string): UrlSelectionState {
	const params = new URLSearchParams(search);
	const makeAllFieldsOptional =
		(params.get("all_fields_optional") ?? "") === "1";
	const makeAllEntityReferencesOptional =
		makeAllFieldsOptional ||
		(params.get("all_entity_refs_optional") ?? "") === "1";
	const omitClassConstraints =
		(params.get("omit_class_constraints") ?? "") === "1";
	const disregardTypesOfNonRootNodes =
		(params.get("disregard_non_root_types") ?? "") === "1" ||
		(params.get("only_root_model_type") ?? "") === "1";
	const parsedLimit = Number.parseInt(params.get("limit") ?? "", 10);

	return {
		groupId: params.get("group") ?? "",
		expandedChildNodeIds: readCsvList(params.get("expanded_children")),
		expandedAboveNodeIds: readCsvList(params.get("expanded_above")),
		firstSelectedNodeId: (params.get("selected_first") ?? "").trim() || null,
		selectedNodeIds: readCsvList(params.get("selected_nodes")),
		countNodeIds: readCsvList(params.get("count_nodes")),
		includeZeroCountResults: (params.get("include_zero") ?? "") !== "0",
		includeFullPrefixConstraints:
			(params.get("include_full_prefix") ?? "") !== "0",
		makeAllFieldsOptional,
		makeAllEntityReferencesOptional,
		disregardTypesOfNonRootNodes,
		omitClassConstraints,
		namedGraphInput: params.get("named_graph") ?? "",
		orderByVariable: params.get("order_by") ?? "",
		orderByDirection:
			(params.get("order_dir") ?? "").toUpperCase() === "ASC" ? "ASC" : "DESC",
		queryLimit:
			Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 100,
	};
}

export function hasUrlSelectionState(search: string): boolean {
	const params = new URLSearchParams(search);
	return [
		"group",
		"expanded_children",
		"expanded_above",
		"selected_first",
		"selected_nodes",
		"count_nodes",
		"include_zero",
		"include_full_prefix",
		"all_fields_optional",
		"all_entity_refs_optional",
		"disregard_non_root_types",
		"only_root_model_type",
		"omit_class_constraints",
		"named_graph",
		"order_by",
		"order_dir",
		"limit",
	].some((key) => (params.get(key) ?? "").trim().length > 0);
}

export function applyUrlSelectionState(
	currentHref: string,
	state: UrlSelectionState,
): string {
	const url = new URL(currentHref);
	url.searchParams.set("group", state.groupId);

	const expandedChildren = [...state.expandedChildNodeIds].sort();
	if (expandedChildren.length > 0) {
		url.searchParams.set("expanded_children", expandedChildren.join(","));
	} else {
		url.searchParams.delete("expanded_children");
	}

	const expandedAbove = [...state.expandedAboveNodeIds].sort();
	if (expandedAbove.length > 0) {
		url.searchParams.set("expanded_above", expandedAbove.join(","));
	} else {
		url.searchParams.delete("expanded_above");
	}

	if (state.firstSelectedNodeId) {
		url.searchParams.set("selected_first", state.firstSelectedNodeId);
	} else {
		url.searchParams.delete("selected_first");
	}

	const selectedNodes = [...state.selectedNodeIds].sort();
	if (selectedNodes.length > 0) {
		url.searchParams.set("selected_nodes", selectedNodes.join(","));
	} else {
		url.searchParams.delete("selected_nodes");
	}

	const countNodes = [...state.countNodeIds].sort();
	if (countNodes.length > 0) {
		url.searchParams.set("count_nodes", countNodes.join(","));
	} else {
		url.searchParams.delete("count_nodes");
	}

	if (!state.includeZeroCountResults) {
		url.searchParams.set("include_zero", "0");
	} else {
		url.searchParams.delete("include_zero");
	}
	if (!state.includeFullPrefixConstraints) {
		url.searchParams.set("include_full_prefix", "0");
	} else {
		url.searchParams.delete("include_full_prefix");
	}
	if (state.makeAllFieldsOptional) {
		url.searchParams.set("all_fields_optional", "1");
	} else {
		url.searchParams.delete("all_fields_optional");
	}
	if (state.makeAllFieldsOptional || state.makeAllEntityReferencesOptional) {
		url.searchParams.set("all_entity_refs_optional", "1");
	} else {
		url.searchParams.delete("all_entity_refs_optional");
	}
	if (state.disregardTypesOfNonRootNodes) {
		url.searchParams.set("disregard_non_root_types", "1");
	} else {
		url.searchParams.delete("disregard_non_root_types");
	}
	url.searchParams.delete("only_root_model_type");
	if (state.omitClassConstraints) {
		url.searchParams.set("omit_class_constraints", "1");
	} else {
		url.searchParams.delete("omit_class_constraints");
	}

	const namedGraph = state.namedGraphInput.trim();
	if (namedGraph.length > 0) {
		url.searchParams.set("named_graph", namedGraph);
	} else {
		url.searchParams.delete("named_graph");
	}

	const orderBy = state.orderByVariable.trim();
	if (orderBy.length > 0) {
		url.searchParams.set("order_by", orderBy);
	} else {
		url.searchParams.delete("order_by");
	}

	if (state.orderByDirection !== "DESC") {
		url.searchParams.set("order_dir", state.orderByDirection);
	} else {
		url.searchParams.delete("order_dir");
	}
	const normalizedLimit =
		Number.isFinite(state.queryLimit) && state.queryLimit > 0
			? Math.trunc(state.queryLimit)
			: 100;
	if (normalizedLimit !== 100) {
		url.searchParams.set("limit", String(normalizedLimit));
	} else {
		url.searchParams.delete("limit");
	}

	return url.toString();
}
