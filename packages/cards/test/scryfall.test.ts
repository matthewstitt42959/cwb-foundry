import { describe, expect, it } from "vitest";
import {
  convertScryfallCard,
  fetchCardsByName,
  importDecklist,
  parseDecklist,
  parseManaCost,
  type FetchLike,
  type ScryfallCard,
  type ScryfallCollectionResponse,
} from "../src";
import raw from "./fixtures/scryfall-collection.json";

// Real Scryfall responses (trimmed), captured from the live API. Real card names are
// used here on purpose: the importer's job is to read real card data.
const fixture = raw as unknown as ScryfallCollectionResponse;
const byName = (name: string): ScryfallCard => {
  const card = fixture.data.find((c) => c.name === name || c.name.split(" // ")[0] === name);
  if (!card) throw new Error(`fixture missing ${name}`);
  return card;
};
const convert = (name: string) => convertScryfallCard(byName(name));

describe("parseManaCost", () => {
  it("parses generic and coloured symbols", () => {
    expect(parseManaCost("{2}{G}{G}")).toEqual({ cost: { generic: 2, G: 2 }, problems: [] });
    expect(parseManaCost("{R}{W}").cost).toEqual({ R: 1, W: 1 });
    expect(parseManaCost("").cost).toEqual({});
  });
  it("flags symbols the engine can't pay", () => {
    expect(parseManaCost("{X}{R}").problems).toEqual(["Mana symbol {X} isn't supported"]);
    expect(parseManaCost("{G/W}").problems).toHaveLength(1);
    expect(parseManaCost("{G/P}").problems).toHaveLength(1);
    expect(parseManaCost("{C}").problems).toHaveLength(1);
  });
});

