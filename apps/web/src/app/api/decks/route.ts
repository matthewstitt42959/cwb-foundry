import { NextResponse } from "next/server";
import { authenticate } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";

/** Public decks, plus the caller's own private ones if they're logged in. */
export async function GET(request: Request) {
  const claims = authenticate(request);
  const decks = await prisma.savedDeck.findMany({
    where: claims ? { OR: [{ public: true }, { userId: claims.userId }] } : { public: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(decks);
}

export async function POST(request: Request) {
  const claims = authenticate(request);
  if (!claims) {
    return NextResponse.json({ error: "Log in to save a deck" }, { status: 401 });
  }
  const body = (await request.json()) as { name?: unknown; text?: unknown; folder?: unknown; public?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const folder = typeof body.folder === "string" ? body.folder.trim() : "";
  const isPublic = body.public === true; // private unless explicitly made public
  if (!name || !text) {
    return NextResponse.json({ error: "Both name and text are required" }, { status: 400 });
  }
  const deck = await prisma.savedDeck.create({
    data: { name, text, folder: folder || null, public: isPublic, userId: claims.userId, ownerName: claims.username },
  });
  return NextResponse.json(deck, { status: 201 });
}
