import type { CardDef, CardId, ChosenTargetSpec, Effect, GameState, Ruleset, Target } from "./types";

/** Which kind of chosen target (if any) a single effect needs. */
export function targetSpecOfEffect(e: Effect): ChosenTargetSpec | null {
  if (e.kind === "damage_all") return null;
  if (e.target === "creature" || e.target === "blocking_creature" || e.target === "any") return e.target;
  return null;
}

/** Which kind of target a card needs chosen when cast, or null if it needs none. */
export function targetSpecOf(def: CardDef): ChosenTargetSpec | null {
  let spec: ChosenTargetSpec | null = null;
  for (const e of def.effects ?? []) {
    const s = targetSpecOfEffect(e);
    if (s === "creature" || s === "blocking_creature") return s; // the narrowest requirement wins
    if (s === "any") spec = "any";
  }
  return spec;
}

export function creaturesInPlay(rules: Ruleset, state: GameState): CardId[] {
  const out: CardId[] = [];
  for (const pid of state.order) {
    for (const id of state.players[pid]?.battlefield ?? []) {
      const inst = state.cards[id];
      if (inst && rules.defs[inst.defId]?.types.includes("creature")) out.push(id);
    }
  }
  return out;
}

/** Every creature currently declared as a blocker in the active combat (any attacker's). */
export function blockingCreatures(state: GameState): CardId[] {
  return (state.combat?.blocks ?? []).map((b) => b.blocker);
}

export function isLegalTarget(
  rules: Ruleset,
  state: GameState,
  spec: ChosenTargetSpec,
  target: Target,
): boolean {
  if (target.kind === "player") {
    const p = state.players[target.id];
    return spec === "any" && !!p && !p.lost;
  }
  if (spec === "blocking_creature") return blockingCreatures(state).includes(target.id);
  return creaturesInPlay(rules, state).includes(target.id);
}

/** Builds the legal target list for a target spec directly (abilities don't have a CardDef to scan). */
export function legalTargetsForSpec(rules: Ruleset, state: GameState, spec: ChosenTargetSpec | null): Target[] {
  if (!spec) return [];
  if (spec === "blocking_creature") {
    return blockingCreatures(state).map((id): Target => ({ kind: "card", id }));
  }
  const out: Target[] = [];
  if (spec === "any") {
    for (const id of state.order) {
      if (!state.players[id]?.lost) out.push({ kind: "player", id });
    }
  }
  for (const id of creaturesInPlay(rules, state)) out.push({ kind: "card", id });
  return out;
}

export function legalTargets(rules: Ruleset, state: GameState, def: CardDef): Target[] {
  return legalTargetsForSpec(rules, state, targetSpecOf(def));
}
