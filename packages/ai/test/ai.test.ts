import { describe, expect, it } from "vitest";
import { applyAction, createGame, mtgPack, type GameState, type Ruleset } from "@cwb/engine";
import { starterDecks, starterDefs } from "@cwb/cards";
import { chooseAction } from "../src";

const rules: Ruleset = { pack: mtgPack, defs: starterDefs };

function play(seed: number, a: number, b: number, maxActions = 4000): { state: GameState; actions: number } {
  const decks = {
    p1: starterDecks[a % starterDecks.length]!.cards,
    p2: starterDecks[b % starterDecks.length]!.cards,
  };
  let state = createGame(rules, { decks, seed });
  let actions = 0;
  while (!state.over && actions < maxActions) {
    const action = chooseAction(rules, state);
    const r = applyAction(rules, state, action);
    if (!r.ok) throw new Error(`AI chose an illegal action (${r.error}): ${JSON.stringify(action)}`);
    state = r.state;
    actions++;
  }
  return { state, actions };
}

describe("AI", () => {
  it("plays complete games against itself without ever choosing an illegal action", () => {
    const results = [];
    for (let seed = 1; seed <= 40; seed++) {
      const { state, actions } = play(seed, seed, seed >> 1);
      expect(state.over, `seed ${seed} did not finish in ${actions} actions`).toBe(true);
      results.push(state.winner);
    }
    // Both seats win some games, so the AI isn't broken for one side.
    expect(results.filter((w) => w === "p1").length).toBeGreaterThan(3);
    expect(results.filter((w) => w === "p2").length).toBeGreaterThan(3);
  });

  it("is deterministic", () => {
    expect(play(7, 0, 1).state).toEqual(play(7, 0, 1).state);
  });

  it("actually fights: creatures die and players take damage across games", () => {
    let combatDeaths = 0;
    let lifeLoss = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { state } = play(seed, 0, 1);
      combatDeaths += state.log.filter((l) => l.endsWith(" dies")).length;
      lifeLoss += Object.values(state.players).reduce((s, p) => s + Math.max(0, 20 - p.life), 0);
    }
    expect(combatDeaths).toBeGreaterThan(0);
    expect(lifeLoss).toBeGreaterThan(0);
  });
});
