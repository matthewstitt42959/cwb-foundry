import type { Ability, CardDef, CardType, Cost, Effect, Keyword, ManaCost, Trigger } from "@cwb/engine";
import type { ScryfallCard } from "./types";

/**
 * Convert a Scryfall card into an engine CardDef, or explain why we can't.
 *
 * The rule is "never run a card wrongly": anything the engine can't represent exactly
 * (abilities, X costs, hybrid mana, restrictions like "nonblack", multi-faced cards...)
 * produces `def: null` plus human-readable reasons, instead of a quietly different card.
 */
export interface ConvertResult {
  name: string;
  def: CardDef | null;
  /** Why the card can't be used. Empty when `def` is set. */
  unsupported: string[];
}

const SUPPORTED_KEYWORDS: Record<string, Keyword> = {
  flying: "flying",
  haste: "haste",
  vigilance: "vigilance",
  deathtouch: "deathtouch",
  fear: "fear",
  menace: "menace",
  skulk: "skulk",
  lifelink: "lifelink",
  trample: "trample",
  "first strike": "first_strike",
};

const BASIC_COLORS = ["W", "U", "B", "R", "G"] as const;
type BasicColor = (typeof BASIC_COLORS)[number];

const SUPERTYPES = new Set(["basic", "legendary", "snow", "world", "ongoing"]);

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** "{2}{G}{G}" -> { generic: 2, G: 2 }. Reports symbols the engine can't pay. */
export function parseManaCost(raw: string | undefined): { cost: ManaCost; problems: string[] } {
  const cost: ManaCost = {};
  const problems: string[] = [];
  for (const [, sym = ""] of (raw ?? "").matchAll(/\{([^}]+)\}/g)) {
    if (/^\d+$/.test(sym)) {
      cost.generic = (cost.generic ?? 0) + Number(sym);
    } else if ((BASIC_COLORS as readonly string[]).includes(sym)) {
      const c = sym as BasicColor;
      cost[c] = (cost[c] ?? 0) + 1;
    } else {
      problems.push(`Mana symbol {${sym}} isn't supported`);
    }
  }
  return { cost, problems };
}

