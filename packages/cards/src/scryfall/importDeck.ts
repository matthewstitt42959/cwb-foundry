import type { CardDefs } from "@cwb/engine";
import { fetchCardsByName, type FetchCardsOptions } from "./client";
import { convertScryfallCard, type ConvertResult } from "./convert";
import { parseDecklist } from "./decklist";

export interface ImportRow {
  name: string;
  count: number;
  status: "ok" | "unsupported" | "not_found";
  /** Why it can't be played (empty for "ok"). */
  reasons: string[];
}

export interface ImportedDeck {
  /** Card definition ids, one per copy, only for cards the engine can run. */
  cards: string[];
  defs: CardDefs;
  rows: ImportRow[];
  skippedLines: string[];
  playableCount: number;
  skippedCount: number;
}

/** Remembers conversions by lowercase name so repeat imports don't hit the API again. */
export type ImportCache = Map<string, ConvertResult>;

/** Every name a card can be looked up by: full name and each face of "A // B". */
function keysFor(name: string): string[] {
  return [name, ...name.split(" // ")].map((s) => s.trim().toLowerCase());
}

export async function importDecklist(
  text: string,
  opts: FetchCardsOptions & { cache?: ImportCache },
): Promise<ImportedDeck> {
  const { entries, skipped } = parseDecklist(text);
  const cache: ImportCache = opts.cache ?? new Map();

  const missing = entries.filter((e) => !cache.has(e.name.toLowerCase())).map((e) => e.name);
  const notFound = new Set<string>();

  if (missing.length > 0) {
    const fetched = await fetchCardsByName(missing, opts);
    for (const nf of fetched.notFound) notFound.add(nf.toLowerCase());
    for (const card of fetched.cards) {
      const result = convertScryfallCard(card);
      for (const key of keysFor(card.name)) cache.set(key, result);
    }
  }

  const defs: CardDefs = {};
  const cards: string[] = [];
  const rows: ImportRow[] = [];
  let playableCount = 0;
  let skippedCount = 0;

  for (const entry of entries) {
    const key = entry.name.toLowerCase();
    const result = cache.get(key);
    if (!result) {
      rows.push({ name: entry.name, count: entry.count, status: "not_found", reasons: ["Scryfall has no card with that name"] });
      skippedCount += entry.count;
    } else if (!result.def) {
      rows.push({ name: result.name, count: entry.count, status: "unsupported", reasons: result.unsupported });
      skippedCount += entry.count;
    } else {
      defs[result.def.id] = result.def;
      for (let i = 0; i < entry.count; i++) cards.push(result.def.id);
      rows.push({ name: result.name, count: entry.count, status: "ok", reasons: [] });
      playableCount += entry.count;
    }
  }

  return { cards, defs, rows, skippedLines: skipped, playableCount, skippedCount };
}
