import { NextResponse } from "next/server";
import { authenticate } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";

export async function GET() {
  const decks = await prisma.savedDeck.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json(decks);
}

export async function POST(request: Request) {
  const claims = authenticate(request);
  if (!claims) {
    return NextResponse.json({ error: "Log in to save a deck" }, { status: 401 });
  }
  const body = (await request.json()) as { name?: unknown; text?: unknown; folder?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const folder = typeof body.folder === "string" ? body.folder.trim() : "";
  if (!name || !text) {
    return NextResponse.json({ error: "Both name and text are required" }, { status: 400 });
  }
  const deck = await prisma.savedDeck.create({
    data: { name, text, folder: folder || null, userId: claims.userId, ownerName: claims.username },
  });
  return NextResponse.json(deck, { status: 201 });
}
