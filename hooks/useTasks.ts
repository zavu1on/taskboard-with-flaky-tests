"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
	CreateTaskInput,
	Status,
	Task,
	UpdateTaskInput,
} from "@/lib/types";

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
	const res = await fetch(url, {
		headers: { "Content-Type": "application/json" },
		...options,
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: "Unknown error" }));
		throw new Error(err.error ?? `HTTP ${res.status}`);
	}
	return res.json();
}

export function useTasks(
	onError: (msg: string) => void,
	onSuccess: (msg: string) => void,
) {
	const [tasks, setTasks] = useState<Task[]>([]);
	const [loading, setLoading] = useState(true);

	const onErrorRef = useRef(onError);
	const onSuccessRef = useRef(onSuccess);
	useEffect(() => {
		onErrorRef.current = onError;
	}, [onError]);
	useEffect(() => {
		onSuccessRef.current = onSuccess;
	}, [onSuccess]);

	const fetchTasks = useCallback(async () => {
		try {
			const data = await apiFetch<Task[]>("/api/tasks");
			setTasks(data);
		} catch {
			onErrorRef.current("Failed to load tasks");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchTasks();
	}, [fetchTasks]);

	const createTask = useCallback(async (input: CreateTaskInput) => {
		const tempId = `__temp__${Date.now()}`;
		const optimistic: Task = {
			id: tempId,
			title: input.title,
			description: input.description ?? null,
			status: input.status ?? "BACKLOG",
			priority: input.priority ?? "MEDIUM",
			order: 9999,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		setTasks((prev) => [...prev, optimistic]);

		try {
			const real = await apiFetch<Task>("/api/tasks", {
				method: "POST",
				body: JSON.stringify(input),
			});
			setTasks((prev) => prev.map((t) => (t.id === tempId ? real : t)));
			onSuccessRef.current("Task created");
		} catch (e: unknown) {
			setTasks((prev) => prev.filter((t) => t.id !== tempId));
			onErrorRef.current((e as Error).message ?? "Failed to create task");
		}
	}, []);

	const updateTask = useCallback(
		async (id: string, input: UpdateTaskInput) => {
			const prev = tasks.find((t) => t.id === id);
			if (!prev) return;

			setTasks((all) => all.map((t) => (t.id === id ? { ...t, ...input } : t)));

			try {
				const real = await apiFetch<Task>(`/api/tasks/${id}`, {
					method: "PATCH",
					body: JSON.stringify(input),
				});
				setTasks((all) => all.map((t) => (t.id === id ? real : t)));
				onSuccessRef.current("Task updated");
			} catch (e: unknown) {
				setTasks((all) => all.map((t) => (t.id === id ? prev : t)));
				onErrorRef.current((e as Error).message ?? "Failed to update task");
			}
		},
		[tasks],
	);

	const moveTask = useCallback(
		async (id: string, newStatus: Status) => {
			const prev = tasks.find((t) => t.id === id);
			if (!prev || prev.status === newStatus) return;

			setTasks((all) =>
				all.map((t) => (t.id === id ? { ...t, status: newStatus } : t)),
			);

			try {
				const real = await apiFetch<Task>(`/api/tasks/${id}`, {
					method: "PATCH",
					body: JSON.stringify({ status: newStatus }),
				});
				setTasks((all) => all.map((t) => (t.id === id ? real : t)));
			} catch (e: unknown) {
				setTasks((all) => all.map((t) => (t.id === id ? prev : t)));
				onErrorRef.current((e as Error).message ?? "Failed to move task");
			}
		},
		[tasks],
	);

	const deleteTask = useCallback(
		async (id: string) => {
			const prev = tasks.find((t) => t.id === id);
			if (!prev) return;

			setTasks((all) => all.filter((t) => t.id !== id));

			try {
				await apiFetch(`/api/tasks/${id}`, { method: "DELETE" });
				onSuccessRef.current("Task deleted");
			} catch (e: unknown) {
				setTasks((all) => [...all, prev]);
				onErrorRef.current((e as Error).message ?? "Failed to delete task");
			}
		},
		[tasks],
	);

	return { tasks, loading, createTask, updateTask, moveTask, deleteTask };
}
