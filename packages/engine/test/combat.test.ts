import { describe, expect, it } from "vitest";
import {
  applyAction,
  attackCandidates,
  blockCandidates,
  clone,
  effectivePower,
  getLegalActions,
  type Action,
  type CardId,
  type GameState,
} from "../src";
import { give, newGame, passUntilPhase, rules } from "./fixtures";

function ok(state: GameState, action: Action): GameState {
  const r = applyAction(rules, state, action);
  if (!r.ok) throw new Error(`Expected ok, got: ${r.error}`);
  return r.state;
}

/** Both players pass priority once, advancing the step (or resolving the top of the stack). */
function passRound(state: GameState): GameState {
  let s = ok(state, { type: "PASS", player: state.priority });
  if (!s.over) s = ok(s, { type: "PASS", player: s.priority });
  return s;
}

const phaseId = (s: GameState) => rules.pack.phases[s.phaseIndex]?.id;

/** p1 gets the listed creatures on the battlefield (able to attack) and play reaches the attack declaration. */
function atAttackers(p1: string[], p2: string[] = []): { s: GameState; p1Ids: CardId[]; p2Ids: CardId[] } {
  let s = passUntilPhase(newGame(), "main1");
  const p1Ids: CardId[] = [];
  const p2Ids: CardId[] = [];
  for (const d of p1) {
    const g = give(s, "p1", d, "battlefield");
    s = g.state;
    p1Ids.push(g.id);
  }
  for (const d of p2) {
    const g = give(s, "p2", d, "battlefield");
    s = g.state;
    p2Ids.push(g.id);
  }
  s = passUntilPhase(s, "attackers");
  return { s, p1Ids, p2Ids };
}

describe("declaring attackers", () => {
  it("requires a declaration before anyone can pass", () => {
    const { s } = atAttackers(["bear"]);
    expect(s.pending).toBe("attackers");
    expect(applyAction(rules, s, { type: "PASS", player: "p1" })).toEqual({
      ok: false,
      error: "Declare attackers first",
    });
    expect(applyAction(rules, s, { type: "DECLARE_ATTACKERS", player: "p2", attackers: [] })).toEqual({
      ok: false,
      error: "Waiting for the other player to declare",
    });
  });

  it("skips combat when nobody can attack", () => {
    let s = passUntilPhase(newGame(), "main1");
    s = passUntilPhase(s, "main2");
    expect(phaseId(s)).toBe("main2");
    expect(s.pending).toBeNull();
  });

  it("declaring no attackers skips straight to the second main phase", () => {
    const { s } = atAttackers(["bear"]);
    const after = ok(s, { type: "DECLARE_ATTACKERS", player: "p1", attackers: [] });
    expect(phaseId(after)).toBe("main2");
    expect(after.combat).toBeNull();
  });

  it("summoning sickness: a creature that just entered can't attack, but a hasty one can", () => {
    let s = passUntilPhase(newGame(), "main1");
    const f1 = give(s, "p1", "forest", "battlefield");
    const f2 = give(f1.state, "p1", "forest", "battlefield");
    const bear = give(f2.state, "p1", "bear", "hand");
    s = ok(bear.state, { type: "CAST", player: "p1", cardId: bear.id });
    s = passRound(s); // resolves the bear
    expect(s.cards[bear.id]?.enteredTurn).toBe(s.turn);
    expect(attackCandidates(rules, { ...s, phaseIndex: s.phaseIndex })).not.toContain(bear.id);
    s = passUntilPhase(s, "main2");
    expect(phaseId(s)).toBe("main2"); // combat skipped: the only creature is summoning sick

    // Hasty creature on a fresh game
    let h = passUntilPhase(newGame(), "main1");
    const m = give(h, "p1", "mountain", "battlefield");
    const sprinter = give(m.state, "p1", "sprinter", "hand");
    h = ok(sprinter.state, { type: "CAST", player: "p1", cardId: sprinter.id });
    h = passRound(h);
    h = passUntilPhase(h, "attackers");
    expect(h.pending).toBe("attackers");
    expect(attackCandidates(rules, h)).toContain(sprinter.id);
  });

  it("rejects tapped, non-creature, unknown and duplicate attackers", () => {
    const { s, p1Ids } = atAttackers(["bear"]);
    const id = p1Ids[0] as CardId;
    expect(applyAction(rules, s, { type: "DECLARE_ATTACKERS", player: "p1", attackers: [id, id] }).ok).toBe(false);
    expect(applyAction(rules, s, { type: "DECLARE_ATTACKERS", player: "p1", attackers: ["p1:nope"] }).ok).toBe(false);
    const tapped = clone(s);
    (tapped.cards[id] as { tapped: boolean }).tapped = true;
    // With the only creature tapped there are no candidates: validation rejects it.
    expect(applyAction(rules, tapped, { type: "DECLARE_ATTACKERS", player: "p1", attackers: [id] }).ok).toBe(false);
  });

  it("attackers tap, except vigilant ones", () => {
    const { s, p1Ids } = atAttackers(["bear", "guard"]);
    const [bear, guard] = p1Ids as [CardId, CardId];
    const after = ok(s, { type: "DECLARE_ATTACKERS", player: "p1", attackers: [bear, guard] });
    expect(after.cards[bear]?.tapped).toBe(true);
    expect(after.cards[guard]?.tapped).toBe(false);
  });
});

