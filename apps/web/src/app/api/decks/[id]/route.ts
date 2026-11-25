import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.savedDeck.delete({ where: { id } }).catch(() => null);
  return new NextResponse(null, { status: 204 });
}
