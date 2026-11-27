import {
  applyAction,
  getLegalActions,
  mtgPack,
  type CardDefs,
  type GameState,
  type Ruleset,
} from "@cwb/engine";
import { starterDefs } from "@cwb/cards";
import { chooseAction } from "@cwb/ai";

export const HUMAN = "you";
export const BOT = "ai";

/** Rules for one game: the MTG-style pack plus the starter cards and any imported ones. */
export function makeRules(extraDefs: CardDefs = {}): Ruleset {
  return { pack: mtgPack, defs: { ...starterDefs, ...extraDefs } };
}

export interface DriverOptions {
  /** If true, the human gets priority at every step. If false, empty steps are skipped. */
  stopEverywhere: boolean;
}

/**
 * Advance the game until the human has a real decision to make (or the game ends).
 * The bot acts whenever it has priority. The human is auto-passed when they have no
 * legal action besides passing, and (unless stopEverywhere) at quiet steps where the
 * stack is empty and it isn't one of their own main phases.
 */
export function autoplay(rules: Ruleset, state: GameState, opts: DriverOptions): GameState {
  let s = state;
  for (let i = 0; i < 2000 && !s.over; i++) {
    if (s.priority === BOT) {
      const r = applyAction(rules, s, chooseAction(rules, s));
      if (!r.ok) throw new Error(`Bot chose an illegal action: ${r.error}`);
      s = r.state;
      continue;
    }

    const legal = getLegalActions(rules, s);
    const canPass = legal.some((a) => a.type === "PASS");
    const onlyPass = legal.length === 1 && canPass;
    const phase = rules.pack.phases[s.phaseIndex];
    // An empty library with a graveyard to reclaim is a real choice: never skip past it,
    // or the human is auto-passed straight into the draw that loses the game.
    const canReclaim = legal.some((a) => a.type === "RECLAIM_GRAVEYARD");
    const quiet =
      !opts.stopEverywhere &&
      !canReclaim &&
      !s.pending &&
      s.stack.length === 0 &&
      !(s.activePlayer === HUMAN && phase?.main);

    if (canPass && (onlyPass || quiet)) {
      const r = applyAction(rules, s, { type: "PASS", player: HUMAN });
      if (!r.ok) throw new Error(`Auto-pass failed: ${r.error}`);
      s = r.state;
      continue;
    }
    break;
  }
  return s;
}