describe("blocking and damage", () => {
  it("unblocked attackers damage the player", () => {
    const { s, p1Ids } = atAttackers(["giant"]);
    let g = ok(s, { type: "DECLARE_ATTACKERS", player: "p1", attackers: p1Ids });
    g = passRound(g); // -> blockers (p2 has no creatures: no declaration needed)
    expect(g.pending).toBeNull();
    g = passRound(g); // -> combat damage
    expect(g.players.p2?.life).toBe(16);
  });

  it("a bigger blocker kills the attacker and survives; damage wears off at cleanup", () => {
    const { s, p1Ids, p2Ids } = atAttackers(["bear"], ["giant"]);
    const [bear] = p1Ids as [CardId];
    const [giant] = p2Ids as [CardId];
    let g = ok(s, { type: "DECLARE_ATTACKERS", player: "p1", attackers: [bear] });
    g = passRound(g);
    expect(g.pending).toBe("blockers");
    expect(g.priority).toBe("p2");
    g = ok(g, { type: "DECLARE_BLOCKERS", player: "p2", blocks: [{ blocker: giant, attacker: bear }] });
    expect(g.priority).toBe("p1");
    g = passRound(g);
    expect(g.players.p1?.graveyard).toContain(bear);
    expect(g.players.p1?.battlefield).not.toContain(bear);
    expect(g.players.p2?.battlefield).toContain(giant);
    expect(g.cards[giant]?.damage).toBe(2);
    expect(g.players.p2?.life).toBe(20);

    g = passUntilPhase(g, "upkeep"); // next turn: cleanup has run
    expect(g.cards[giant]?.damage).toBe(0);
  });

  it("equal creatures trade", () => {
    const { s, p1Ids, p2Ids } = atAttackers(["bear"], ["bear"]);
    const [a] = p1Ids as [CardId];
    const [b] = p2Ids as [CardId];
    let g = ok(s, { type: "DECLARE_ATTACKERS", player: "p1", attackers: [a] });
    g = passRound(g);
    g = ok(g, { type: "DECLARE_BLOCKERS", player: "p2", blocks: [{ blocker: b, attacker: a }] });
    g = passRound(g);
    expect(g.players.p1?.graveyard).toContain(a);
    expect(g.players.p2?.graveyard).toContain(b);
  });

  it("assigns lethal damage to blockers in order, excess to the last", () => {
    const { s, p1Ids, p2Ids } = atAttackers(["giant"], ["bear", "bear"]);
    const [giant] = p1Ids as [CardId];
    const [b1, b2] = p2Ids as [CardId, CardId];
    let g = ok(s, { type: "DECLARE_ATTACKERS", player: "p1", attackers: [giant] });
    g = passRound(g);
    g = ok(g, {
      type: "DECLARE_BLOCKERS",
      player: "p2",
      blocks: [
        { blocker: b1, attacker: giant },
        { blocker: b2, attacker: giant },
      ],
    });
    g = passRound(g);
    expect(g.players.p2?.graveyard).toEqual(expect.arrayContaining([b1, b2]));
    expect(g.players.p1?.graveyard).toContain(giant); // took 2 + 2
  });

  it("only flyers can block a flyer", () => {
    const { s, p1Ids, p2Ids } = atAttackers(["hawk"], ["giant", "hawk"]);
    const [hawk] = p1Ids as [CardId];
    const [giant, blockerHawk] = p2Ids as [CardId, CardId];
    let g = ok(s, { type: "DECLARE_ATTACKERS", player: "p1", attackers: [hawk] });
    g = passRound(g);
    expect(
      applyAction(rules, g, { type: "DECLARE_BLOCKERS", player: "p2", blocks: [{ blocker: giant, attacker: hawk }] }),
    ).toEqual({ ok: false, error: "Only flying creatures can block a flyer" });
    expect(
      applyAction(rules, g, {
        type: "DECLARE_BLOCKERS",
        player: "p2",
        blocks: [{ blocker: blockerHawk, attacker: hawk }],
      }).ok,
    ).toBe(true);
  });

  it("deathtouch makes any damage lethal, even from a 1-power attacker", () => {
    const { s, p1Ids, p2Ids } = atAttackers(["viper"], ["giant"]);
    const [viper] = p1Ids as [CardId];
    const [giant] = p2Ids as [CardId];
    let g = ok(s, { type: "DECLARE_ATTACKERS", player: "p1", attackers: [viper] });
    g = passRound(g);
    g = ok(g, { type: "DECLARE_BLOCKERS", player: "p2", blocks: [{ blocker: giant, attacker: viper }] });
    g = passRound(g);
    expect(g.players.p1?.graveyard).toContain(viper); // giant's 4 power kills the 1-toughness viper
    expect(g.players.p2?.graveyard).toContain(giant); // 1 damage from a deathtouch source is lethal
  });

  it("a creature pumped to 0 toughness dies with no damage marked at all", () => {
    const { s, p1Ids, p2Ids } = atAttackers(["giant", "weakener"], ["hawk"]);
    const [giant, weakener] = p1Ids as [CardId, CardId];
    const [hawk] = p2Ids as [CardId];
    let g = ok(s, { type: "DECLARE_ATTACKERS", player: "p1", attackers: [giant] });
    g = passRound(g);
    expect(g.pending).toBe("blockers");
    g = ok(g, { type: "DECLARE_BLOCKERS", player: "p2", blocks: [{ blocker: hawk, attacker: giant }] });
    expect(g.priority).toBe("p1"); // before combat damage: still time to respond

    g = ok(g, {
      type: "ACTIVATE",
      player: "p1",
      cardId: weakener,
      abilityIndex: 0,
      targets: [{ kind: "card", id: hawk }],
    });
    g = passRound(g); // resolves the -1/-1

    expect(g.cards[hawk]?.damage).toBe(0); // died before combat damage ever happened, none marked
    expect(g.players.p2?.graveyard).toContain(hawk);
    expect(g.players.p2?.battlefield).not.toContain(hawk);
  });

  it("a creature can't block twice, and tapped creatures can't block", () => {
    const { s, p1Ids, p2Ids } = atAttackers(["bear", "bear"], ["giant"]);
    const [a1, a2] = p1Ids as [CardId, CardId];
    const [giant] = p2Ids as [CardId];
    const g = passRound(ok(s, { type: "DECLARE_ATTACKERS", player: "p1", attackers: [a1, a2] }));
    expect(
      applyAction(rules, g, {
        type: "DECLARE_BLOCKERS",
        player: "p2",
        blocks: [
          { blocker: giant, attacker: a1 },
          { blocker: giant, attacker: a2 },
        ],
      }),
    ).toEqual({ ok: false, error: "A creature can block only one attacker" });

    // If the only potential blocker is tapped, no blocker declaration is requested.
    const tapped = atAttackers(["bear"], ["giant"]);
    const t = clone(tapped.s);
    (t.cards[tapped.p2Ids[0] as CardId] as { tapped: boolean }).tapped = true;
    const afterDeclare = passRound(ok(t, { type: "DECLARE_ATTACKERS", player: "p1", attackers: tapped.p1Ids }));
    expect(afterDeclare.pending).toBeNull();
  });

  it("combat damage can win the game", () => {
    const { s, p1Ids } = atAttackers(["bear"]);
    let g = clone(s);
    (g.players.p2 as { life: number }).life = 2;
    g = ok(g, { type: "DECLARE_ATTACKERS", player: "p1", attackers: p1Ids });
    g = passRound(g);
    g = passRound(g);
    expect(g.over).toBe(true);
    expect(g.winner).toBe("p1");
  });
});

