"use client";

import { useCallback, useState } from "react";

export type ToastType = "success" | "error" | "info";

export interface Toast {
	id: string;
	message: string;
	type: ToastType;
}

export function useToast() {
	const [toasts, setToasts] = useState<Toast[]>([]);

	const removeToast = useCallback((id: string) => {
		setToasts((prev) => prev.filter((t) => t.id !== id));
	}, []);

	const addToast = useCallback(
		(message: string, type: ToastType = "info") => {
			const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			setToasts((prev) => [...prev, { id, message, type }]);
			setTimeout(() => removeToast(id), 4000);
		},
		[removeToast],
	);

	return { toasts, addToast, removeToast };
}
