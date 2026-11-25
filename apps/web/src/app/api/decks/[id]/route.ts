import { NextResponse } from "next/server";
import { authenticate } from "../../../../lib/auth";
import { prisma } from "../../../../lib/prisma";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const claims = authenticate(request);
  if (!claims) {
    return NextResponse.json({ error: "Log in to delete a deck" }, { status: 401 });
  }
  const deck = await prisma.savedDeck.findUnique({ where: { id } });
  if (!deck) return new NextResponse(null, { status: 204 }); // already gone
  if (deck.userId !== claims.userId) {
    return NextResponse.json({ error: "You can only delete your own decks" }, { status: 403 });
  }
  await prisma.savedDeck.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}

/** Moves a deck into a folder (or back out, with `folder: null`/`""`). Owner only. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const claims = authenticate(request);
  if (!claims) {
    return NextResponse.json({ error: "Log in to edit a deck" }, { status: 401 });
  }
  const deck = await prisma.savedDeck.findUnique({ where: { id } });
  if (!deck) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }
  if (deck.userId !== claims.userId) {
    return NextResponse.json({ error: "You can only edit your own decks" }, { status: 403 });
  }
  const body = (await request.json()) as { folder?: unknown };
  const folder = typeof body.folder === "string" ? body.folder.trim() : "";
  const updated = await prisma.savedDeck.update({ where: { id }, data: { folder: folder || null } });
  return NextResponse.json(updated);
}