describe("declaration legal actions", () => {
  it("offers only declarations, and every one applies", () => {
    const { s } = atAttackers(["bear", "guard"]);
    const legal = getLegalActions(rules, s);
    expect(legal.every((a) => a.type === "DECLARE_ATTACKERS")).toBe(true);
    expect(legal.length).toBeGreaterThan(2);
    for (const a of legal) expect(applyAction(rules, s, a).ok).toBe(true);
  });

  it("offers legal single blocks to the defender", () => {
    const { s, p1Ids } = atAttackers(["bear"], ["giant"]);
    const g = passRound(ok(s, { type: "DECLARE_ATTACKERS", player: "p1", attackers: p1Ids }));
    const legal = getLegalActions(rules, g);
    expect(legal.every((a) => a.type === "DECLARE_BLOCKERS" && a.player === "p2")).toBe(true);
    expect(legal).toHaveLength(2); // no block, or giant blocks bear
    for (const a of legal) expect(applyAction(rules, g, a).ok).toBe(true);
  });
});

describe("evasion keywords", () => {
  const block = (blocker: CardId, attacker: CardId) => ({ blocker, attacker });

  function blocking(attacker: string, defenders: string[]) {
    const { s, p1Ids, p2Ids } = atAttackers([attacker], defenders);
    const [a] = p1Ids as [CardId];
    const g = passRound(ok(s, { type: "DECLARE_ATTACKERS", player: "p1", attackers: [a] }));
    expect(g.pending).toBe("blockers");
    return { g, a, d: p2Ids };
  }

  const tryBlocks = (g: GameState, blocks: ReturnType<typeof block>[]) =>
    applyAction(rules, g, { type: "DECLARE_BLOCKERS", player: "p2", blocks });

  it("fear: only a black creature can block it", () => {
    const { g, a, d } = blocking("shade", ["bear", "ghoul"]);
    const [bear, ghoul] = d as [CardId, CardId];
    expect(tryBlocks(g, [block(bear, a)])).toEqual({
      ok: false,
      error: "Only black creatures can block a creature with fear",
    });
    expect(tryBlocks(g, [block(ghoul, a)]).ok).toBe(true);
  });

  it("menace: a single blocker is rejected, two are fine", () => {
    const { g, a, d } = blocking("ogre", ["bear", "giant"]);
    const [bear, giant] = d as [CardId, CardId];
    expect(tryBlocks(g, [block(bear, a)])).toEqual({
      ok: false,
      error: "A creature with menace must be blocked by two or more creatures",
    });
    expect(tryBlocks(g, [block(bear, a), block(giant, a)]).ok).toBe(true);
    expect(tryBlocks(g, []).ok).toBe(true);
  });

  it("skulk: can't be blocked by a creature with greater power", () => {
    const { g, a, d } = blocking("skulker", ["bear", "ghoul"]);
    const [bear, ghoul] = d as [CardId, CardId];
    expect(tryBlocks(g, [block(bear, a)])).toEqual({
      ok: false,
      error: "A creature with skulk can't be blocked by a creature with greater power",
    });
    expect(tryBlocks(g, [block(ghoul, a)]).ok).toBe(true); // equal power is fine
  });

  it("cant_block: is never a block candidate", () => {
    const { s } = atAttackers(["bear"], ["coward", "ghoul"]);
    const g = passRound(
      ok(s, { type: "DECLARE_ATTACKERS", player: "p1", attackers: [s.players.p1?.battlefield[0] as CardId] }),
    );
    expect(g.pending).toBe("blockers");
    const [coward, ghoul] = s.players.p2?.battlefield.slice(-2) as [CardId, CardId];
    expect(blockCandidates(rules, g)).toEqual([ghoul]);
    expect(tryBlocks(g, [block(coward, g.combat?.attackers[0] as CardId)])).toEqual({
      ok: false,
      error: "That creature can't block",
    });
  });
});

