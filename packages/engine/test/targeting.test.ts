import { describe, expect, it } from "vitest";
import { applyAction, getLegalActions, type Action, type CardId, type GameState } from "../src";
import { give, newGame, passUntilPhase, rules } from "./fixtures";

function ok(state: GameState, action: Action): GameState {
  const r = applyAction(rules, state, action);
  if (!r.ok) throw new Error(`Expected ok, got: ${r.error}`);
  return r.state;
}

/** Main phase, p1 holds a Test Shock and a Mountain; p2 has a bear. */
function setup() {
  let s = passUntilPhase(newGame(), "main1");
  const m = give(s, "p1", "mountain", "battlefield");
  const shock = give(m.state, "p1", "shock", "hand");
  const bear = give(shock.state, "p2", "bear", "battlefield");
  s = bear.state;
  return { s, shock: shock.id, bear: bear.id, mountain: m.id };
}

const resolveTop = (s: GameState) => {
  let g = ok(s, { type: "PASS", player: s.priority });
  g = ok(g, { type: "PASS", player: g.priority });
  return g;
};

describe("targeting", () => {
  it("damage can kill a creature", () => {
    const { s, shock, bear } = setup();
    let g = ok(s, { type: "CAST", player: "p1", cardId: shock, targets: [{ kind: "card", id: bear }] });
    expect(g.stack[0]?.targets).toEqual([{ kind: "card", id: bear }]);
    g = resolveTop(g);
    expect(g.players.p2?.battlefield).not.toContain(bear);
    expect(g.players.p2?.graveyard).toContain(bear);
    expect(g.players.p2?.life).toBe(20);
  });

  it("damage can hit a player instead", () => {
    const { s, shock } = setup();
    let g = ok(s, { type: "CAST", player: "p1", cardId: shock, targets: [{ kind: "player", id: "p2" }] });
    g = resolveTop(g);
    expect(g.players.p2?.life).toBe(18);
  });

  it("requires a legal target", () => {
    const { s, shock, bear } = setup();
    expect(applyAction(rules, s, { type: "CAST", player: "p1", cardId: shock })).toEqual({
      ok: false,
      error: "Choose a target",
    });
    expect(
      applyAction(rules, s, { type: "CAST", player: "p1", cardId: shock, targets: [{ kind: "card", id: "nope" }] }),
    ).toEqual({ ok: false, error: "Invalid target" });

    // A creature-only spell can't target a player.
    const f = give(s, "p1", "forest", "battlefield");
    const smite = give(f.state, "p1", "smite", "hand");
    expect(
      applyAction(rules, smite.state, {
        type: "CAST",
        player: "p1",
        cardId: smite.id,
        targets: [{ kind: "player", id: "p2" }],
      }),
    ).toEqual({ ok: false, error: "Invalid target" });
    expect(
      applyAction(rules, smite.state, {
        type: "CAST",
        player: "p1",
        cardId: smite.id,
        targets: [{ kind: "card", id: bear }],
      }).ok,
    ).toBe(true);
  });

  it("rejects targets for an untargeted spell", () => {
    const { s } = setup();
    const f = give(s, "p1", "forest", "battlefield");
    const tonic = give(f.state, "p1", "tonic", "hand");
    expect(
      applyAction(rules, tonic.state, {
        type: "CAST",
        player: "p1",
        cardId: tonic.id,
        targets: [{ kind: "player", id: "p2" }],
      }),
    ).toEqual({ ok: false, error: "This spell has no targets" });
  });

  it("destroy moves the creature to its owner's graveyard", () => {
    const { s, bear } = setup();
    const f = give(s, "p1", "forest", "battlefield");
    const smite = give(f.state, "p1", "smite", "hand");
    let g = ok(smite.state, {
      type: "CAST",
      player: "p1",
      cardId: smite.id,
      targets: [{ kind: "card", id: bear }],
    });
    g = resolveTop(g);
    expect(g.players.p2?.graveyard).toContain(bear);
    expect(g.players.p1?.graveyard).toContain(smite.id);
  });

  it("fizzles if the target is gone by the time it resolves", () => {
    const { s, shock, bear } = setup();
    // p2 can respond by destroying its own bear.
    const f = give(s, "p2", "forest", "battlefield");
    const smite = give(f.state, "p2", "smite", "hand");
    let g = ok(smite.state, { type: "CAST", player: "p1", cardId: shock, targets: [{ kind: "card", id: bear }] });
    g = ok(g, { type: "PASS", player: "p1" });
    g = ok(g, { type: "CAST", player: "p2", cardId: smite.id, targets: [{ kind: "card", id: bear }] });
    g = ok(g, { type: "PASS", player: "p2" });
    g = ok(g, { type: "PASS", player: "p1" }); // smite resolves
    expect(g.players.p2?.graveyard).toContain(bear);
    g = ok(g, { type: "PASS", player: "p1" });
    g = ok(g, { type: "PASS", player: "p2" }); // shock resolves -> fizzles
    expect(g.log.some((l) => l.includes("fizzles"))).toBe(true);
    expect(g.players.p1?.graveyard).toContain(shock);
    expect(g.players.p2?.life).toBe(20);
  });

  it("lists one CAST per legal target, and every legal action applies", () => {
    const { s, shock, bear } = setup();
    const casts = getLegalActions(rules, s).filter((a) => a.type === "CAST" && a.cardId === shock);
    const targets = casts.map((a) => (a.type === "CAST" ? a.targets?.[0] : undefined));
    expect(targets).toEqual(
      expect.arrayContaining([
        { kind: "player", id: "p1" },
        { kind: "player", id: "p2" },
        { kind: "card", id: bear as CardId },
      ]),
    );
    expect(casts).toHaveLength(3);
    for (const a of getLegalActions(rules, s)) expect(applyAction(rules, s, a).ok).toBe(true);
  });
});
