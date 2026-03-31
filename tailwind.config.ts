import type { Config } from "tailwindcss";

const config: Config = {
	content: [
		"./pages/**/*.{js,ts,jsx,tsx,mdx}",
		"./components/**/*.{js,ts,jsx,tsx,mdx}",
		"./app/**/*.{js,ts,jsx,tsx,mdx}",
	],
	theme: {
		extend: {
			fontFamily: {
				sans: ["var(--font-jakarta)", "sans-serif"],
				mono: ["var(--font-mono)", "monospace"],
			},
			colors: {
				bg: {
					deep: "#070910",
					surface: "#0d1018",
					panel: "#111420",
					card: "#161b2e",
					hover: "#1b2135",
				},
				border: {
					DEFAULT: "#222840",
					hover: "#2d3654",
					focus: "#4f7fff",
				},
				text: {
					primary: "#e2e8f5",
					secondary: "#7b8bb4",
					muted: "#4a556f",
				},
				col: {
					backlog: "#64748b",
					progress: "#3b82f6",
					review: "#a855f7",
					done: "#22c55e",
				},
				priority: {
					high: "#ef4444",
					med: "#f97316",
					low: "#84cc16",
				},
			},
			animation: {
				"slide-in": "slideIn 0.2s ease-out",
				"slide-out": "slideOut 0.2s ease-in",
				"fade-in": "fadeIn 0.15s ease-out",
				"pulse-dot": "pulseDot 2s ease-in-out infinite",
			},
			keyframes: {
				slideIn: {
					from: { transform: "translateX(100%)", opacity: "0" },
					to: { transform: "translateX(0)", opacity: "1" },
				},
				slideOut: {
					from: { transform: "translateX(0)", opacity: "1" },
					to: { transform: "translateX(100%)", opacity: "0" },
				},
				fadeIn: {
					from: { opacity: "0", transform: "scale(0.97)" },
					to: { opacity: "1", transform: "scale(1)" },
				},
				pulseDot: { "0%, 100%": { opacity: "1" }, "50%": { opacity: "0.4" } },
			},
		},
	},
	plugins: [],
};

export default config;
