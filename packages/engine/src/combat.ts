import { opponentOf } from "./effects";
import { queueTriggers } from "./triggers";
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

function countSubtype(rules: Ruleset, state: GameState, id: CardId, subtype: string, scope: "yours" | "others"): number {
  const owner = state.cards[id]?.owner;
  let n = 0;
  for (const pid of state.order) {
    if (scope === "yours" && pid !== owner) continue;
    for (const other of state.players[pid]?.battlefield ?? []) {
      if (scope === "others" && other === id) continue;
      if (defOf(rules, state, other)?.subtypes?.includes(subtype)) n++;
    }
  }
  return n;
}

/** Power/toughness including computed power and temporary deltas from effects like "pump". */
export function effectivePower(rules: Ruleset, state: GameState, id: CardId): number {
  const def = defOf(rules, state, id);
  const base = def?.powerFrom
    ? countSubtype(rules, state, id, def.powerFrom.subtype, def.powerFrom.scope)
    : (def?.power ?? 0);
  return base + (state.cards[id]?.tempPower ?? 0);
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
    return !!inst && !inst.tapped && isCreature(rules, state, id) && !hasKeyword(rules, state, id, "cant_block");
  });
}

const isBlack = (rules: Ruleset, state: GameState, id: CardId) => {
  const def = defOf(rules, state, id);
  return def?.colors ? def.colors.includes("B") : (def?.cost?.B ?? 0) > 0;
};

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

/**
 * `partial` is for UIs building a declaration one block at a time: it skips the check
 * that a menace attacker has its second blocker, which can only hold once the set is final.
 */
export function validateBlocks(
  rules: Ruleset,
  state: GameState,
  blocks: BlockAssignment[],
  partial = false,
): string | null {
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
    if (hasKeyword(rules, state, attacker, "fear") && !isBlack(rules, state, blocker)) {
      return "Only black creatures can block a creature with fear";
    }
    if (
      hasKeyword(rules, state, attacker, "skulk") &&
      effectivePower(rules, state, blocker) > effectivePower(rules, state, attacker)
    ) {
      return "A creature with skulk can't be blocked by a creature with greater power";
    }
  }
  for (const attacker of partial ? [] : attacking) {
    const count = blocks.filter((b) => b.attacker === attacker).length;
    if (count === 1 && hasKeyword(rules, state, attacker, "menace")) {
      return "A creature with menace must be blocked by two or more creatures";
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
    queueTriggers(rules, state, id, "attacks");
  }
  state.combat = { attackers: [...attackers], blocks: [] };
}

const onBattlefield = (state: GameState, id: CardId) =>
  state.order.some((pid) => state.players[pid]?.battlefield.includes(id));

/**
 * Deal combat damage. First-strike creatures deal theirs in a first step; anything they
 * kill is removed before the regular step, where everything else deals damage. An attacker
 * with several blockers assigns lethal damage to each in declaration order, with any excess
 * going to the last blocker, or to the defending player if the attacker has trample. A
 * blocked attacker whose blockers are all gone deals no damage unless it has trample.
 * (Double strike and manual damage assignment are not modelled yet.)
 */
export function resolveCombatDamage(rules: Ruleset, state: GameState): void {
  const combat = state.combat;
  if (!combat) return;
  const power = (id: CardId) => effectivePower(rules, state, id);
  const toughness = (id: CardId) => effectiveToughness(rules, state, id);
  const defenderId = defendingPlayer(state);

  const step = (first: boolean) => {
    const acts = (id: CardId) => hasKeyword(rules, state, id, "first_strike") === first;
    const dealt: Record<CardId, number> = {};
    const deathtouched = new Set<CardId>();
    const lifeGain: Record<PlayerId, number> = {};
    const add = (id: CardId, n: number, source: CardId) => {
      if (n <= 0) return;
      dealt[id] = (dealt[id] ?? 0) + n;
      if (hasKeyword(rules, state, source, "deathtouch")) deathtouched.add(id);
    };
    const lifelink = (source: CardId, n: number) => {
      const owner = state.cards[source]?.owner;
      if (owner && n > 0 && hasKeyword(rules, state, source, "lifelink")) lifeGain[owner] = (lifeGain[owner] ?? 0) + n;
    };
    let toPlayer = 0;

    for (const attacker of combat.attackers) {
      if (!onBattlefield(state, attacker)) continue;
      const declared = combat.blocks.filter((b) => b.attacker === attacker).map((b) => b.blocker);
      const blockers = declared.filter((id) => onBattlefield(state, id));
      const trample = hasKeyword(rules, state, attacker, "trample");
      const attackerActs = acts(attacker);

      if (declared.length === 0 || (blockers.length === 0 && trample)) {
        if (attackerActs) {
          toPlayer += power(attacker);
          lifelink(attacker, power(attacker));
        }
        continue;
      }

      let remaining = power(attacker);
      const attackerDeathtouch = hasKeyword(rules, state, attacker, "deathtouch");
      blockers.forEach((blocker, i) => {
        const isLast = i === blockers.length - 1;
        if (attackerActs) {
          const remainingToughness = Math.max(0, toughness(blocker) - (state.cards[blocker]?.damage ?? 0));
          const lethal = attackerDeathtouch ? Math.min(1, remainingToughness) : remainingToughness;
          const assigned = isLast && !trample ? remaining : Math.min(remaining, lethal);
          add(blocker, assigned, attacker);
          lifelink(attacker, assigned);
          remaining -= assigned;
        }
        if (acts(blocker)) {
          add(attacker, power(blocker), blocker);
          lifelink(blocker, power(blocker));
        }
      });
      if (attackerActs && trample && remaining > 0) {
        toPlayer += remaining;
        lifelink(attacker, remaining);
      }
    }

    const defender = state.players[defenderId];
    if (defender && toPlayer > 0) {
      defender.life -= toPlayer;
      state.log.push(`${defenderId} takes ${toPlayer} combat damage`);
    }
    for (const [id, n] of Object.entries(dealt)) {
      const inst = state.cards[id];
      if (inst) {
        inst.damage += n;
        if (deathtouched.has(id)) inst.deathtouch = true;
      }
    }
    for (const [pid, n] of Object.entries(lifeGain)) {
      const p = state.players[pid];
      if (p) {
        p.life += n;
        state.log.push(`${pid} gains ${n} life`);
      }
    }
  };

  step(true);
  destroyDeadCreatures(rules, state); // first strikers may kill before the regular step
  step(false);
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
        if (!def?.token) state.players[inst.owner]?.graveyard.push(id); // tokens just cease to exist
        state.log.push(`${def?.name ?? id} dies`);
        queueTriggers(rules, state, id, "dies");
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
