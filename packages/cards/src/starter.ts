import type { CardDef, CardDefs, Color, Cost, Effect, ManaCost } from "@cwb/engine";

/**
 * Starter set. Names and numbers are original to this project.
 * Real-card data will come from an importer later, not from this file.
 */
const GAME = "cwb";

const land = (id: string, name: string, produces: Color): CardDef => ({
  id,
  game: GAME,
  name,
  types: ["land"],
  produces,
});

const creature = (
  id: string,
  name: string,
  cost: ManaCost,
  power: number,
  toughness: number,
  keywords?: CardDef["keywords"],
): CardDef => ({
  id,
  game: GAME,
  name,
  types: ["creature"],
  cost,
  power,
  toughness,
  ...(keywords ? { keywords } : {}),
});

const defs: CardDef[] = [
  // Lands
  land("ember_flats", "Ember Flats", "R"),
  land("pine_hollow", "Pine Hollow", "G"),
  land("chapel_ruins", "Chapel Ruins", "W"),
  land("tide_shallows", "Tide Shallows", "U"),

  // Red / green
  creature("briar_cub", "Briar Cub", { G: 1 }, 1, 1),
  creature("moss_bear", "Moss Bear", { generic: 1, G: 1 }, 2, 2),
  creature("thicket_brute", "Thicket Brute", { generic: 2, G: 1 }, 3, 3),
  creature("cinder_imp", "Cinder Imp", { R: 1 }, 1, 1, ["haste"]),
  creature("ash_raider", "Ash Raider", { generic: 1, R: 1 }, 2, 1, ["haste"]),
  creature("lava_hound", "Lava Hound", { generic: 2, R: 1 }, 3, 2),
  {
    id: "spark",
    game: GAME,
    name: "Spark",
    types: ["instant"],
    cost: { R: 1 },
    effects: [{ kind: "damage", amount: 2, target: "any" }],
  },
  {
    id: "scorch",
    game: GAME,
    name: "Scorch",
    types: ["instant"],
    cost: { generic: 1, R: 1 },
    effects: [{ kind: "damage", amount: 3, target: "any" }],
  },
  {
    id: "wild_insight",
    game: GAME,
    name: "Wild Insight",
    types: ["sorcery"],
    cost: { generic: 1, G: 1 },
    effects: [{ kind: "draw", amount: 2, target: "self" }],
  },

  // White / blue
  creature("gull_scout", "Gull Scout", { U: 1 }, 1, 1, ["flying"]),
  creature("harbor_warden", "Harbor Warden", { generic: 1, U: 1 }, 1, 3),
  creature("temple_guard", "Temple Guard", { generic: 1, W: 1 }, 2, 2, ["vigilance"]),
  creature("cloud_drifter", "Cloud Drifter", { generic: 2, U: 1 }, 2, 2, ["flying"]),
  creature("marble_sentinel", "Marble Sentinel", { generic: 2, W: 1 }, 2, 4),
  creature("storm_roc", "Storm Roc", { generic: 3, U: 1 }, 3, 3, ["flying"]),
  {
    id: "smite",
    game: GAME,
    name: "Smite",
    types: ["instant"],
    cost: { generic: 2, W: 1 },
    effects: [{ kind: "destroy", target: "creature" }],
  },
  {
    id: "mend",
    game: GAME,
    name: "Mend",
    types: ["instant"],
    cost: { W: 1 },
    effects: [{ kind: "gain_life", amount: 4, target: "self" }],
  },
  {
    id: "clear_thought",
    game: GAME,
    name: "Clear Thought",
    types: ["sorcery"],
    cost: { generic: 1, U: 1 },
    effects: [{ kind: "draw", amount: 2, target: "self" }],
  },
];

export const starterDefs: CardDefs = Object.fromEntries(defs.map((d) => [d.id, d]));

function build(list: Record<string, number>): string[] {
  return Object.entries(list).flatMap(([id, n]) => Array.from({ length: n }, () => id));
}

