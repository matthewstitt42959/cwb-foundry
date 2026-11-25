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

/**
 * Partial update: rename, edit the decklist text, and/or move between folders.
 * Only fields actually present in the body are touched. Owner only.
 */
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

  const body = (await request.json()) as {
    name?: unknown;
    text?: unknown;
    folder?: unknown;
    public?: unknown;
  };
  const data: { name?: string; text?: string; folder?: string | null; public?: boolean } = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "Name can't be empty" }, { status: 400 });
    data.name = name;
  }
  if (typeof body.text === "string") {
    const text = body.text.trim();
    if (!text) return NextResponse.json({ error: "Decklist can't be empty" }, { status: 400 });
    data.text = text;
  }
  if (typeof body.folder === "string") {
    data.folder = body.folder.trim() || null;
  }
  if (typeof body.public === "boolean") {
    data.public = body.public;
  }

  const updated = await prisma.savedDeck.update({ where: { id }, data });
  return NextResponse.json(updated);
}