function stripReminderText(line: string): string {
  return line.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

function parseCount(word: string): number | null {
  if (/^\d+$/.test(word)) return Number(word);
  return NUMBER_WORDS[word] ?? null;
}

/** Parse one clause of spell text into an effect, or null if we don't understand it. */
function parseClause(clause: string): Effect | null {
  let m: RegExpMatchArray | null;
  if ((m = clause.match(/^~ deals (\d+) damage to any target$/))) {
    return { kind: "damage", amount: Number(m[1]), target: "any" };
  }
  if ((m = clause.match(/^~ deals (\d+) damage to target creature$/))) {
    return { kind: "damage", amount: Number(m[1]), target: "creature" };
  }
  // Two-player engine with no planeswalkers: these can only usefully hit the opponent.
  if ((m = clause.match(/^~ deals (\d+) damage to (?:target opponent|target player|target player or planeswalker|each opponent)$/))) {
    return { kind: "damage", amount: Number(m[1]), target: "opponent" };
  }
  if ((m = clause.match(/^(?:target|each) opponent loses (\w+) life$/))) {
    const n = parseCount(m[1] ?? "");
    return n ? { kind: "lose_life", amount: n, target: "opponent" } : null;
  }
  if (clause === "destroy target creature") return { kind: "destroy", target: "creature" };
  if ((m = clause.match(/^you gain (\w+) life$/))) {
    const n = parseCount(m[1] ?? "");
    return n ? { kind: "gain_life", amount: n, target: "self" } : null;
  }
  if ((m = clause.match(/^draw (\w+) cards?$/))) {
    const n = parseCount(m[1] ?? "");
    return n ? { kind: "draw", amount: n, target: "self" } : null;
  }
  // Two players only, so "each opponent" is the same single player as "target opponent".
  if ((m = clause.match(/^(?:target|each) opponent discards? (\w+) cards?$/))) {
    const n = parseCount(m[1] ?? "");
    return n ? { kind: "discard", amount: n, target: "opponent" } : null;
  }
  if ((m = clause.match(/^target (blocking creature|creature) gets ([+-]\d+)\/([+-]\d+) until end of turn$/))) {
    return {
      kind: "pump",
      power: Number(m[2]),
      toughness: Number(m[3]),
      target: m[1] === "blocking creature" ? "blocking_creature" : "creature",
      duration: "until_end_of_turn",
    };
  }
  return null;
}

/**
 * Parses an activated ability line: comma-separated costs ({T} and/or mana such as
 * "{5}{B}"), a colon, then one effect clause. Any other cost (sacrifice, discard, life,
 * X, hybrid mana...) makes the whole line unsupported.
 */
function parseActivatedAbility(normalizedLine: string): Ability | null {
  const m = normalizedLine.match(/^([^:]+):\s*(.+?)\.?$/);
  if (!m) return null;
  const cost: Cost[] = [];
  for (const part of (m[1] ?? "").split(/,\s*/)) {
    if (/^\{t\}$/i.test(part)) {
      cost.push({ kind: "tap" });
    } else if (/^(\{[^}]+\})+$/.test(part)) {
      const { cost: mana, problems } = parseManaCost(part);
      if (problems.length > 0) return null;
      cost.push({ kind: "mana", cost: mana });
    } else {
      return null;
    }
  }
  const effect = parseClause((m[2] ?? "").trim().toLowerCase());
  return effect ? { cost, effect } : null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseSpellText(text: string, name: string): { effects: Effect[]; problems: string[] } {
  const effects: Effect[] = [];
  const problems: string[] = [];
  const lines = text
    .split("\n")
    .map(stripReminderText)
    .filter(Boolean);
  const escaped = escapeRegExp(name);

  for (const line of lines) {
    const normalized = line.replace(new RegExp(escaped, "gi"), "~").replace(/\bthis spell\b/gi, "~");
    for (const sentence of normalized.split(/\.\s+/)) {
      const s = sentence.replace(/\.$/, "").trim();
      if (!s) continue;
      const clauses = s.split(/ and /i).map((c) => c.trim().toLowerCase().replace(/^~/, "~"));
      const parsed = clauses.map(parseClause);
      if (parsed.every((e): e is Effect => e !== null)) {
        effects.push(...parsed);
      } else {
        problems.push(`Rules text "${s}" isn't supported yet`);
      }
    }
  }
  if (effects.length === 0 && problems.length === 0) problems.push("Has no rules text the engine can run");
  return { effects, problems };
}

function parseKeywordLine(line: string): Keyword[] | null {
  const parts = line.split(/,\s*|;\s*/).map((p) => p.trim().toLowerCase());
  const out: Keyword[] = [];
  for (const p of parts) {
    const kw = SUPPORTED_KEYWORDS[p];
    if (!kw) return null;
    out.push(kw);
  }
  return out;
}

export function convertScryfallCard(card: ScryfallCard): ConvertResult {
  const fail = (...reasons: string[]): ConvertResult => ({ name: card.name, def: null, unsupported: reasons });

  if (card.layout !== "normal") {
    return fail(`Layout "${card.layout}" (multi-faced or special cards) isn't supported yet`);
  }

  // ---- types
  const typeLine = card.type_line ?? "";
  const words = (typeLine.split("—")[0] ?? "").split(/\s+/).filter(Boolean);
  const types = words.filter((w) => !SUPERTYPES.has(w.toLowerCase())).map((w) => w.toLowerCase());
  const isCreature = types.includes("creature");
  let cardType: CardType | null = null;
  if (isCreature) {
    if (types.includes("land")) return fail("Land creatures aren't supported yet");
    cardType = "creature";
  } else {
    const known = types.filter((t): t is CardType => t === "land" || t === "instant" || t === "sorcery");
    const other = types.filter((t) => !["land", "instant", "sorcery"].includes(t));
    if (other.length > 0) return fail(`Card type "${other.join(" ")}" isn't supported yet`);
    if (known.length !== 1) return fail(`Unrecognised type line "${typeLine}"`);
    cardType = known[0] ?? null;
  }
  if (!cardType) return fail(`Unrecognised type line "${typeLine}"`);

  // ---- cost
  const { cost, problems } = parseManaCost(card.mana_cost);
  const reasons: string[] = [...problems];
  const text = card.oracle_text ?? "";

  const base: CardDef = {
    id: `mtg_${slugify(card.name)}`,
    game: "mtg",
    name: card.name,
    types: [cardType],
  };
  if (card.image_uris?.normal) base.imageUrl = card.image_uris.normal;

  if (cardType === "land") {
    const produced = card.produced_mana ?? [];
    const color = produced.length === 1 ? produced[0] : undefined;
    if (!color || !(BASIC_COLORS as readonly string[]).includes(color)) {
      reasons.push("Only lands that make one fixed colour of mana are supported");
    } else {
      base.produces = color as BasicColor;
      // Allow only reminder text or the plain mana ability.
      for (const line of text.split("\n").map(stripReminderText).filter(Boolean)) {
        if (line !== `{T}: Add {${color}}.`) reasons.push(`Ability "${line}" isn't supported yet`);
      }
    }
    return reasons.length ? fail(...reasons) : { name: card.name, def: base, unsupported: [] };
  }

  base.cost = cost;

  if (cardType === "creature") {
    const power = /^\d+$/.test(card.power ?? "") ? Number(card.power) : null;
    const toughness = /^\d+$/.test(card.toughness ?? "") ? Number(card.toughness) : null;
    if (power === null || toughness === null || toughness < 1) {
      reasons.push(`Power/toughness "${card.power}/${card.toughness}" isn't supported (variable or zero toughness)`);
    } else {
      base.power = power;
      base.toughness = toughness;
    }
    const keywords: Keyword[] = [];
    const etbEffects: Effect[] = [];
    const abilities: Ability[] = [];
    const triggers: Trigger[] = [];
    const escapedName = escapeRegExp(card.name);
    for (const line of text.split("\n").map(stripReminderText).filter(Boolean)) {
      const normalized = line.replace(new RegExp(escapedName, "gi"), "~").replace(/\bthis creature\b/gi, "~");

      const etb = normalized.match(/^when ~ enters(?: the battlefield)?,\s*(.+?)\.?$/i);
      const etbEffect = etb ? parseClause((etb[1] ?? "").trim().toLowerCase()) : null;
      if (etbEffect) {
        etbEffects.push(etbEffect);
        continue;
      }

      const trig = normalized.match(/^when(?:ever)? ~ (dies|attacks),\s*(.+?)\.?$/i);
      const trigEffect = trig ? parseClause((trig[2] ?? "").trim().toLowerCase()) : null;
      if (trig && trigEffect) {
        triggers.push({ on: trig[1]?.toLowerCase() === "dies" ? "dies" : "attacks", effect: trigEffect });
        continue;
      }

      const ability = parseActivatedAbility(normalized);
      if (ability) {
        abilities.push(ability);
        continue;
      }

      if (/^~ can't block\.?$/i.test(normalized)) {
        keywords.push("cant_block");
        continue;
      }

      const kws = parseKeywordLine(line);
      if (kws) keywords.push(...kws);
      else reasons.push(`Ability "${line}" isn't supported yet`);
    }
    if (keywords.length) base.keywords = [...new Set(keywords)];
    if (etbEffects.length) base.effects = etbEffects;
    if (abilities.length) base.abilities = abilities;
    if (triggers.length) base.triggers = triggers;
  } else {
    const { effects, problems: textProblems } = parseSpellText(text, card.name);
    reasons.push(...textProblems);
    if (effects.length) base.effects = effects;
  }

  return reasons.length ? fail(...reasons) : { name: card.name, def: base, unsupported: [] };
}
