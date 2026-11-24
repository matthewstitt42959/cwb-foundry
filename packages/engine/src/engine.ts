import { clone } from "./clone";
import { applyEffect, checkState, drawCards } from "./effects";
import { planPayment } from "./mana";
import { shuffle } from "./rng";
import type {
  Action,
  ApplyResult,
  CardId,
  GameState,
  PlayerId,
  PlayerState,
  Ruleset,
} from "./types";

export interface GameSetup {
  /** Deck lists by player, as arrays of card definition ids. Order = turn order. */
  decks: Record<PlayerId, string[]>;
  seed?: number;
}

export function createGame(rules: Ruleset, setup: GameSetup): GameState {
  const order = Object.keys(setup.decks);
  if (order.length !== 2) throw new Error("This engine version supports exactly two players");

  let rngState = setup.seed ?? 1;
  const cards: GameState["cards"] = {};
  const players: GameState["players"] = {};

  for (const pid of order) {
    const list = setup.decks[pid] ?? [];
    const ids: CardId[] = [];
    list.forEach((defId, i) => {
      if (!rules.defs[defId]) throw new Error(`Unknown card definition "${defId}" in ${pid}'s deck`);
      const id = `${pid}:${i}`;
      cards[id] = { id, defId, owner: pid, tapped: false };
      ids.push(id);
    });
    const shuffled = shuffle(ids, rngState);
    rngState = shuffled.state;
    const player: PlayerState = {
      life: rules.pack.startingLife,
      library: shuffled.items,
      hand: [],
      battlefield: [],
      graveyard: [],
      landsPlayed: 0,
      lost: false,
    };
    players[pid] = player;
  }

  const first = order[0] as PlayerId;
  const state: GameState = {
    packId: rules.pack.id,
    players,
    order,
    cards,
    turn: 1,
    activePlayer: first,
    phaseIndex: 0,
    priority: first,
    passes: 0,
    stack: [],
    rngState,
    over: false,
    winner: null,
    log: [],
  };

  for (const pid of order) drawCards(state, pid, rules.pack.startingHandSize);
  checkState(state);
  if (!state.over) enterPhase(rules, state);
  return state;
}

// ---- turn structure -------------------------------------------------------

function nextPlayer(state: GameState, player: PlayerId): PlayerId {
  const i = state.order.indexOf(player);
  return state.order[(i + 1) % state.order.length] as PlayerId;
}

/** Run phase entry hooks; skip through phases where nobody gets priority. */
function enterPhase(rules: Ruleset, state: GameState): void {
  for (;;) {
    const phase = rules.pack.phases[state.phaseIndex];
    if (!phase) throw new Error(`Rule pack "${rules.pack.id}" has no phase at index ${state.phaseIndex}`);

    if (phase.onEnter === "untap") {
      for (const id of state.players[state.activePlayer]?.battlefield ?? []) {
        const inst = state.cards[id];
        if (inst) inst.tapped = false;
      }
    } else if (phase.onEnter === "draw") {
      const skip = state.turn === 1 && !rules.pack.drawOnFirstTurn;
      if (!skip) drawCards(state, state.activePlayer, 1);
    }

    checkState(state);
    if (state.over) return;

    state.priority = state.activePlayer;
    state.passes = 0;
    if (phase.hasPriority) return;
    advancePhase(rules, state, false);
  }
}

function advancePhase(rules: Ruleset, state: GameState, enter = true): void {
  state.phaseIndex++;
  if (state.phaseIndex >= rules.pack.phases.length) {
    state.phaseIndex = 0;
    state.turn++;
    state.activePlayer = nextPlayer(state, state.activePlayer);
    const p = state.players[state.activePlayer];
    if (p) p.landsPlayed = 0;
    state.log.push(`Turn ${state.turn}: ${state.activePlayer}`);
  }
  if (enter) enterPhase(rules, state);
}

