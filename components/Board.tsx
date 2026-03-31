"use client";

import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { useMemo, useState } from "react";

import { useTasks } from "@/hooks/useTasks";
import { useToast } from "@/hooks/useToast";
import type { Status, Task } from "@/lib/types";
import { Column } from "./Column";
import { TaskCard } from "./TaskCard";
import { TaskModal } from "./TaskModal";
import { ToastContainer } from "./Toast";

const COLUMN_ORDER: Status[] = ["BACKLOG", "IN_PROGRESS", "REVIEW", "DONE"];

export function Board() {
	const { toasts, addToast, removeToast } = useToast();
	const { tasks, loading, createTask, updateTask, moveTask, deleteTask } =
		useTasks(
			(msg) => addToast(msg, "error"),
			(msg) => addToast(msg, "success"),
		);

	const [activeTask, setActiveTask] = useState<Task | null>(null);

	const [modalTarget, setModalTarget] = useState<null | "new" | Task>(null);
	const [modalDefaultStatus, setModalDefaultStatus] =
		useState<Status>("BACKLOG");

	const tasksByColumn = useMemo(() => {
		return COLUMN_ORDER.reduce<Record<Status, Task[]>>(
			(acc, status) => {
				acc[status] = tasks
					.filter((t) => t.status === status)
					.sort((a, b) => a.order - b.order);
				return acc;
			},
			{ BACKLOG: [], IN_PROGRESS: [], REVIEW: [], DONE: [] },
		);
	}, [tasks]);

	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 200, tolerance: 8 },
		}),
	);

	function handleDragStart(event: DragStartEvent) {
		const task = event.active.data.current?.task as Task | undefined;
		if (task) setActiveTask(task);
	}

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event;
		setActiveTask(null);

		if (!over) return;

		const taskId = active.id as string;
		const overId = over.id as string;

		let targetStatus: Status | null = null;

		if (COLUMN_ORDER.includes(overId as Status)) {
			targetStatus = overId as Status;
		} else {
			const overTask = tasks.find((t) => t.id === overId);
			if (overTask) targetStatus = overTask.status;
		}

		if (targetStatus) moveTask(taskId, targetStatus);
	}

	function openCreateModal(status: Status) {
		setModalDefaultStatus(status);
		setModalTarget("new");
	}

	function openEditModal(task: Task) {
		setModalTarget(task);
	}

	function closeModal() {
		setModalTarget(null);
	}

	return (
		<>
			<header className="flex items-center justify-between mb-8">
				<div>
					<h1 className="text-2xl font-extrabold text-text-primary tracking-tight">
						Task Board
					</h1>
					<p className="text-sm text-text-muted mt-0.5">
						{tasks.length} task{tasks.length !== 1 ? "s" : ""} total
					</p>
				</div>

				<button
					data-testid="global-add-task-btn"
					onClick={() => openCreateModal("BACKLOG")}
					className="
            flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold
            bg-[#4f7fff] hover:bg-[#6b93ff] text-white
            transition-colors shadow-[0_4px_14px_rgba(79,127,255,0.35)]
          "
				>
					<svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
						<path d="M7.75 2a.75.75 0 01.75.75V7h4.25a.75.75 0 110 1.5H8.5v4.25a.75.75 0 11-1.5 0V8.5H2.75a.75.75 0 010-1.5H7V2.75A.75.75 0 017.75 2z" />
					</svg>
					New Task
				</button>
			</header>

			{loading ? (
				<div data-testid="board-loading" className="grid grid-cols-4 gap-4">
					{COLUMN_ORDER.map((col) => (
						<div key={col} className="space-y-2">
							<div className="h-5 w-24 bg-bg-panel rounded animate-pulse" />
							{[0, 1, 2].map((i) => (
								<div
									key={i}
									className="h-20 bg-bg-panel rounded-xl animate-pulse"
								/>
							))}
						</div>
					))}
				</div>
			) : (
				<DndContext
					sensors={sensors}
					collisionDetection={closestCenter}
					onDragStart={handleDragStart}
					onDragEnd={handleDragEnd}
				>
					<div
						data-testid="board"
						className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
					>
						{COLUMN_ORDER.map((status) => (
							<Column
								key={status}
								status={status}
								tasks={tasksByColumn[status]}
								onAddTask={openCreateModal}
								onEditTask={openEditModal}
								onDeleteTask={deleteTask}
							/>
						))}
					</div>

					<DragOverlay dropAnimation={{ duration: 180, easing: "ease" }}>
						{activeTask && (
							<TaskCard
								task={activeTask}
								isOverlay
								onEdit={() => {}}
								onDelete={() => {}}
							/>
						)}
					</DragOverlay>
				</DndContext>
			)}

			{modalTarget !== null && (
				<TaskModal
					task={modalTarget === "new" ? null : modalTarget}
					defaultStatus={modalDefaultStatus}
					onClose={closeModal}
					onCreate={(input) => {
						createTask(input);
						closeModal();
					}}
					onUpdate={(id, input) => {
						updateTask(id, input);
						closeModal();
					}}
				/>
			)}

			<ToastContainer toasts={toasts} onRemove={removeToast} />
		</>
	);
}
