import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { UpdateTaskInput } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
	try {
		const { id } = await params;
		const body: UpdateTaskInput = await req.json();

		const task = await prisma.task.update({
			where: { id },
			data: {
				...(body.title !== undefined && { title: body.title.trim() }),
				...(body.description !== undefined && {
					description: body.description?.trim() || null,
				}),
				...(body.status !== undefined && { status: body.status }),
				...(body.priority !== undefined && { priority: body.priority }),
				...(body.order !== undefined && { order: body.order }),
			},
		});

		return NextResponse.json(task);
	} catch (error: unknown) {
		console.error("[PATCH /api/tasks/[id]]", error);
		if ((error as { code?: string }).code === "P2025") {
			return NextResponse.json({ error: "Task not found" }, { status: 404 });
		}
		return NextResponse.json(
			{ error: "Failed to update task" },
			{ status: 500 },
		);
	}
}

export async function DELETE(_req: NextRequest, { params }: Params) {
	try {
		const { id } = await params;
		await prisma.task.delete({ where: { id } });
		return NextResponse.json({ success: true });
	} catch (error: unknown) {
		console.error("[DELETE /api/tasks/[id]]", error);
		if ((error as { code?: string }).code === "P2025") {
			return NextResponse.json({ error: "Task not found" }, { status: 404 });
		}
		return NextResponse.json(
			{ error: "Failed to delete task" },
			{ status: 500 },
		);
	}
}
