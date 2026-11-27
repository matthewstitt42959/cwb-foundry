import { legalTargetsForSpec, targetSpecOfEffect } from "./targeting";
import type { CardId, GameState, Ruleset, TriggerEvent } from "./types";

/** Records that `sourceId`'s triggers for `event` have fired. They go on the stack in flushTriggers. */
export function queueTriggers(rules: Ruleset, state: GameState, sourceId: CardId, event: TriggerEvent): void {
  const inst = state.cards[sourceId];
  const def = inst && rules.defs[inst.defId];
  if (!inst || !def) return;
  for (const trigger of def.triggers ?? []) {
    if (trigger.on === event) {
      state.triggers.push({ sourceId, controller: inst.owner, effect: trigger.effect });
    }
  }
}

/**
 * Puts fired triggers on the stack, in the order they fired. A trigger with no legal target
 * is dropped, one with a single legal target uses it, and one with a real choice stops here
 * with `pending: "target"` so its controller can decide (the rest wait their turn).
 */
export function flushTriggers(rules: Ruleset, state: GameState): void {
  let pushed = false;
  while (state.triggers.length > 0 && !state.over && !state.pending) {
    const t = state.triggers.shift();
    if (!t) break;
    const name = rules.defs[state.cards[t.sourceId]?.defId ?? ""]?.name ?? t.sourceId;
    const spec = targetSpecOfEffect(t.effect);
    let targets: GameState["stack"][number]["targets"] = [];
    if (spec) {
      const options = legalTargetsForSpec(rules, state, spec);
      if (options.length === 0) {
        state.log.push(`${name}'s ability has no legal target`);
        continue;
      }
      const only = options[0];
      if (options.length > 1 || !only) {
        state.pending = "target";
        state.targeting = { player: t.controller, sourceId: t.sourceId, effect: t.effect };
        state.priority = t.controller;
        state.passes = 0;
        return;
      }
      targets = [only];
    }
    state.stack.push({ kind: "ability", sourceId: t.sourceId, controller: t.controller, effect: t.effect, targets });
    state.log.push(`${name}'s ability triggers`);
    pushed = true;
  }
  if (pushed) {
    state.passes = 0;
    state.priority = state.activePlayer;
  }
}
