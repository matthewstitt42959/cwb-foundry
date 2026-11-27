import { queueTriggers } from "./triggers";
import type { CardId, Effect, GameState, PlayerId, Ruleset, Target } from "./types";

export function opponentOf(state: GameState, player: PlayerId): PlayerId {
  const other = state.order.find((p) => p !== player);
  if (!other) throw new Error("opponentOf requires at least two players");
  return other;
}

export function drawCards(state: GameState, player: PlayerId, count: number): void {
  const p = state.players[player];
  if (!p) return;
  for (let i = 0; i < count; i++) {
    const top = p.library.shift();
    if (top === undefined) {
      // Drawing from an empty library loses the game (checked in checkState).
      p.lost = true;
      state.log.push(`${player} drew from an empty library`);
      return;
    }
    p.hand.push(top);
  }
}

/** Mark losers and detect the end of the game. */
export function checkState(state: GameState): void {
  for (const id of state.order) {
    const p = state.players[id];
    if (p && p.life <= 0 && !p.lost) {
      p.lost = true;
      state.log.push(`${id} is at ${p.life} life`);
    }
  }
  const alive = state.order.filter((id) => !state.players[id]?.lost);
  if (alive.length <= 1 && !state.over) {
    state.over = true;
    state.winner = alive[0] ?? null;
    state.log.push(state.winner ? `${state.winner} wins` : "Game is a draw");
  }
}

/** Move a permanent from the battlefield to its owner's graveyard. */
export function putInGraveyard(rules: Ruleset, state: GameState, cardId: CardId): void {
  for (const pid of state.order) {
    const p = state.players[pid];
    if (p?.battlefield.includes(cardId)) p.battlefield = p.battlefield.filter((id) => id !== cardId);
  }
  const inst = state.cards[cardId];
  if (inst && !rules.defs[inst.defId]?.token) state.players[inst.owner]?.graveyard.push(cardId);
}

/**
 * Apply one effect. `targets` are the choices made on cast; the caller has already
 * checked they are still legal (otherwise the spell fizzles before getting here).
 */
export function applyEffect(
  rules: Ruleset,
  state: GameState,
  effect: Effect,
  controller: PlayerId,
  targets: Target[],
  x = 0,
): void {
  const name = (id: CardId) => {
    const inst = state.cards[id];
    return (inst && rules.defs[inst.defId]?.name) ?? id;
  };

  if (effect.kind === "destroy") {
    const t = targets[0];
    if (t?.kind === "card") {
      state.log.push(`${name(t.id)} is destroyed`);
      putInGraveyard(rules, state, t.id);
      queueTriggers(rules, state, t.id, "dies");
    }
    return;
  }

  if (effect.kind === "damage" && (effect.target === "any" || effect.target === "creature")) {
    const t = targets[0];
    if (t?.kind === "card") {
      const inst = state.cards[t.id];
      if (inst) inst.damage += effect.amount;
      state.log.push(`${name(t.id)} takes ${effect.amount} damage`);
    } else if (t?.kind === "player") {
      const p = state.players[t.id];
      if (p) p.life -= effect.amount;
      state.log.push(`${t.id} takes ${effect.amount} damage`);
    }
    return;
  }

  if (effect.kind === "create_token") {
    const def = rules.defs[effect.tokenDefId];
    const p = state.players[controller];
    if (!def || !p) return;
    for (let i = 0; i < effect.count; i++) {
      const id = `${controller}:token${state.tokens++}`;
      state.cards[id] = { id, defId: def.id, owner: controller, tapped: false, damage: 0, enteredTurn: state.turn };
      p.battlefield.push(id);
    }
    state.log.push(`${controller} creates ${effect.count === 1 ? "a" : effect.count} ${effect.label}${effect.count === 1 ? "" : "s"}`);
    return;
  }

  if (effect.kind === "search_library") {
    // The searching player chooses (or declines), so resolveTop must start a pending search.
    throw new Error("search effects must be resolved by resolveTop, not applyEffect");
  }

  if (effect.kind === "damage_all") {
    const amount = effect.amount === "x" ? x : effect.amount;
    if (amount > 0) {
      for (const pid of state.order) {
        const p = state.players[pid];
        if (!p) continue;
        for (const id of p.battlefield) {
          const inst = state.cards[id];
          if (inst && rules.defs[inst.defId]?.types.includes("creature")) inst.damage += amount;
        }
        p.life -= amount;
      }
      state.log.push(`${amount} damage is dealt to each creature and each player`);
    }
    return;
  }

  if (effect.kind === "pump") {
    const t = targets[0];
    if (t?.kind === "card") {
      const inst = state.cards[t.id];
      if (inst) {
        inst.tempPower = (inst.tempPower ?? 0) + effect.power;
        inst.tempToughness = (inst.tempToughness ?? 0) + effect.toughness;
      }
      state.log.push(`${name(t.id)} gets ${effect.power >= 0 ? "+" : ""}${effect.power}/${effect.toughness >= 0 ? "+" : ""}${effect.toughness} until end of turn`);
    }
    return;
  }

  const who = effect.target === "self" ? controller : opponentOf(state, controller);
  const p = state.players[who];
  if (!p) return;
  switch (effect.kind) {
    case "damage":
      p.life -= effect.amount;
      state.log.push(`${who} takes ${effect.amount} damage`);
      break;
    case "lose_life":
      p.life -= effect.amount;
      state.log.push(`${who} loses ${effect.amount} life`);
      break;
    case "gain_life":
      p.life += effect.amount;
      state.log.push(`${who} gains ${effect.amount} life`);
      break;
    case "draw":
      drawCards(state, who, effect.amount);
      state.log.push(`${who} draws ${effect.amount}`);
      break;
    case "discard":
      // The discarding player chooses the card, so this needs a pending player decision
      // (like attackers/blockers): resolveTop must intercept "discard" before calling here.
      throw new Error("discard effects must be resolved by resolveTop, not applyEffect");
    default: {
      const exhaustive: never = effect;
      throw new Error(`Unhandled effect kind: ${(exhaustive as Effect).kind}`);
    }
  }
}
