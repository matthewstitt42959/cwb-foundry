import { opponentOf } from "./effects";
import type {
  BlockAssignment,
  CardId,
  GameState,
  Keyword,
  PlayerId,
  Ruleset,
} from "./types";

function defOf(rules: Ruleset, state: GameState, id: CardId) {
  const inst = state.cards[id];
  return inst ? rules.defs[inst.defId] : undefined;
}

function isCreature(rules: Ruleset, state: GameState, id: CardId): boolean {
  return !!defOf(rules, state, id)?.types.includes("creature");
}

function hasKeyword(rules: Ruleset, state: GameState, id: CardId, kw: Keyword): boolean {
  return !!defOf(rules, state, id)?.keywords?.includes(kw);
}

/** Power/toughness including temporary deltas from effects like "pump". */
export function effectivePower(rules: Ruleset, state: GameState, id: CardId): number {
  return (defOf(rules, state, id)?.power ?? 0) + (state.cards[id]?.tempPower ?? 0);
}
export function effectiveToughness(rules: Ruleset, state: GameState, id: CardId): number {
  return (defOf(rules, state, id)?.toughness ?? 0) + (state.cards[id]?.tempToughness ?? 0);
}

export function defendingPlayer(state: GameState): PlayerId {
  return opponentOf(state, state.activePlayer);
}

/** Who must act while a declaration is pending. */
export function declarer(state: GameState): PlayerId | null {
  if (state.pending === "attackers") return state.activePlayer;
  if (state.pending === "blockers") return defendingPlayer(state);
  return null;
}

/** Untapped creatures the active player controls that aren't summoning sick. */
export function attackCandidates(rules: Ruleset, state: GameState): CardId[] {
  const me = state.players[state.activePlayer];
  if (!me) return [];
  return me.battlefield.filter((id) => {
    const inst = state.cards[id];
    if (!inst || inst.tapped || !isCreature(rules, state, id)) return false;
    return inst.enteredTurn < state.turn || hasKeyword(rules, state, id, "haste");
  });
}

/** Untapped creatures the defending player could block with. */
export function blockCandidates(rules: Ruleset, state: GameState): CardId[] {
  const them = state.players[defendingPlayer(state)];
  if (!them) return [];
  return them.battlefield.filter((id) => {
    const inst = state.cards[id];
    return !!inst && !inst.tapped && isCreature(rules, state, id);
  });
}

export function validateAttackers(rules: Ruleset, state: GameState, attackers: CardId[]): string | null {
  const allowed = new Set(attackCandidates(rules, state));
  const seen = new Set<CardId>();
  for (const id of attackers) {
    if (seen.has(id)) return "A creature can't attack twice";
    seen.add(id);
    if (!allowed.has(id)) return "That creature can't attack";
  }
  return null;
}

export function validateBlocks(rules: Ruleset, state: GameState, blocks: BlockAssignment[]): string | null {
  const allowed = new Set(blockCandidates(rules, state));
  const attacking = new Set(state.combat?.attackers ?? []);
  const used = new Set<CardId>();
  for (const { blocker, attacker } of blocks) {
    if (used.has(blocker)) return "A creature can block only one attacker";
    used.add(blocker);
    if (!allowed.has(blocker)) return "That creature can't block";
    if (!attacking.has(attacker)) return "That creature isn't attacking";
    if (hasKeyword(rules, state, attacker, "flying") && !hasKeyword(rules, state, blocker, "flying")) {
      return "Only flying creatures can block a flyer";
    }
  }
  return null;
}

/** Tap attackers (unless vigilant) and record them. */
export function declareAttackers(rules: Ruleset, state: GameState, attackers: CardId[]): void {
  for (const id of attackers) {
    const inst = state.cards[id];
    if (inst && !hasKeyword(rules, state, id, "vigilance")) inst.tapped = true;
    state.log.push(`${defOf(rules, state, id)?.name ?? id} attacks`);
  }
  state.combat = { attackers: [...attackers], blocks: [] };
}

/**
 * Deal combat damage simultaneously. An attacker with several blockers assigns lethal
 * damage to each in declaration order, with any excess going to the last blocker.
 * (First strike, trample and manual damage assignment are not modelled yet.)
 */
export function resolveCombatDamage(rules: Ruleset, state: GameState): void {
  const combat = state.combat;
  if (!combat) return;
  const power = (id: CardId) => effectivePower(rules, state, id);
  const toughness = (id: CardId) => effectiveToughness(rules, state, id);

  const dealt: Record<CardId, number> = {};
  const deathtouched = new Set<CardId>();
  const add = (id: CardId, n: number, source: CardId) => {
    if (n <= 0) return;
    dealt[id] = (dealt[id] ?? 0) + n;
    if (hasKeyword(rules, state, source, "deathtouch")) deathtouched.add(id);
  };
  let toPlayer = 0;

  for (const attacker of combat.attackers) {
    const blockers = combat.blocks.filter((b) => b.attacker === attacker).map((b) => b.blocker);
    if (blockers.length === 0) {
      toPlayer += power(attacker);
      continue;
    }
    let remaining = power(attacker);
    const attackerDeathtouch = hasKeyword(rules, state, attacker, "deathtouch");
    blockers.forEach((blocker, i) => {
      const isLast = i === blockers.length - 1;
      const remainingToughness = Math.max(0, toughness(blocker) - (state.cards[blocker]?.damage ?? 0));
      const lethal = attackerDeathtouch ? Math.min(1, remainingToughness) : remainingToughness;
      const assigned = isLast ? remaining : Math.min(remaining, lethal);
      add(blocker, assigned, attacker);
      remaining -= assigned;
      add(attacker, power(blocker), blocker);
    });
  }

  const defender = state.players[defendingPlayer(state)];
  if (defender && toPlayer > 0) {
    defender.life -= toPlayer;
    state.log.push(`${defendingPlayer(state)} takes ${toPlayer} combat damage`);
  }
  for (const [id, n] of Object.entries(dealt)) {
    const inst = state.cards[id];
    if (inst) {
      inst.damage += n;
      if (deathtouched.has(id)) inst.deathtouch = true;
    }
  }
}

/**
 * State-based action: creatures die to lethal damage, any deathtouch damage, or
 * having zero or less effective toughness (e.g. from a large enough "pump" debuff,
 * with no damage marked at all).
 */
export function destroyDeadCreatures(rules: Ruleset, state: GameState): void {
  for (const pid of state.order) {
    const p = state.players[pid];
    if (!p) continue;
    const survivors: CardId[] = [];
    for (const id of p.battlefield) {
      const inst = state.cards[id];
      const def = defOf(rules, state, id);
      const toughness = effectiveToughness(rules, state, id);
      const dead =
        inst && def?.types.includes("creature") && (inst.damage >= toughness || inst.deathtouch || toughness <= 0);
      if (dead && inst) {
        state.players[inst.owner]?.graveyard.push(id);
        state.log.push(`${def?.name ?? id} dies`);
      } else {
        survivors.push(id);
      }
    }
    p.battlefield = survivors;
  }
}

export function clearDamage(state: GameState): void {
  for (const inst of Object.values(state.cards)) {
    inst.damage = 0;
    inst.deathtouch = false;
    inst.tempPower = 0;
    inst.tempToughness = 0;
  }
}