describe("tokens and computed power", () => {
  it("a creature's enter effect creates tokens that are summoning sick", () => {
    let s = passUntilPhase(newGame(), "main1");
    const brood = give(s, "p1", "brood", "hand");
    s = ok(brood.state, { type: "CAST", player: "p1", cardId: brood.id });
    s = passRound(s);
    const tokens = (s.players.p1?.battlefield ?? []).filter((id) => s.cards[id]?.defId === "ratToken");
    expect(tokens).toHaveLength(2);
    expect(new Set(tokens).size).toBe(2); // unique ids
    expect(s.cards[tokens[0] as CardId]?.owner).toBe("p1");
    expect(attackCandidates(rules, s)).not.toContain(tokens[0]);
    expect(s.log).toContain("p1 creates 2 1/1 black Rat creature tokens");
  });

  it("a token that dies ceases to exist instead of going to the graveyard", () => {
    const { s, p1Ids, p2Ids } = atAttackers(["giant"], ["ratToken"]);
    const [giant] = p1Ids as [CardId];
    const [token] = p2Ids as [CardId];
    let g = passRound(ok(s, { type: "DECLARE_ATTACKERS", player: "p1", attackers: [giant] }));
    g = ok(g, { type: "DECLARE_BLOCKERS", player: "p2", blocks: [{ blocker: token, attacker: giant }] });
    g = passRound(g);
    expect(g.players.p2?.battlefield).not.toContain(token);
    expect(g.players.p2?.graveyard).not.toContain(token);
  });

  it("a token's explicit colour decides who it can block under fear", () => {
    const { s, p1Ids, p2Ids } = atAttackers(["shade"], ["ratToken", "ratling"]);
    const [shade] = p1Ids as [CardId];
    const [token, ratling] = p2Ids as [CardId, CardId];
    const g = passRound(ok(s, { type: "DECLARE_ATTACKERS", player: "p1", attackers: [shade] }));
    const block = (b: CardId) =>
      applyAction(rules, g, { type: "DECLARE_BLOCKERS", player: "p2", blocks: [{ blocker: b, attacker: shade }] });
    expect(block(token).ok).toBe(true); // black token
    expect(block(ratling).ok).toBe(false); // colourless
  });

  it("power can be the number of Rats you control (itself included)", () => {
    let s = passUntilPhase(newGame(), "main1");
    const sw = give(s, "p1", "swarm", "battlefield");
    s = give(sw.state, "p1", "ratling", "battlefield").state;
    s = give(s, "p1", "ratToken", "battlefield").state;
    s = give(s, "p2", "ratling", "battlefield").state; // the opponent's Rat doesn't count
    expect(effectivePower(rules, s, sw.id)).toBe(3);
  });

  it("power can be the number of other Rats on the battlefield, either side", () => {
    let s = passUntilPhase(newGame(), "main1");
    const pest = give(s, "p1", "pest", "battlefield");
    s = give(pest.state, "p1", "ratling", "battlefield").state;
    s = give(s, "p2", "ratling", "battlefield").state;
    s = give(s, "p2", "bear", "battlefield").state; // not a Rat
    expect(effectivePower(rules, s, pest.id)).toBe(2);
  });

  it("combat uses the computed power", () => {
    const { s, p1Ids } = atAttackers(["swarm", "ratling", "ratToken"]);
    const [swarm] = p1Ids as [CardId];
    let g = passRound(ok(s, { type: "DECLARE_ATTACKERS", player: "p1", attackers: [swarm] }));
    g = passRound(g);
    expect(g.players.p2?.life).toBe(17);
  });
});

