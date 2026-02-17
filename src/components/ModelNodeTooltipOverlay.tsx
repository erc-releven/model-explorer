import { useState } from "react";
import { createPortal } from "react-dom";

export function ModelNodeTooltipOverlay({
	nodeId,
	isModelNode,
	modelGroupFieldCount,
	typeReferenceParentCount,
}: {
	nodeId: string;
	isModelNode: boolean;
	modelGroupFieldCount?: number;
	typeReferenceParentCount?: number;
}) {
	const [isTooltipOpen, setIsTooltipOpen] = useState(false);
	const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
	const updateTooltipPosition = (
		event: React.PointerEvent<HTMLButtonElement>,
	): void => {
		setTooltipPosition({
			x: event.clientX + 12,
			y: event.clientY + 12,
		});
	};

	return (
		<>
			<button
				type="button"
				aria-label={nodeId}
				className="nodrag nopan absolute -inset-x-3 -inset-y-2 z-10 rounded-[inherit] border-0 bg-transparent p-0 text-inherit outline-none hover:!border-transparent hover:!bg-transparent focus-visible:ring-2 focus-visible:ring-neutral-500/60"
				onPointerEnter={(event) => {
					setIsTooltipOpen(true);
					updateTooltipPosition(event);
				}}
				onPointerMove={(event) => {
					updateTooltipPosition(event);
				}}
				onPointerLeave={() => {
					setIsTooltipOpen(false);
				}}
				onFocus={() => {
					setIsTooltipOpen(true);
					setTooltipPosition({ x: 12, y: 12 });
				}}
				onBlur={() => {
					setIsTooltipOpen(false);
				}}
			/>
			{isTooltipOpen && typeof document !== "undefined"
				? createPortal(
					<div
						role="tooltip"
						className="pointer-events-none fixed z-50 w-max max-w-sm rounded border border-neutral-300 bg-white px-2 py-1 text-[11px] text-neutral-800 shadow-md"
						style={{ left: tooltipPosition.x, top: tooltipPosition.y }}
					>
						<div>{nodeId}</div>
						{isModelNode ? (
							<>
								<div>{`root type with ${String(modelGroupFieldCount ?? 0)} fields`}</div>
								<div>{`${String(typeReferenceParentCount ?? 0)} entity references to this model`}</div>
							</>
						) : null}
					</div>,
					document.body,
				)
				: null}
		</>
	);
}
