import type { CardDef, CardId, ChosenTargetSpec, GameState, Ruleset, Target } from "./types";

/** Which kind of target a card needs chosen when cast, or null if it needs none. */
export function targetSpecOf(def: CardDef): ChosenTargetSpec | null {
  let spec: ChosenTargetSpec | null = null;
  for (const e of def.effects ?? []) {
    if (e.target === "creature") return "creature"; // the narrowest requirement wins
    if (e.target === "any") spec = "any";
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
  return creaturesInPlay(rules, state).includes(target.id);
}

export function legalTargets(rules: Ruleset, state: GameState, def: CardDef): Target[] {
  const spec = targetSpecOf(def);
  if (!spec) return [];
  const out: Target[] = [];
  if (spec === "any") {
    for (const id of state.order) {
      if (!state.players[id]?.lost) out.push({ kind: "player", id });
    }
  }
  for (const id of creaturesInPlay(rules, state)) out.push({ kind: "card", id });
  return out;
}
