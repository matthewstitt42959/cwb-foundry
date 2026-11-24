import type { Effect, GameState, PlayerId } from "./types";

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

export function applyEffect(state: GameState, effect: Effect, controller: PlayerId): void {
  const target = effect.target === "self" ? controller : opponentOf(state, controller);
  const p = state.players[target];
  if (!p) return;
  switch (effect.kind) {
    case "damage":
      p.life -= effect.amount;
      state.log.push(`${target} takes ${effect.amount} damage`);
      break;
    case "gain_life":
      p.life += effect.amount;
      state.log.push(`${target} gains ${effect.amount} life`);
      break;
    case "draw":
      drawCards(state, target, effect.amount);
      state.log.push(`${target} draws ${effect.amount}`);
      break;
    default: {
      const _exhaustive: never = effect;
      throw new Error(`Unhandled effect: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
