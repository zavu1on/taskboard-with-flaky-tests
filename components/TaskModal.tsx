"use client";

import { useEffect, useRef, useState } from "react";
import type {
	CreateTaskInput,
	Priority,
	Status,
	Task,
	UpdateTaskInput,
} from "@/lib/types";
import { COLUMNS, PRIORITY_META } from "@/lib/types";

interface Props {
	task?: Task | null;
	defaultStatus?: Status;
	onClose: () => void;
	onCreate?: (input: CreateTaskInput) => void;
	onUpdate?: (id: string, input: UpdateTaskInput) => void;
}

export function TaskModal({
	task,
	defaultStatus = "BACKLOG",
	onClose,
	onCreate,
	onUpdate,
}: Props) {
	const isEdit = !!task;
	const [title, setTitle] = useState(task?.title ?? "");
	const [desc, setDesc] = useState(task?.description ?? "");
	const [priority, setPriority] = useState<Priority>(
		task?.priority ?? "MEDIUM",
	);
	const [status, setStatus] = useState<Status>(task?.status ?? defaultStatus);
	const [error, setError] = useState("");
	const [submitting, setSubmitting] = useState(false);

	const titleRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		titleRef.current?.focus();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!title.trim()) {
			setError("Title is required");
			return;
		}
		setSubmitting(true);
		try {
			if (isEdit) {
				onUpdate?.(task!.id, {
					title: title.trim(),
					description: desc.trim() || null,
					priority,
					status,
				});
			} else {
				onCreate?.({
					title: title.trim(),
					description: desc.trim() || null,
					priority,
					status,
				});
			}
			onClose();
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div className="fixed inset-0 z-40 flex items-center justify-center p-4">
			<div
				data-testid="modal-backdrop"
				className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-default"
				onClick={onClose}
			/>

			<div
				data-testid="modal"
				role="dialog"
				aria-modal="true"
				aria-label={isEdit ? "Edit task" : "Create task"}
				onClick={(e) => e.stopPropagation()}
				className="
          relative z-10 w-full max-w-lg
          bg-bg-panel border border-border
          rounded-xl shadow-[0_24px_80px_rgba(0,0,0,0.7)]
          animate-fade-in
        "
			>
				<div className="flex items-center justify-between px-6 py-4 border-b border-border">
					<h2 className="font-semibold text-text-primary tracking-tight">
						{isEdit ? "Edit Task" : "New Task"}
					</h2>
					<button
						data-testid="modal-close-btn"
						onClick={onClose}
						aria-label="Close modal"
						className="text-text-muted hover:text-text-secondary transition-colors p-1 rounded"
					>
						<svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
							<path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
						</svg>
					</button>
				</div>

				<form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
					<div className="space-y-1.5">
						<label className="text-xs font-medium text-text-secondary uppercase tracking-wider">
							Title <span className="text-[#ef4444]">*</span>
						</label>
						<input
							ref={titleRef}
							data-testid="task-title-input"
							type="text"
							value={title}
							onChange={(e) => {
								setTitle(e.target.value);
								setError("");
							}}
							placeholder="What needs to be done?"
							maxLength={120}
							className="
                w-full px-3 py-2.5 rounded-lg text-sm
                bg-bg-card border border-border text-text-primary
                placeholder:text-text-muted
                focus:outline-none focus:border-border-focus
                transition-colors
              "
						/>
						{error && (
							<p className="text-xs text-[#ef4444]" data-testid="title-error">
								{error}
							</p>
						)}
					</div>

					<div className="space-y-1.5">
						<label className="text-xs font-medium text-text-secondary uppercase tracking-wider">
							Description
						</label>
						<textarea
							data-testid="task-description-input"
							value={desc}
							onChange={(e) => setDesc(e.target.value)}
							placeholder="Optional details…"
							rows={3}
							maxLength={500}
							className="
                w-full px-3 py-2.5 rounded-lg text-sm resize-none
                bg-bg-card border border-border text-text-primary
                placeholder:text-text-muted
                focus:outline-none focus:border-border-focus
                transition-colors
              "
						/>
					</div>

					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1.5">
							<label className="text-xs font-medium text-text-secondary uppercase tracking-wider">
								Status
							</label>
							<select
								data-testid="task-status-select"
								value={status}
								onChange={(e) => setStatus(e.target.value as Status)}
								className="
                  w-full px-3 py-2.5 rounded-lg text-sm
                  bg-bg-card border border-border text-text-primary
                  focus:outline-none focus:border-border-focus
                  transition-colors cursor-pointer
                "
							>
								{COLUMNS.map((c) => (
									<option key={c.id} value={c.id}>
										{c.label}
									</option>
								))}
							</select>
						</div>

						<div className="space-y-1.5">
							<label className="text-xs font-medium text-text-secondary uppercase tracking-wider">
								Priority
							</label>
							<select
								data-testid="task-priority-select"
								value={priority}
								onChange={(e) => setPriority(e.target.value as Priority)}
								className="
                  w-full px-3 py-2.5 rounded-lg text-sm
                  bg-bg-card border border-border text-text-primary
                  focus:outline-none focus:border-border-focus
                  transition-colors cursor-pointer
                "
							>
								{(
									Object.entries(PRIORITY_META) as [
										Priority,
										(typeof PRIORITY_META)[Priority],
									][]
								).map(([k, v]) => (
									<option key={k} value={k}>
										{v.label}
									</option>
								))}
							</select>
						</div>
					</div>

					<div className="flex gap-2 pt-1">
						<button
							type="button"
							data-testid="modal-cancel-btn"
							onClick={onClose}
							className="
                flex-1 px-4 py-2.5 rounded-lg text-sm font-medium
                bg-bg-card border border-border
                text-text-secondary hover:text-text-primary
                hover:border-border-hover transition-colors
              "
						>
							Cancel
						</button>
						<button
							type="submit"
							data-testid="modal-submit-btn"
							disabled={submitting}
							className="
                flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold
                bg-[#4f7fff] hover:bg-[#6b93ff]
                text-white transition-colors
                disabled:opacity-50 disabled:cursor-not-allowed
              "
						>
							{submitting ? "Saving…" : isEdit ? "Save Changes" : "Create Task"}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
