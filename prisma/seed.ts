import { Priority, PrismaClient, Status } from "@prisma/client";

const prisma = new PrismaClient();

const SEED_TASKS = [
	// BACKLOG
	{
		title: "Set up CI/CD pipeline",
		description:
			"Configure GitHub Actions for automated testing and deployment",
		status: Status.BACKLOG,
		priority: Priority.HIGH,
		order: 0,
	},
	{
		title: "Write API documentation",
		description: "Document all REST endpoints using OpenAPI spec",
		status: Status.BACKLOG,
		priority: Priority.MEDIUM,
		order: 1,
	},
	{
		title: "Add dark mode toggle",
		description: null,
		status: Status.BACKLOG,
		priority: Priority.LOW,
		order: 2,
	},
	{
		title: "Optimize bundle size",
		description: "Analyse and reduce JS bundle with dynamic imports",
		status: Status.BACKLOG,
		priority: Priority.MEDIUM,
		order: 3,
	},

	// IN_PROGRESS
	{
		title: "Implement drag & drop board",
		description:
			"Kanban-style DnD using @dnd-kit with accessible keyboard support",
		status: Status.IN_PROGRESS,
		priority: Priority.HIGH,
		order: 0,
	},
	{
		title: "E2E test suite - flaky detection",
		description: "Reproduce and fix DOM event race conditions with Playwright",
		status: Status.IN_PROGRESS,
		priority: Priority.HIGH,
		order: 1,
	},
	{
		title: "Database migration script",
		description: "Write reversible Prisma migration for the new schema",
		status: Status.IN_PROGRESS,
		priority: Priority.MEDIUM,
		order: 2,
	},

	// REVIEW
	{
		title: "Toast notification system",
		description: "Accessible toast component with auto-dismiss and stacking",
		status: Status.REVIEW,
		priority: Priority.MEDIUM,
		order: 0,
	},
	{
		title: "Optimistic UI for task updates",
		description: "Instant feedback pattern with server rollback on error",
		status: Status.REVIEW,
		priority: Priority.HIGH,
		order: 1,
	},

	// DONE
	{
		title: "Initial project setup",
		description: "Next.js 15, Prisma, Tailwind, TypeScript configuration",
		status: Status.DONE,
		priority: Priority.HIGH,
		order: 0,
	},
	{
		title: "Database schema design",
		description: "Task model with status, priority, order fields",
		status: Status.DONE,
		priority: Priority.MEDIUM,
		order: 1,
	},
	{
		title: "Core API routes",
		description: "CRUD endpoints: GET, POST, PATCH, DELETE /api/tasks",
		status: Status.DONE,
		priority: Priority.HIGH,
		order: 2,
	},
];

async function main() {
	console.log("🌱 Seeding database...");
	await prisma.task.deleteMany();
	await prisma.task.createMany({ data: SEED_TASKS });
	console.log(`✅ Created ${SEED_TASKS.length} tasks`);
}

main()
	.catch(console.error)
	.finally(() => prisma.$disconnect());