describe("first strike, trample and lifelink", () => {
  const fight = (attacker: string, blocker: string | null) => {
    const { s, p1Ids, p2Ids } = atAttackers([attacker], blocker ? [blocker] : []);
    const [a] = p1Ids as [CardId];
    const [b] = p2Ids;
    let g = passRound(ok(s, { type: "DECLARE_ATTACKERS", player: "p1", attackers: [a] }));
    if (b) g = ok(g, { type: "DECLARE_BLOCKERS", player: "p2", blocks: [{ blocker: b, attacker: a }] });
    g = passRound(g);
    return { g, a, b };
  };

  it("first strike kills a blocker before it can deal damage back", () => {
    const { g, a, b } = fight("fencer", "bear");
    expect(g.players.p2?.graveyard).toContain(b);
    expect(g.players.p1?.battlefield).toContain(a);
    expect(g.cards[a]?.damage).toBe(0);
  });

  it("a first-strike blocker kills the attacker first too", () => {
    const { g, a, b } = fight("bear", "fencer");
    expect(g.players.p1?.graveyard).toContain(a);
    expect(g.players.p2?.battlefield).toContain(b as CardId);
    expect(g.cards[b as CardId]?.damage).toBe(0);
  });

  it("first strikers still trade with creatures that survive the first step", () => {
    const { g, a, b } = fight("fencer", "giant");
    expect(g.players.p1?.graveyard).toContain(a);
    expect(g.cards[b as CardId]?.damage).toBe(2);
  });

  it("trample sends the excess damage to the defending player", () => {
    const { g, a, b } = fight("rhino", "bear");
    expect(g.players.p2?.graveyard).toContain(b);
    expect(g.players.p2?.life).toBe(19);
    expect(g.players.p1?.battlefield).toContain(a);
  });

  it("without trample a blocked attacker deals nothing to the player", () => {
    const { g } = fight("giant", "bear");
    expect(g.players.p2?.life).toBe(20);
  });

  it("lifelink gains life for combat damage to a player and to a creature", () => {
    const unblocked = fight("leech", null).g;
    expect(unblocked.players.p1?.life).toBe(22);
    expect(unblocked.players.p2?.life).toBe(18);
    const blocked = fight("leech", "bear").g;
    expect(blocked.players.p1?.life).toBe(22);
  });
});
