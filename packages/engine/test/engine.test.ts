import { describe, expect, it } from "vitest";
import { applyAction, clone, createGame, getLegalActions, validateAction, type Action, type GameState } from "../src";
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
    expect(s.stack.map((i) => (i.kind === "spell" ? i.cardId : i.sourceId))).toEqual([bolt.id, tonic.id]);

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

describe("conceding", () => {
  it("ends the game immediately, even with a declaration pending", () => {
    const main = passUntilPhase(newGame(), "main1");
    const sprinter = give(main, "p1", "sprinter", "battlefield"); // haste: can attack the turn it enters
    let s = passUntilPhase(sprinter.state, "attackers");
    expect(s.pending).toBe("attackers"); // a declaration is pending; nothing else is normally legal
    expect(applyAction(rules, s, { type: "CONCEDE", player: "p1" })).toEqual({
      ok: true,
      state: expect.objectContaining({ over: true, winner: "p2" }),
    });
  });

  it("rejects a concede from an unknown player", () => {
    const s = newGame();
    expect(applyAction(rules, s, { type: "CONCEDE", player: "nobody" }).ok).toBe(false);
  });
});

describe("reclaiming a graveyard", () => {
  function withEmptyLibrary(graveyardSize: number): GameState {
    const s = clone(passUntilPhase(newGame(), "main1"));
    const p1 = s.players.p1 as { library: string[]; graveyard: string[] };
    p1.graveyard = p1.library.slice(0, graveyardSize);
    p1.library = [];
    return s;
  }

  it("shuffles the graveyard back into the library", () => {
    const s0 = withEmptyLibrary(5);
    const s = ok(s0, { type: "RECLAIM_GRAVEYARD", player: "p1" });
    expect(s.players.p1?.library).toHaveLength(5);
    expect(s.players.p1?.graveyard).toHaveLength(0);
  });

  it("rejects it unless the library is actually empty", () => {
    const s = passUntilPhase(newGame(), "main1");
    expect(validateAction(rules, s, { type: "RECLAIM_GRAVEYARD", player: "p1" })).toMatch(/isn't empty/);
  });

  it("rejects it when the graveyard is empty too", () => {
    const s = withEmptyLibrary(0);
    expect(validateAction(rules, s, { type: "RECLAIM_GRAVEYARD", player: "p1" })).toMatch(/graveyard is empty/);
  });

  it("is offered by getLegalActions once the library is empty", () => {
    const s = withEmptyLibrary(3);
    expect(getLegalActions(rules, s)).toContainEqual({ type: "RECLAIM_GRAVEYARD", player: "p1" });
  });
});

describe("creatures with enter-the-battlefield effects", () => {
  it("runs the effect once it resolves, and the opponent must discard", () => {
    let s = passUntilPhase(newGame(), "main1");
    const g = give(s, "p1", "mountain", "battlefield");
    const imp = give(g.state, "p1", "imp", "hand");
    s = imp.state;
    const handBefore = s.players.p2?.hand ?? [];
    expect(handBefore.length).toBeGreaterThan(0);

    s = ok(s, { type: "CAST", player: "p1", cardId: imp.id });
    s = ok(s, { type: "PASS", player: "p1" });
    s = ok(s, { type: "PASS", player: "p2" }); // resolves: imp enters, its ETB effect fires

    expect(s.players.p1?.battlefield).toContain(imp.id);
    expect(s.pending).toBe("discard");
    expect(s.discard).toEqual({ player: "p2", count: 1 });
    expect(s.priority).toBe("p2");
    expect(applyAction(rules, s, { type: "PASS", player: "p2" })).toEqual({
      ok: false,
      error: "Discard a card first",
    });

    const choice = handBefore[0] as string;
    s = ok(s, { type: "DISCARD", player: "p2", cardIds: [choice] });
    expect(s.pending).toBeNull();
    expect(s.discard).toBeNull();
    expect(s.players.p2?.hand).not.toContain(choice);
    expect(s.players.p2?.graveyard).toContain(choice);
    expect(s.priority).toBe("p1");
  });

  it("is a no-op when the discarding player's hand is already empty", () => {
    let s = passUntilPhase(newGame(), "main1");
    const m = give(s, "p1", "mountain", "battlefield");
    const imp = give(m.state, "p1", "imp", "hand");
    s = clone(imp.state);
    (s.players.p2 as { hand: string[] }).hand = [];

    s = ok(s, { type: "CAST", player: "p1", cardId: imp.id });
    s = ok(s, { type: "PASS", player: "p1" });
    s = ok(s, { type: "PASS", player: "p2" });
    expect(s.players.p1?.battlefield).toContain(imp.id);
    expect(s.pending).toBeNull(); // nothing to discard: no pending choice
  });
});

describe("activated abilities", () => {
  it("pays the tap cost, goes on the stack, and resolves like a spell", () => {
    let s = passUntilPhase(newGame(), "main1");
    const healer = give(s, "p1", "healer", "battlefield");
    s = healer.state;

    const activate: Action = { type: "ACTIVATE", player: "p1", cardId: healer.id, abilityIndex: 0 };
    expect(getLegalActions(rules, s)).toContainEqual(activate);

    s = ok(s, activate);
    expect(s.cards[healer.id]?.tapped).toBe(true); // cost paid immediately
    expect(s.stack).toHaveLength(1);
    expect(s.priority).toBe("p1"); // activator keeps priority, same as casting

    s = ok(s, { type: "PASS", player: "p1" });
    s = ok(s, { type: "PASS", player: "p2" }); // both pass: the ability resolves
    expect(s.players.p1?.life).toBe(21);
    expect(s.stack).toHaveLength(0);
  });

  it("rejects activating an already-tapped source", () => {
    let s = passUntilPhase(newGame(), "main1");
    const healer = give(s, "p1", "healer", "battlefield");
    s = clone(healer.state);
    (s.cards[healer.id] as { tapped: boolean }).tapped = true;

    expect(applyAction(rules, s, { type: "ACTIVATE", player: "p1", cardId: healer.id, abilityIndex: 0 })).toEqual({
      ok: false,
      error: "Cannot pay the cost",
    });
  });

  it("rejects activating a permanent you don't control", () => {
    let s = passUntilPhase(newGame(), "main1");
    const healer = give(s, "p1", "healer", "battlefield");
    s = ok(healer.state, { type: "PASS", player: "p1" }); // priority passes to p2, phase doesn't advance

    expect(applyAction(rules, s, { type: "ACTIVATE", player: "p2", cardId: healer.id, abilityIndex: 0 })).toEqual({
      ok: false,
      error: "You don't control that permanent",
    });
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
