import { describe, expect, it } from "vitest";
import { applyAction, createGame, mtgPack, type CardDefs, type Ruleset } from "@cwb/engine";
import { convertScryfallCard, type ScryfallCollectionResponse } from "@cwb/cards";
import { chooseAction } from "../src";
import raw from "../../cards/test/fixtures/scryfall-collection.json";

// Cards converted from (trimmed) real Scryfall data, played by the real engine and AI.
const fixture = raw as unknown as ScryfallCollectionResponse;
const defs: CardDefs = {};
for (const card of fixture.data) {
  const { def } = convertScryfallCard(card);
  if (def) defs[def.id] = def;
}
const rules: Ruleset = { pack: mtgPack, defs };

const deck = (list: Record<string, number>) =>
  Object.entries(list).flatMap(([id, n]) => Array.from({ length: n }, () => id));

const imported = deck({
  mtg_mountain: 6,
  mtg_forest: 6,
  mtg_plains: 5,
  mtg_lightning_bolt: 3,
  mtg_shock: 3,
  mtg_lava_axe: 2,
  mtg_lightning_helix: 3,
  mtg_grizzly_bears: 7,
  mtg_serra_angel: 2,
  mtg_hill_giant: 3,
});

// Black deck exercising abilities, triggers and the evasion/combat keywords end to end.
const rats = deck({
  mtg_swamp: 16,
  mtg_typhoid_rats: 3,
  mtg_rabid_rats: 3,
  mtg_crypt_rats: 3,
  mtg_ratcatcher: 2,
  mtg_elephant_rat: 3,
  mtg_razortooth_rats: 2,
  mtg_rancid_rats: 1,
  mtg_nezumi_cutthroat: 2,
  mtg_engine_rat: 2,
  mtg_disease_carriers: 3,
});

describe("imported cards run in the real engine", () => {
  it("the imported deck is a legal 40-card deck of cards the engine knows", () => {
    expect(imported).toHaveLength(40);
    for (const id of imported) expect(defs[id], id).toBeDefined();
  });

  it("AI plays 30 full games with imported cards, never choosing an illegal action", () => {
    const winners = new Set<string | null>();
    let helixCast = 0;
    for (let seed = 1; seed <= 30; seed++) {
      let state = createGame(rules, { decks: { p1: imported, p2: imported }, seed });
      for (let i = 0; i < 4000 && !state.over; i++) {
        const action = chooseAction(rules, state);
        const r = applyAction(rules, state, action);
        if (!r.ok) throw new Error(`seed ${seed}: illegal action (${r.error}): ${JSON.stringify(action)}`);
        state = r.state;
      }
      expect(state.over, `seed ${seed} didn't finish`).toBe(true);
      winners.add(state.winner);
      helixCast += state.log.filter((l) => l === "Lightning Helix resolves").length;
    }
    expect(winners.has("p1") && winners.has("p2")).toBe(true);
    expect(helixCast).toBeGreaterThan(0); // compound spells actually get cast
  });

  it("AI plays 30 full games with a Rat deck (abilities, triggers, keywords) without an illegal action", () => {
    expect(rats).toHaveLength(40);
    for (const id of rats) expect(defs[id], id).toBeDefined();
    let triggers = 0;
    let sweeps = 0;
    let searches = 0;
    for (let seed = 1; seed <= 30; seed++) {
      let state = createGame(rules, { decks: { p1: rats, p2: rats }, seed });
      for (let i = 0; i < 6000 && !state.over; i++) {
        const action = chooseAction(rules, state);
        const r = applyAction(rules, state, action);
        if (!r.ok) throw new Error(`seed ${seed}: illegal action (${r.error}): ${JSON.stringify(action)}`);
        state = r.state;
      }
      expect(state.over, `seed ${seed} didn't finish`).toBe(true);
      triggers += state.log.filter((l) => l.endsWith("'s ability triggers")).length;
      searches += state.log.filter((l) => l.includes("puts it into their hand, and shuffles")).length;
      sweeps += state.log.filter((l) => l.endsWith("damage is dealt to each creature and each player")).length;
    }
    expect(triggers).toBeGreaterThan(0);
    expect(sweeps).toBeGreaterThan(0); // the AI does use Crypt Rats
    expect(searches).toBeGreaterThan(0); // and Ratcatcher finds Rats
  });
});