export interface StarterDeck {
  id: string;
  name: string;
  blurb: string;
  cards: string[];
}

export const starterDecks: StarterDeck[] = [
  {
    id: "wildfire",
    name: "Wildfire",
    blurb: "Red/green. Fast creatures and burn that can hit creatures or faces.",
    cards: build({
      ember_flats: 8,
      pine_hollow: 8,
      briar_cub: 3,
      moss_bear: 3,
      thicket_brute: 3,
      cinder_imp: 3,
      ash_raider: 3,
      lava_hound: 2,
      spark: 3,
      scorch: 2,
      wild_insight: 2,
    }),
  },
  {
    id: "skyward",
    name: "Skyward",
    blurb: "White/blue. Flyers, sturdy blockers and removal.",
    cards: build({
      chapel_ruins: 8,
      tide_shallows: 8,
      gull_scout: 3,
      harbor_warden: 3,
      temple_guard: 3,
      cloud_drifter: 3,
      marble_sentinel: 3,
      storm_roc: 2,
      smite: 3,
      mend: 2,
      clear_thought: 2,
    }),
  },
];

/** Human-readable rules text derived from a definition's data. */
function effectText(e: Effect): string {
  const who = (t: string) => (t === "self" ? "you" : "your opponent");
  switch (e.kind) {
    case "damage":
      return e.target === "any"
        ? `Deal ${e.amount} damage to any target.`
        : e.target === "creature"
          ? `Deal ${e.amount} damage to target creature.`
          : `Deal ${e.amount} damage to ${who(e.target)}.`;
    case "draw":
      return `${cap(who(e.target))} draw${e.target === "self" ? "" : "s"} ${e.amount} cards.`;
    case "gain_life":
      return `${cap(who(e.target))} gain${e.target === "self" ? "" : "s"} ${e.amount} life.`;
    case "destroy":
      return "Destroy target creature.";
    case "damage_all":
      return `Deal ${e.amount === "x" ? "X" : e.amount} damage to each creature and each player.`;
    case "lose_life":
      return `${cap(who(e.target))} lose${e.target === "self" ? "" : "s"} ${e.amount} life.`;
    case "discard":
      return `${cap(who(e.target))} discard${e.target === "self" ? "" : "s"} ${e.amount} card${e.amount === 1 ? "" : "s"}.`;
    case "pump": {
      const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
      const noun = e.target === "blocking_creature" ? "target blocking creature" : "target creature";
      return `${cap(noun)} gets ${sign(e.power)}/${sign(e.toughness)} until end of turn.`;
    }
    default: {
      const exhaustive: never = e;
      throw new Error(`Unhandled effect kind: ${(exhaustive as { kind: string }).kind}`);
    }
  }
}

function costText(costs: Cost[]): string {
  return costs
    .map((c) => {
      if (c.kind === "tap") return "{T}";
      if (c.kind === "x") return c.only ? `{X} (only {${c.only}})` : "{X}";
      const generic = c.cost.generic ? `{${c.cost.generic}}` : "";
      return generic + (["W", "U", "B", "R", "G"] as const).map((k) => `{${k}}`.repeat(c.cost[k] ?? 0)).join("");
    })
    .join(", ");
}

export function cardText(def: CardDef): string {
  const parts: string[] = [];
  if (def.keywords?.length) parts.push(def.keywords.map(keywordText).join(", "));
  for (const e of def.effects ?? []) parts.push(effectText(e));
  for (const a of def.abilities ?? []) parts.push(`${costText(a.cost)}: ${effectText(a.effect)}`);
  for (const t of def.triggers ?? []) {
    parts.push(`${t.on === "dies" ? "When this creature dies," : "Whenever this creature attacks,"} ${lower(effectText(t.effect))}`);
  }
  return parts.join(" ");
}

function keywordText(k: string): string {
  if (k === "cant_block") return "Can't block";
  if (k === "first_strike") return "First strike";
  return cap(k);
}

function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
