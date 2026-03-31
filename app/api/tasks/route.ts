import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { CreateTaskInput } from "@/lib/types";

export async function GET() {
	try {
		const tasks = await prisma.task.findMany({
			orderBy: [{ order: "asc" }, { createdAt: "asc" }],
		});
		return NextResponse.json(tasks);
	} catch (error) {
		console.error("[GET /api/tasks]", error);
		return NextResponse.json(
			{ error: "Failed to fetch tasks" },
			{ status: 500 },
		);
	}
}

export async function POST(req: NextRequest) {
	try {
		const body: CreateTaskInput = await req.json();

		if (!body.title || typeof body.title !== "string" || !body.title.trim()) {
			return NextResponse.json({ error: "Title is required" }, { status: 400 });
		}

		// Place new task at the end of its column
		const lastTask = await prisma.task.findFirst({
			where: { status: body.status ?? "BACKLOG" },
			orderBy: { order: "desc" },
		});

		const task = await prisma.task.create({
			data: {
				title: body.title.trim(),
				description: body.description?.trim() || null,
				priority: body.priority ?? "MEDIUM",
				status: body.status ?? "BACKLOG",
				order: (lastTask?.order ?? -1) + 1,
			},
		});

		return NextResponse.json(task, { status: 201 });
	} catch (error) {
		console.error("[POST /api/tasks]", error);
		return NextResponse.json(
			{ error: "Failed to create task" },
			{ status: 500 },
		);
	}
}
