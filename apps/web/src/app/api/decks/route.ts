import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";

export async function GET() {
  const decks = await prisma.savedDeck.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json(decks);
}

export async function POST(request: Request) {
  const body = (await request.json()) as { name?: unknown; text?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!name || !text) {
    return NextResponse.json({ error: "Both name and text are required" }, { status: 400 });
  }
  const deck = await prisma.savedDeck.create({ data: { name, text } });
  return NextResponse.json(deck, { status: 201 });
}
