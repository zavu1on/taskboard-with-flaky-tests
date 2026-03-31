export type Status = "BACKLOG" | "IN_PROGRESS" | "REVIEW" | "DONE";
export type Priority = "LOW" | "MEDIUM" | "HIGH";

export interface Task {
	id: string;
	title: string;
	description: string | null;
	status: Status;
	priority: Priority;
	order: number;
	createdAt: string;
	updatedAt: string;
}

export type CreateTaskInput = {
	title: string;
	description?: string | null;
	priority?: Priority;
	status?: Status;
};

export type UpdateTaskInput = {
	title?: string;
	description?: string | null;
	status?: Status;
	priority?: Priority;
	order?: number;
};

// Column metadata
export const COLUMNS: { id: Status; label: string; color: string }[] = [
	{ id: "BACKLOG", label: "Backlog", color: "#64748b" },
	{ id: "IN_PROGRESS", label: "In Progress", color: "#3b82f6" },
	{ id: "REVIEW", label: "Review", color: "#a855f7" },
	{ id: "DONE", label: "Done", color: "#22c55e" },
];

export const PRIORITY_META: Record<
	Priority,
	{ label: string; color: string; bg: string }
> = {
	HIGH: { label: "High", color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
	MEDIUM: { label: "Medium", color: "#f97316", bg: "rgba(249,115,22,0.12)" },
	LOW: { label: "Low", color: "#84cc16", bg: "rgba(132,204,22,0.12)" },
};