function resolveTop(rules: Ruleset, state: GameState): void {
  const item = state.stack.pop();
  if (!item) return;
  const inst = state.cards[item.cardId];
  const def = inst && rules.defs[inst.defId];
  const owner = inst && state.players[inst.owner];
  if (!inst || !def || !owner) return;

  if (def.types.includes("creature")) {
    owner.battlefield.push(inst.id);
    state.log.push(`${def.name} enters the battlefield`);
  } else {
    state.log.push(`${def.name} resolves`);
    for (const effect of def.effects ?? []) applyEffect(state, effect, item.controller);
    owner.graveyard.push(inst.id);
  }
  checkState(state);
}

// ---- legality -------------------------------------------------------------

/** Returns an error message if `action` is illegal, or null if it is legal. */
export function validateAction(rules: Ruleset, state: GameState, action: Action): string | null {
  if (state.over) return "The game is over";
  if (state.priority !== action.player) return "You do not have priority";
  const me = state.players[action.player];
  if (!me) return "Unknown player";
  if (action.type === "PASS") return null;

  if (!me.hand.includes(action.cardId)) return "Card is not in your hand";
  const inst = state.cards[action.cardId];
  const def = inst && rules.defs[inst.defId];
  if (!inst || !def) return "Unknown card";

  const phase = rules.pack.phases[state.phaseIndex];
  const sorcerySpeed =
    state.activePlayer === action.player && !!phase?.main && state.stack.length === 0;

  if (action.type === "PLAY_LAND") {
    if (!def.types.includes("land")) return "Not a land";
    if (!sorcerySpeed) return "Lands can only be played in your main phase with an empty stack";
    if (me.landsPlayed >= rules.pack.landDropsPerTurn) return "No land drops left this turn";
    return null;
  }

  // CAST
  if (def.types.includes("land")) return "Lands are played, not cast";
  const isInstant = def.types.includes("instant");
  if (!isInstant && !sorcerySpeed) return "Only instants can be cast now";
  if (!planPayment(rules, state, action.player, def.cost)) return "Cannot pay the cost";
  return null;
}

export function getLegalActions(rules: Ruleset, state: GameState): Action[] {
  if (state.over) return [];
  const player = state.priority;
  const me = state.players[player];
  if (!me) return [];
  const candidates: Action[] = [{ type: "PASS", player }];
  for (const cardId of me.hand) {
    candidates.push({ type: "PLAY_LAND", player, cardId }, { type: "CAST", player, cardId });
  }
  return candidates.filter((a) => validateAction(rules, state, a) === null);
}

// ---- transitions ----------------------------------------------------------

/** Pure: never mutates `state`. Returns a new state or an error. */
export function applyAction(rules: Ruleset, state: GameState, action: Action): ApplyResult {
  const error = validateAction(rules, state, action);
  if (error) return { ok: false, error };

  const next = clone(state);
  const me = next.players[action.player] as PlayerState;

  switch (action.type) {
    case "PLAY_LAND": {
      me.hand.splice(me.hand.indexOf(action.cardId), 1);
      me.battlefield.push(action.cardId);
      me.landsPlayed++;
      next.passes = 0;
      next.log.push(`${action.player} plays a land`);
      break;
    }
    case "CAST": {
      const inst = next.cards[action.cardId];
      const def = inst && rules.defs[inst.defId];
      const lands = def && planPayment(rules, next, action.player, def.cost);
      if (!inst || !def || !lands) return { ok: false, error: "Cannot pay the cost" };
      for (const id of lands) {
        const land = next.cards[id];
        if (land) land.tapped = true;
      }
      me.hand.splice(me.hand.indexOf(action.cardId), 1);
      next.stack.push({ cardId: action.cardId, controller: action.player });
      // After casting, the caster receives priority again and everyone may respond.
      next.passes = 0;
      next.log.push(`${action.player} casts ${def.name}`);
      break;
    }
    case "PASS": {
      next.passes++;
      if (next.passes >= next.order.length) {
        if (next.stack.length > 0) {
          resolveTop(rules, next);
          next.passes = 0;
          next.priority = next.activePlayer;
        } else {
          advancePhase(rules, next);
        }
      } else {
        next.priority = nextPlayer(next, action.player);
      }
      break;
    }
  }
  return { ok: true, state: next };
}
