"use client";

import { useDroppable } from "@dnd-kit/core";
import type { Status, Task } from "@/lib/types";
import { TaskCard } from "./TaskCard";

const COL_META: Record<
	Status,
	{ label: string; color: string; pulse: boolean }
> = {
	BACKLOG: { label: "Backlog", color: "#64748b", pulse: false },
	IN_PROGRESS: { label: "In Progress", color: "#3b82f6", pulse: true },
	REVIEW: { label: "Review", color: "#a855f7", pulse: false },
	DONE: { label: "Done", color: "#22c55e", pulse: false },
};

interface Props {
	status: Status;
	tasks: Task[];
	onAddTask: (status: Status) => void;
	onEditTask: (task: Task) => void;
	onDeleteTask: (id: string) => void;
}

export function Column({
	status,
	tasks,
	onAddTask,
	onEditTask,
	onDeleteTask,
}: Props) {
	const meta = COL_META[status];
	const { setNodeRef, isOver } = useDroppable({ id: status });

	return (
		<div
			data-testid={`column-${status.toLowerCase().replace("_", "-")}`}
			data-column-status={status}
			className="flex flex-col min-h-0"
		>
			{/* Column header */}
			<div className="flex items-center justify-between mb-3 px-1">
				<div className="flex items-center gap-2">
					{/* Status dot */}
					<span
						className={`inline-block w-2 h-2 rounded-full shrink-0 ${meta.pulse ? "animate-pulse-dot" : ""}`}
						style={{ background: meta.color }}
					/>
					<span
						className="text-xs font-semibold uppercase tracking-widest"
						style={{ color: meta.color }}
					>
						{meta.label}
					</span>
					{/* Count badge */}
					<span className="text-[10px] font-mono text-text-muted bg-bg-panel px-1.5 py-0.5 rounded-full border border-border">
						{tasks.length}
					</span>
				</div>

				{/* Add button */}
				<button
					data-testid={`add-task-btn-${status.toLowerCase().replace("_", "-")}`}
					onClick={() => onAddTask(status)}
					aria-label={`Add task to ${meta.label}`}
					className="
            p-1 rounded text-text-muted
            hover:text-text-primary hover:bg-bg-card
            border border-transparent hover:border-border
            transition-all
          "
				>
					<svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
						<path d="M7.75 2a.75.75 0 01.75.75V7h4.25a.75.75 0 110 1.5H8.5v4.25a.75.75 0 11-1.5 0V8.5H2.75a.75.75 0 010-1.5H7V2.75A.75.75 0 017.75 2z" />
					</svg>
				</button>
			</div>

			{/* Drop zone */}
			<div
				ref={setNodeRef}
				data-testid={`drop-zone-${status.toLowerCase().replace("_", "-")}`}
				className={`
          flex-1 rounded-xl p-2 flex flex-col gap-2
          border-2 transition-all duration-150 min-h-[120px]
          ${
						isOver
							? "border-dashed bg-bg-panel/60"
							: "border-transparent bg-bg-panel/30"
					}
        `}
				style={isOver ? { borderColor: meta.color } : {}}
			>
				{tasks.map((task) => (
					<TaskCard
						key={task.id}
						task={task}
						onEdit={onEditTask}
						onDelete={onDeleteTask}
					/>
				))}

				{/* Empty state */}
				{tasks.length === 0 && (
					<div
						className="
              flex-1 flex flex-col items-center justify-center
              py-8 rounded-lg
              border border-dashed border-border/50
              text-text-muted text-xs
              cursor-default select-none
            "
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth={1.5}
							className="w-6 h-6 mb-2 opacity-30"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z"
							/>
						</svg>
						<span>Drop tasks here</span>
					</div>
				)}
			</div>
		</div>
	);
}
