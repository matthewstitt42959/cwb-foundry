import { COLORS, type CardId, type GameState, type ManaCost, type PlayerId, type Ruleset } from "./types";

/**
 * Pick untapped lands to pay `cost`, or null if it can't be paid.
 * Coloured requirements are paid first from matching lands, then generic from whatever is left.
 */
export function planPayment(
  rules: Ruleset,
  state: GameState,
  player: PlayerId,
  cost: ManaCost | undefined,
): CardId[] | null {
  if (!cost) return [];
  const p = state.players[player];
  if (!p) return null;

  const available = p.battlefield.filter((id) => {
    const inst = state.cards[id];
    const def = inst && rules.defs[inst.defId];
    return inst && !inst.tapped && def?.produces !== undefined;
  });

  const chosen: CardId[] = [];
  const remaining = new Set(available);

  for (const color of COLORS) {
    const need = cost[color] ?? 0;
    for (let n = 0; n < need; n++) {
      const land = [...remaining].find((id) => {
        const inst = state.cards[id];
        return inst && rules.defs[inst.defId]?.produces === color;
      });
      if (!land) return null;
      remaining.delete(land);
      chosen.push(land);
    }
  }

  const generic = cost.generic ?? 0;
  if (remaining.size < generic) return null;
  chosen.push(...[...remaining].slice(0, generic));
  return chosen;
}
