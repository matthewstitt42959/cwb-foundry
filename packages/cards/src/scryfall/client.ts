import type { ScryfallCard, ScryfallCollectionResponse } from "./types";

/** The slice of `fetch` we use, so tests (and Node) can pass their own. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }>;

export interface FetchCardsOptions {
  fetch: FetchLike;
  /** Pause between requests. Scryfall asks for 50-100ms; we use 100. */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Set in Node/CLI use. Browsers don't allow overriding User-Agent. Don't put personal details here. */
  userAgent?: string;
  onProgress?: (done: number, total: number) => void;
}

export interface FetchCardsResult {
  cards: ScryfallCard[];
  notFound: string[];
}

const ENDPOINT = "https://api.scryfall.com/cards/collection";
const BATCH = 75; // Scryfall's documented maximum identifiers per request
const MAX_RETRIES = 3;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Look up cards by exact name using Scryfall's /cards/collection endpoint.
 * Batches 75 names per request, waits between requests, and retries rate-limit (429) responses.
 */
export async function fetchCardsByName(names: string[], opts: FetchCardsOptions): Promise<FetchCardsResult> {
  const sleep = opts.sleep ?? defaultSleep;
  const delay = opts.delayMs ?? 100;
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  if (opts.userAgent) headers["User-Agent"] = opts.userAgent;

  const cards: ScryfallCard[] = [];
  const notFound: string[] = [];

  for (let i = 0; i < names.length; i += BATCH) {
    const batch = names.slice(i, i + BATCH);
    if (i > 0) await sleep(delay);

    let body: ScryfallCollectionResponse | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES && !body; attempt++) {
      const res = await opts.fetch(ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({ identifiers: batch.map((name) => ({ name })) }),
      });
      if (res.status === 429) {
        if (attempt === MAX_RETRIES) throw new Error("Scryfall is rate-limiting requests; try again in a moment");
        const retryAfter = Number(res.headers.get("Retry-After"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * (attempt + 1));
        continue;
      }
      const json = (await res.json().catch(() => null)) as
        | (ScryfallCollectionResponse & { details?: string })
        | null;
      if (!res.ok || !json || json.object !== "list") {
        throw new Error(`Scryfall request failed (${res.status})${json?.details ? `: ${json.details}` : ""}`);
      }
      body = json;
    }
    if (!body) throw new Error("Scryfall is rate-limiting requests; try again in a moment");

    cards.push(...body.data);
    for (const nf of body.not_found ?? []) if (nf.name) notFound.push(nf.name);
    opts.onProgress?.(Math.min(i + BATCH, names.length), names.length);
  }

  return { cards, notFound };
}
