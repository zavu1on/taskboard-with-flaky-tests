import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
	title: "TaskBoard - E2E Flaky Test Demo",
	description:
		"Kanban board for demonstrating DOM Event Interaction flakiness in E2E tests",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en" className="dark">
			<body>
				{process.env.NODE_ENV === "development" && (
					<script
						src="https://unpkg.com/react-scan/dist/auto.global.js"
						crossOrigin="anonymous"
					/>
				)}
				{children}
			</body>
		</html>
	);
}