describe("convertScryfallCard: supported cards", () => {
  it("converts burn", () => {
    const { def } = convert("Lightning Bolt");
    expect(def).toMatchObject({
      id: "mtg_lightning_bolt",
      game: "mtg",
      types: ["instant"],
      cost: { R: 1 },
      effects: [{ kind: "damage", amount: 3, target: "any" }],
    });
    expect(def?.imageUrl).toMatch(/^https:\/\/cards\.scryfall\.io\//);
  });

  it("converts basic lands", () => {
    for (const [name, color] of [["Forest", "G"], ["Mountain", "R"], ["Island", "U"], ["Plains", "W"], ["Swamp", "B"]] as const) {
      expect(convert(name).def).toMatchObject({ types: ["land"], produces: color });
    }
  });

  it("converts vanilla and keyword creatures", () => {
    expect(convert("Grizzly Bears").def).toMatchObject({ types: ["creature"], cost: { generic: 1, G: 1 }, power: 2, toughness: 2 });
    expect(convert("Serra Angel").def).toMatchObject({ power: 4, toughness: 4, keywords: ["flying", "vigilance"] });
    expect(convert("Wind Drake").def?.keywords).toEqual(["flying"]);
    expect(convert("Typhoid Rats").def).toMatchObject({ power: 1, toughness: 1, keywords: ["deathtouch"] });
  });

  it("converts an enter-the-battlefield discard trigger", () => {
    expect(convert("Ravenous Rats").def).toMatchObject({
      types: ["creature"],
      power: 1,
      toughness: 1,
      effects: [{ kind: "discard", amount: 1, target: "opponent" }],
    });
  });

  it("converts a tap-cost activated ability with a pump effect", () => {
    expect(convert("Rabid Rats").def).toMatchObject({
      types: ["creature"],
      power: 1,
      toughness: 1,
      abilities: [
        {
          cost: [{ kind: "tap" }],
          effect: { kind: "pump", power: -1, toughness: -1, target: "blocking_creature", duration: "until_end_of_turn" },
        },
      ],
    });
  });

  it("converts 'each opponent discards' like 'target opponent discards' (two players only)", () => {
    for (const name of ["Burglar Rat", "Rank Rat", "Nezumi Informant"]) {
      expect(convert(name).def?.effects).toEqual([{ kind: "discard", amount: 1, target: "opponent" }]);
    }
  });

  it("converts evasion keywords", () => {
    expect(convert("Razortooth Rats").def?.keywords).toEqual(["fear"]);
    expect(convert("Elephant-Rat").def?.keywords).toEqual(["menace"]);
    expect(convert("Rancid Rats").def?.keywords).toEqual(["skulk", "deathtouch"]);
  });

  it("converts 'this creature can't block'", () => {
    expect(convert("Nezumi Cutthroat").def?.keywords).toEqual(["fear", "cant_block"]);
  });

  it("converts removal, card draw and compound spells", () => {
    expect(convert("Murder").def?.effects).toEqual([{ kind: "destroy", target: "creature" }]);
    expect(convert("Divination").def?.effects).toEqual([{ kind: "draw", amount: 2, target: "self" }]);
    expect(convert("Lightning Helix").def?.effects).toEqual([
      { kind: "damage", amount: 3, target: "any" },
      { kind: "gain_life", amount: 3, target: "self" },
    ]);
    expect(convert("Lava Axe").def?.effects).toEqual([{ kind: "damage", amount: 5, target: "opponent" }]);
  });

  it("converts a pump spell (shares the same clause the Rabid Rats ability uses)", () => {
    expect(convert("Giant Growth").def?.effects).toEqual([
      { kind: "pump", power: 3, toughness: 3, target: "creature", duration: "until_end_of_turn" },
    ]);
  });
});

describe("convertScryfallCard: refuses to run cards it would get wrong", () => {
  const unsupported: [string, RegExp][] = [
    ["Shivan Dragon", /Ability "\{R\}: This creature gets \+1\/\+0/],
    ["Goblin Guide", /Ability "Haste"|Ability "Whenever this creature attacks/],
    ["Doom Blade", /nonblack/],
    ["Terror", /nonartifact/],
    ["Healing Salve", /Choose one/],
    ["Llanowar Elves", /Ability "\{T\}: Add \{G\}\."/],
    ["Counterspell", /Counter target spell/],
    ["Brazen Borrower", /Layout "adventure"/],
    ["Delver of Secrets", /Layout "transform"/],
    ["Tarmogoyf", /Power\/toughness/],
    ["Fireball", /\{X\}/],
    ["Evolving Wilds", /one fixed colour/],
    ["Boros Guildgate", /one fixed colour/],
    ["Sol Ring", /Card type "artifact"/],
    ["Dryad Arbor", /Land creatures/],
  ];

  it.each(unsupported)("%s", (name, reason) => {
    const result = convert(name);
    expect(result.def).toBeNull();
    expect(result.unsupported.join(" | ")).toMatch(reason);
  });

  it("every card in the fixture either converts or explains why not", () => {
    for (const card of fixture.data) {
      const r = convertScryfallCard(card);
      expect(r.def !== null || r.unsupported.length > 0, card.name).toBe(true);
      if (r.def) expect(r.unsupported).toEqual([]);
    }
  });
});

describe("parseDecklist", () => {
  it("parses common export formats", () => {
    const { entries, skipped } = parseDecklist(
      [
        "Deck",
        "4 Lightning Bolt (M11) 149",
        "2x Grizzly Bears",
        "// a comment",
        "Forest",
        "",
        "4 lightning bolt",
        "Sideboard",
        "3 Doom Blade",
      ].join("\n"),
    );
    expect(entries).toEqual([
      { name: "Lightning Bolt", count: 8 },
      { name: "Grizzly Bears", count: 2 },
      { name: "Forest", count: 1 },
    ]);
    expect(skipped).toEqual([]);
  });

  it("reports lines it can't read instead of dropping them", () => {
    expect(parseDecklist("4 Lightning Bolt\n4 12345\n999 Forest").skipped).toEqual(["4 12345", "999 Forest"]);
  });

  it("handles Windows line endings", () => {
    expect(parseDecklist("2 Forest\r\n1 Island\r\n").entries).toHaveLength(2);
  });

  it("parses Forge .dck exports: metadata, section headers and set-coded lines", () => {
    const { entries, skipped } = parseDecklist(
      [
        "[metadata]",
        "Name=Rat commander (Marrow-Gnawer)",
        "Deck Type=constructed",
        "[Commander]",
        "1 Marrow-Gnawer|CHK",
        "[Main]",
        "1 Murder|M13",
        "31 Swamp|LEA|2",
        "[sideboard]",
        "2 Doom Blade|M13",
      ].join("\n"),
    );
    expect(entries).toEqual([
      { name: "Marrow-Gnawer", count: 1 },
      { name: "Murder", count: 1 },
      { name: "Swamp", count: 31 },
    ]);
    expect(skipped).toEqual([]);
  });
});

// ---- client -----------------------------------------------------------------

function mockFetch(handler: (names: string[], call: number) => { status?: number; body: unknown; retryAfter?: string }) {
  const calls: { url: string; headers: Record<string, string>; names: string[] }[] = [];
  const fn: FetchLike = async (url, init) => {
    const names = (JSON.parse(init.body) as { identifiers: { name: string }[] }).identifiers.map((i) => i.name);
    calls.push({ url, headers: init.headers, names });
    const r = handler(names, calls.length);
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (h: string) => (h.toLowerCase() === "retry-after" ? (r.retryAfter ?? null) : null) },
      json: async () => r.body,
    };
  };
  return { fn, calls };
}

/** Behaves like Scryfall for the names present in the fixture. */
const fixtureServer = (names: string[]) => {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  const faces = (c: ScryfallCard) => [c.name, ...c.name.split(" // ")].map((s) => s.toLowerCase());
  const data = fixture.data.filter((c) => faces(c).some((f) => wanted.has(f)));
  const found = new Set(data.flatMap(faces));
  return {
    body: {
      object: "list",
      data,
      not_found: names.filter((n) => !found.has(n.toLowerCase())).map((name) => ({ name })),
    },
  };
};

describe("fetchCardsByName", () => {
  it("batches 75 names per request and pauses between requests", async () => {
    const names = Array.from({ length: 160 }, (_, i) => `Card ${i}`);
    const { fn, calls } = mockFetch((n) => ({ body: { object: "list", data: [], not_found: n.map((name) => ({ name })) } }));
    const sleeps: number[] = [];
    const progress: number[] = [];
    const result = await fetchCardsByName(names, {
      fetch: fn,
      sleep: async (ms) => void sleeps.push(ms),
      onProgress: (done) => progress.push(done),
    });
    expect(calls.map((c) => c.names.length)).toEqual([75, 75, 10]);
    expect(calls.every((c) => c.url === "https://api.scryfall.com/cards/collection")).toBe(true);
    expect(sleeps).toEqual([100, 100]);
    expect(progress).toEqual([75, 150, 160]);
    expect(result.notFound).toHaveLength(160);
  });

  it("sends Accept/Content-Type and only sets User-Agent when asked", async () => {
    const a = mockFetch((n) => fixtureServer(n));
    await fetchCardsByName(["Forest"], { fetch: a.fn });
    expect(a.calls[0]?.headers).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
    const b = mockFetch((n) => fixtureServer(n));
    await fetchCardsByName(["Forest"], { fetch: b.fn, userAgent: "cwb-foundry/0.1" });
    expect(b.calls[0]?.headers["User-Agent"]).toBe("cwb-foundry/0.1");
  });

  it("retries on 429, honouring Retry-After", async () => {
    const sleeps: number[] = [];
    const { fn, calls } = mockFetch((n, call) =>
      call === 1 ? { status: 429, body: { details: "slow down" }, retryAfter: "2" } : fixtureServer(n),
    );
    const r = await fetchCardsByName(["Forest"], { fetch: fn, sleep: async (ms) => void sleeps.push(ms) });
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
    expect(r.cards.map((c) => c.name)).toEqual(["Forest"]);
  });

  it("gives up after repeated 429s and surfaces API errors", async () => {
    const limited = mockFetch(() => ({ status: 429, body: {} }));
    await expect(fetchCardsByName(["Forest"], { fetch: limited.fn, sleep: async () => {} })).rejects.toThrow(/rate-limiting/);
    const bad = mockFetch(() => ({ status: 400, body: { object: "error", details: "Bad request" } }));
    await expect(fetchCardsByName(["Forest"], { fetch: bad.fn })).rejects.toThrow("Scryfall request failed (400): Bad request");
  });
});

// ---- whole import -------------------------------------------------------------

describe("importDecklist", () => {
  const list = [
    "4 Lightning Bolt",
    "10 Mountain",
    "2 Grizzly Bears",
    "3 Doom Blade",
    "1 Brazen Borrower",
    "2 Nonexistent Card Zzzq",
  ].join("\n");

  it("builds a playable deck and reports everything it skipped, with reasons", async () => {
    const { fn, calls } = mockFetch((n) => fixtureServer(n));
    const deck = await importDecklist(list, { fetch: fn });
    expect(calls).toHaveLength(1);

    expect(deck.cards.filter((c) => c === "mtg_lightning_bolt")).toHaveLength(4);
    expect(deck.cards.filter((c) => c === "mtg_mountain")).toHaveLength(10);
    expect(deck.playableCount).toBe(16);
    expect(deck.skippedCount).toBe(6);
    expect(Object.keys(deck.defs).sort()).toEqual(["mtg_grizzly_bears", "mtg_lightning_bolt", "mtg_mountain"]);

    const status = Object.fromEntries(deck.rows.map((r) => [r.name, r.status]));
    expect(status).toMatchObject({
      "Lightning Bolt": "ok",
      "Doom Blade": "unsupported",
      "Brazen Borrower // Petty Theft": "unsupported",
      "Nonexistent Card Zzzq": "not_found",
    });
    expect(deck.rows.find((r) => r.name === "Doom Blade")?.reasons.join(" ")).toMatch(/nonblack/);
  });

  it("uses the cache so repeat imports make no API calls", async () => {
    const cache = new Map();
    const first = mockFetch((n) => fixtureServer(n));
    await importDecklist("4 Lightning Bolt\n2 Forest", { fetch: first.fn, cache });
    const second = mockFetch(() => {
      throw new Error("should not be called");
    });
    const again = await importDecklist("2 Lightning Bolt\n1 Forest", { fetch: second.fn, cache });
    expect(second.calls).toHaveLength(0);
    expect(again.playableCount).toBe(3);
  });

  it("matches a single face name to a double-faced card", async () => {
    const { fn } = mockFetch((n) => fixtureServer(n));
    const deck = await importDecklist("1 Brazen Borrower", { fetch: fn });
    expect(deck.rows[0]).toMatchObject({ name: "Brazen Borrower // Petty Theft", status: "unsupported" });
  });
});

// ---- live (opt-in) -------------------------------------------------------------

const live = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SCRYFALL_LIVE;

describe.skipIf(!live)("live Scryfall (set SCRYFALL_LIVE=1)", () => {
  it("imports a real decklist from the real API", async () => {
    const deck = await importDecklist("4 Lightning Bolt\n4 Grizzly Bears\n8 Mountain\n8 Forest\n2 Doom Blade", {
      fetch: (globalThis as unknown as { fetch: FetchLike }).fetch,
      userAgent: "cwb-foundry/0.1",
    });
    expect(deck.playableCount).toBe(24);
    expect(deck.rows.find((r) => r.name === "Doom Blade")?.status).toBe("unsupported");
  }, 30000);
});
