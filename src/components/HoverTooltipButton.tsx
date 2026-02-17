import { useState } from "react";
import { createPortal } from "react-dom";

export function HoverTooltipButton({
	className,
	tooltipText,
	onClick,
	children,
}: {
	className: string;
	tooltipText: string;
	onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
	children: React.ReactNode;
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
				className={className}
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
				onClick={onClick}
			>
				{children}
			</button>
			{isTooltipOpen && typeof document !== "undefined"
				? createPortal(
					<div
						role="tooltip"
						className="pointer-events-none fixed z-50 w-max max-w-sm rounded border border-neutral-300 bg-white px-2 py-1 text-[11px] text-neutral-800 shadow-md"
						style={{ left: tooltipPosition.x, top: tooltipPosition.y }}
					>
						{tooltipText}
					</div>,
					document.body,
				)
				: null}
		</>
	);
}
