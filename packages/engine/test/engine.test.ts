import { describe, expect, it } from "vitest";
import { applyAction, clone, createGame, getLegalActions, type Action, type GameState } from "../src";
import { deck, give, newGame, passUntilPhase, rules } from "./fixtures";

function ok(state: GameState, action: Action): GameState {
  const r = applyAction(rules, state, action);
  if (!r.ok) throw new Error(`Expected ok, got: ${r.error}`);
  return r.state;
}

describe("setup", () => {
  it("deals opening hands and starting life", () => {
    const s = newGame();
    expect(s.players.p1?.hand).toHaveLength(7);
    expect(s.players.p2?.hand).toHaveLength(7);
    expect(s.players.p1?.life).toBe(20);
    expect(s.players.p1?.library).toHaveLength(23);
  });

  it("is deterministic for the same seed and differs across seeds", () => {
    expect(newGame(7)).toEqual(newGame(7));
    expect(newGame(7).players.p1?.library).not.toEqual(newGame(8).players.p1?.library);
  });

  it("rejects unknown cards and wrong player counts", () => {
    expect(() => createGame(rules, { decks: { p1: ["nope"], p2: deck() } })).toThrow(/Unknown card/);
    expect(() => createGame(rules, { decks: { p1: deck() } })).toThrow(/two players/);
  });
});

describe("turn structure", () => {
  it("starts in upkeep (untap has no priority) and skips the first player's first draw", () => {
    let s = newGame();
    expect(rules.pack.phases[s.phaseIndex]?.id).toBe("upkeep");
    s = passUntilPhase(s, "main1");
    expect(s.players.p1?.hand).toHaveLength(7);
    expect(s.activePlayer).toBe("p1");
  });

  it("passes the turn to the opponent, who draws", () => {
    let s = passUntilPhase(newGame(), "main1");
    s = passUntilPhase(s, "upkeep"); // next turn
    expect(s.activePlayer).toBe("p2");
    s = passUntilPhase(s, "main1");
    expect(s.players.p2?.hand).toHaveLength(8);
    expect(s.turn).toBe(2);
  });
});

describe("lands and mana", () => {
  it("allows one land per turn, only in a main phase", () => {
    let s = newGame();
    const a = give(s, "p1", "forest", "hand");
    const b = give(a.state, "p1", "forest", "hand");
    s = b.state;
    // upkeep: not a main phase
    expect(applyAction(rules, s, { type: "PLAY_LAND", player: "p1", cardId: a.id }).ok).toBe(false);
    s = passUntilPhase(s, "main1");
    s = ok(s, { type: "PLAY_LAND", player: "p1", cardId: a.id });
    const second = applyAction(rules, s, { type: "PLAY_LAND", player: "p1", cardId: b.id });
    expect(second).toEqual({ ok: false, error: "No land drops left this turn" });
  });

  it("requires coloured mana from matching lands", () => {
    let s = passUntilPhase(newGame(), "main1");
    const forest = give(s, "p1", "forest", "battlefield");
    const bolt = give(forest.state, "p1", "bolt", "hand");
    s = bolt.state;
    const r = applyAction(rules, s, { type: "CAST", player: "p1", cardId: bolt.id });
    expect(r).toEqual({ ok: false, error: "Cannot pay the cost" });

    const mountain = give(s, "p1", "mountain", "battlefield");
    expect(applyAction(rules, mountain.state, { type: "CAST", player: "p1", cardId: bolt.id }).ok).toBe(true);
  });

  it("pays coloured costs first, then generic, and taps the lands used", () => {
    let s = passUntilPhase(newGame(), "main1");
    const f = give(s, "p1", "forest", "battlefield");
    const m = give(f.state, "p1", "mountain", "battlefield");
    const bear = give(m.state, "p1", "bear", "hand"); // {1}{G}
    s = ok(bear.state, { type: "CAST", player: "p1", cardId: bear.id });
    expect(s.cards[f.id]?.tapped).toBe(true);
    expect(s.cards[m.id]?.tapped).toBe(true);
    expect(s.stack).toHaveLength(1);
  });
});

