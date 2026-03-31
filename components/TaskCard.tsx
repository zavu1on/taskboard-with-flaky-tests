"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { Task } from "@/lib/types";
import { PRIORITY_META } from "@/lib/types";

function formatRelativeTime(dateStr: string): string {
	const now = Date.now();
	const diff = now - new Date(dateStr).getTime();
	const mins = Math.floor(diff / 60_000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	return `${Math.floor(hrs / 24)}d ago`;
}

interface Props {
	task: Task;
	isOverlay?: boolean;
	onEdit: (task: Task) => void;
	onDelete: (id: string) => void;
}

export function TaskCard({ task, isOverlay = false, onEdit, onDelete }: Props) {
	const { attributes, listeners, setNodeRef, transform, isDragging } =
		useDraggable({
			id: task.id,
			data: { task },
			disabled: isOverlay,
		});

	const priority = PRIORITY_META[task.priority];

	const style: React.CSSProperties = {
		transform: CSS.Translate.toString(transform),
		opacity: isDragging && !isOverlay ? 0.35 : 1,
		borderLeftColor: priority.color,
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			data-testid={isOverlay ? undefined : `task-card-${task.id}`}
			data-task-id={task.id}
			data-status={task.status}
			{...(!isOverlay ? listeners : {})}
			{...(!isOverlay ? attributes : {})}
			className={`
        group relative flex flex-col gap-2
        px-3.5 py-3 rounded-lg
        bg-bg-card border border-border border-l-[3px]
        hover:border-border-hover hover:bg-bg-hover
        transition-all duration-150
        ${isOverlay ? "rotate-[1.5deg] shadow-[0_16px_48px_rgba(0,0,0,0.6)] scale-[1.02] cursor-grabbing" : "cursor-grab active:cursor-grabbing"}
        ${isDragging && !isOverlay ? "pointer-events-none" : ""}
      `}
		>
			{/* Drag handle (visual only - listeners are on the card div) */}
			<div className="flex items-start justify-between gap-2">
				<span
					data-testid={`drag-handle-${task.id}`}
					aria-hidden="true"
					className="mt-0.5 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity"
				>
					<svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
						<path d="M4 5a1 1 0 110-2 1 1 0 010 2zm4 0a1 1 0 110-2 1 1 0 010 2zm4 0a1 1 0 110-2 1 1 0 010 2zM4 9a1 1 0 110-2 1 1 0 010 2zm4 0a1 1 0 110-2 1 1 0 010 2zm4 0a1 1 0 110-2 1 1 0 010 2z" />
					</svg>
				</span>

				{/* Action buttons - stopPropagation чтобы клик не триггерил drag */}
				<div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
					<button
						data-testid={`edit-btn-${task.id}`}
						onClick={(e) => {
							e.stopPropagation();
							onEdit(task);
						}}
						aria-label={`Edit task: ${task.title}`}
						className="p-1 rounded text-text-muted hover:text-[#4f7fff] hover:bg-[#4f7fff1a] transition-colors"
					>
						<svg
							viewBox="0 0 16 16"
							fill="currentColor"
							className="w-3.5 h-3.5"
						>
							<path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61zm.176 4.823L9.75 4.81l-6.286 6.287a.253.253 0 00-.064.108l-.558 1.953 1.953-.558a.253.253 0 00.108-.064l6.286-6.286zm1.238-3.763a.25.25 0 00-.354 0L10.811 3.65l1.439 1.44 1.263-1.263a.25.25 0 000-.354l-1.086-1.086z" />
						</svg>
					</button>
					<button
						data-testid={`delete-btn-${task.id}`}
						onClick={(e) => {
							e.stopPropagation();
							onDelete(task.id);
						}}
						aria-label={`Delete task: ${task.title}`}
						className="p-1 rounded text-text-muted hover:text-[#ef4444] hover:bg-[#ef44441a] transition-colors"
					>
						<svg
							viewBox="0 0 16 16"
							fill="currentColor"
							className="w-3.5 h-3.5"
						>
							<path d="M11 1.75V3h2.25a.75.75 0 010 1.5H2.75a.75.75 0 010-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75zM4.496 6.675l.66 6.6a.25.25 0 00.249.225h5.19a.25.25 0 00.249-.225l.66-6.6a.75.75 0 111.492.149l-.66 6.6A1.748 1.748 0 0110.595 15h-5.19a1.75 1.75 0 01-1.741-1.576l-.66-6.6a.75.75 0 111.492-.149zM6.5 1.75V3h3V1.75a.25.25 0 00-.25-.25h-2.5a.25.25 0 00-.25.25z" />
						</svg>
					</button>
				</div>
			</div>

			<p
				data-testid={`task-title-${task.id}`}
				className="text-sm font-medium text-text-primary leading-snug px-0.5"
			>
				{task.title}
			</p>

			{task.description && (
				<p className="text-xs text-text-secondary leading-relaxed px-0.5 line-clamp-2">
					{task.description}
				</p>
			)}

			<div className="flex items-center justify-between mt-0.5 px-0.5">
				{/* Priority badge */}
				<span
					data-testid={`priority-badge-${task.id}`}
					className="text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded"
					style={{ color: priority.color, background: priority.bg }}
				>
					{priority.label}
				</span>

				{/* Timestamp + ID */}
				<div className="flex items-center gap-2">
					<time
						dateTime={task.createdAt}
						className="text-[10px] text-text-muted font-mono"
					>
						{formatRelativeTime(task.createdAt)}
					</time>
					<span className="text-[10px] text-text-muted/50 font-mono hidden sm:block">
						#{task.id.slice(-4)}
					</span>
				</div>
			</div>
		</div>
	);
}
