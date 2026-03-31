"use client";

import { useEffect, useState } from "react";
import type { Toast as ToastData } from "@/hooks/useToast";

const ICONS = {
	success: (
		<svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0">
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
			/>
		</svg>
	),
	error: (
		<svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0">
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
			/>
		</svg>
	),
	info: (
		<svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0">
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
			/>
		</svg>
	),
};

const STYLES = {
	success: "border-l-[3px] border-[#22c55e] text-[#22c55e]",
	error: "border-l-[3px] border-[#ef4444] text-[#ef4444]",
	info: "border-l-[3px] border-[#4f7fff] text-[#4f7fff]",
};

function SingleToast({
	toast,
	onRemove,
}: {
	toast: ToastData;
	onRemove: () => void;
}) {
	const [visible, setVisible] = useState(true);

	useEffect(() => {
		const t = setTimeout(() => setVisible(false), 3600);
		return () => clearTimeout(t);
	}, []);

	if (!visible) return null;

	return (
		<div
			data-testid={`toast-${toast.type}`}
			role="alert"
			aria-live="assertive"
			className={`
        flex items-start gap-3 px-4 py-3 rounded-lg
        bg-bg-card border border-border
        shadow-[0_8px_32px_rgba(0,0,0,0.5)]
        animate-slide-in cursor-default
        min-w-[280px] max-w-[380px]
        ${STYLES[toast.type]}
      `}
		>
			{ICONS[toast.type]}
			<p className="text-sm font-medium text-text-primary leading-snug flex-1">
				{toast.message}
			</p>
			<button
				onClick={onRemove}
				aria-label="Dismiss notification"
				className="text-text-muted hover:text-text-secondary transition-colors ml-1 mt-0.5"
			>
				<svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
					<path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
				</svg>
			</button>
		</div>
	);
}

export function ToastContainer({
	toasts,
	onRemove,
}: {
	toasts: ToastData[];
	onRemove: (id: string) => void;
}) {
	return (
		<div
			aria-label="Notifications"
			className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 items-end"
		>
			{toasts.map((t) => (
				<SingleToast key={t.id} toast={t} onRemove={() => onRemove(t.id)} />
			))}
		</div>
	);
}