describe("the stack and priority", () => {
  it("gives the opponent priority to respond; responses resolve first (LIFO)", () => {
    let s = passUntilPhase(newGame(), "main1");
    const m = give(s, "p1", "mountain", "battlefield");
    const bolt = give(m.state, "p1", "bolt", "hand");
    const f = give(bolt.state, "p2", "forest", "battlefield");
    const tonic = give(f.state, "p2", "tonic", "hand");
    s = tonic.state;

    s = ok(s, { type: "CAST", player: "p1", cardId: bolt.id });
    expect(s.priority).toBe("p1");
    s = ok(s, { type: "PASS", player: "p1" });
    expect(s.priority).toBe("p2");

    s = ok(s, { type: "CAST", player: "p2", cardId: tonic.id }); // response
    expect(s.stack.map((i) => i.cardId)).toEqual([bolt.id, tonic.id]);

    // Both pass: top of stack (tonic) resolves first.
    s = ok(s, { type: "PASS", player: "p2" });
    s = ok(s, { type: "PASS", player: "p1" });
    expect(s.players.p2?.life).toBe(23);
    expect(s.stack).toHaveLength(1);
    expect(s.priority).toBe("p1"); // active player gets priority after resolution

    s = ok(s, { type: "PASS", player: "p1" });
    s = ok(s, { type: "PASS", player: "p2" });
    expect(s.players.p2?.life).toBe(20);
    expect(s.stack).toHaveLength(0);
    expect(s.players.p2?.graveyard).toContain(tonic.id);
  });

  it("only allows sorcery-speed spells on your own turn with an empty stack", () => {
    let s = passUntilPhase(newGame(), "main1");
    const f = give(s, "p1", "forest", "battlefield");
    const f2 = give(f.state, "p2", "forest", "battlefield");
    const study = give(f2.state, "p2", "study", "hand");
    s = study.state;
    s = ok(s, { type: "PASS", player: "p1" });
    // p2 has priority during p1's main phase: sorcery is illegal.
    expect(applyAction(rules, s, { type: "CAST", player: "p2", cardId: study.id })).toEqual({
      ok: false,
      error: "Only instants can be cast now",
    });
  });

  it("rejects actions from a player without priority", () => {
    const s = newGame();
    expect(applyAction(rules, s, { type: "PASS", player: "p2" })).toEqual({
      ok: false,
      error: "You do not have priority",
    });
  });
});

describe("winning and losing", () => {
  it("ends the game when life reaches zero", () => {
    let s = passUntilPhase(newGame(), "main1");
    const m = give(s, "p1", "mountain", "battlefield");
    const bolt = give(m.state, "p1", "bolt", "hand");
    s = clone(bolt.state);
    (s.players.p2 as { life: number }).life = 3;
    s = ok(s, { type: "CAST", player: "p1", cardId: bolt.id });
    s = ok(s, { type: "PASS", player: "p1" });
    s = ok(s, { type: "PASS", player: "p2" });
    expect(s.over).toBe(true);
    expect(s.winner).toBe("p1");
    expect(getLegalActions(rules, s)).toEqual([]);
  });

  it("loses when drawing from an empty library", () => {
    // p2 has exactly 7 cards: the opening hand empties the library.
    const s0 = createGame(rules, { decks: { p1: deck(30), p2: deck(7) }, seed: 3 });
    let s = s0;
    for (let i = 0; i < 60 && !s.over && s.turn < 3; i++) {
      s = ok(s, { type: "PASS", player: s.priority });
    }
    expect(s.turn).toBe(2); // p2's draw on turn 2 ended the game
    expect(s.over).toBe(true);
    expect(s.winner).toBe("p1");
  });
});

describe("purity and legal actions", () => {
  it("never mutates the input state, even on illegal actions", () => {
    const s = newGame();
    const snapshot = clone(s);
    applyAction(rules, s, { type: "PASS", player: "p1" });
    applyAction(rules, s, { type: "PASS", player: "p2" });
    expect(s).toEqual(snapshot);
  });

  it("every legal action applies successfully", () => {
    let s = passUntilPhase(newGame(5), "main1");
    const m = give(s, "p1", "mountain", "battlefield");
    s = give(m.state, "p1", "bolt", "hand").state;
    const legal = getLegalActions(rules, s);
    expect(legal.length).toBeGreaterThan(1);
    for (const a of legal) expect(applyAction(rules, s, a).ok).toBe(true);
  });
});
