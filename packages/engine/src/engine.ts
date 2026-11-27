import { clone } from "./clone";
import {
  attackCandidates,
  blockCandidates,
  clearDamage,
  declareAttackers,
  declarer,
  destroyDeadCreatures,
  resolveCombatDamage,
  validateAttackers,
  validateBlocks,
} from "./combat";
import { applyEffect, checkState, drawCards, opponentOf } from "./effects";
import { isLegalTarget, legalTargets, legalTargetsForSpec, targetSpecOf, targetSpecOfEffect } from "./targeting";
import { planPayment } from "./mana";
import { shuffle } from "./rng";
import type {
  Action,
  ApplyResult,
  CardId,
  Cost,
  Effect,
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
      cards[id] = { id, defId, owner: pid, tapped: false, damage: 0, enteredTurn: 0 };
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
    combat: null,
    pending: null,
    discard: null,
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

    let gives = phase.hasPriority;

    switch (phase.onEnter) {
      case "untap":
        for (const id of state.players[state.activePlayer]?.battlefield ?? []) {
          const inst = state.cards[id];
          if (inst) inst.tapped = false;
        }
        break;
      case "draw":
        if (!(state.turn === 1 && !rules.pack.drawOnFirstTurn)) drawCards(state, state.activePlayer, 1);
        break;
      case "declare_attackers":
        state.combat = null;
        state.pending = null;
        if (attackCandidates(rules, state).length > 0) {
          state.pending = "attackers";
        } else {
          gives = false; // nobody can attack: skip combat entirely
        }
        break;
      case "declare_blockers":
        if (!state.combat || state.combat.attackers.length === 0) {
          gives = false;
        } else if (blockCandidates(rules, state).length > 0) {
          state.pending = "blockers";
        }
        break;
      case "combat_damage":
        if (!state.combat || state.combat.attackers.length === 0) {
          gives = false;
        } else {
          resolveCombatDamage(rules, state);
          destroyDeadCreatures(rules, state);
          state.combat = null;
        }
        break;
      case "cleanup":
        clearDamage(state);
        state.combat = null;
        break;
    }

    checkState(state);
    if (state.over) return;

    state.priority = pendingActor(state) ?? state.activePlayer;
    state.passes = 0;
    if (gives) return;
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

/**
 * Begins a discard: who must discard, and how many. Returns false (a no-op, matching
 * real MTG) if that player's hand is already empty, so there's nothing to resolve.
 */
function beginDiscard(state: GameState, effect: Extract<Effect, { kind: "discard" }>, controller: PlayerId): boolean {
  const who = effect.target === "self" ? controller : opponentOf(state, controller);
  const hand = state.players[who]?.hand ?? [];
  if (hand.length === 0) return false;
  state.pending = "discard";
  state.discard = { player: who, count: Math.min(effect.amount, hand.length) };
  return true;
}

/**
 * Can every component of this ability's cost currently be paid? A {T} cost needs the
 * source untapped and, like attacking, not summoning sick unless it has haste.
 */
function canPayCost(rules: Ruleset, state: GameState, sourceId: CardId, costs: Cost[]): boolean {
  const inst = state.cards[sourceId];
  if (!inst) return false;
  return costs.every((cost) => {
    if (cost.kind !== "tap") return true;
    if (inst.tapped) return false;
    const hasHaste = rules.defs[inst.defId]?.keywords?.includes("haste") ?? false;
    return inst.enteredTurn < state.turn || hasHaste;
  });
}

/** Pays an already-validated cost. */
function payCost(state: GameState, sourceId: CardId, costs: Cost[]): void {
  const inst = state.cards[sourceId];
  if (!inst) return;
  for (const cost of costs) {
    if (cost.kind === "tap") inst.tapped = true;
  }
}

function resolveTop(rules: Ruleset, state: GameState): void {
  const item = state.stack.pop();
  if (!item) return;

  if (item.kind === "ability") {
    const effect = item.effect;
    if (effect.kind === "discard") {
      if (beginDiscard(state, effect, item.controller)) return; // a discard is now pending
    } else {
      const spec = targetSpecOfEffect(effect);
      const target = item.targets[0];
      if (spec && !(target && isLegalTarget(rules, state, spec, target))) {
        state.log.push("An ability fizzles (its target is gone)");
      } else {
        applyEffect(rules, state, effect, item.controller, item.targets);
      }
    }
    destroyDeadCreatures(rules, state);
    checkState(state);
    return;
  }

  const inst = state.cards[item.cardId];
  const def = inst && rules.defs[inst.defId];
  const owner = inst && state.players[inst.owner];
  if (!inst || !def || !owner) return;

  if (def.types.includes("creature")) {
    owner.battlefield.push(inst.id);
    inst.enteredTurn = state.turn;
    state.log.push(`${def.name} enters the battlefield`);
    for (const effect of def.effects ?? []) {
      if (effect.kind === "discard") {
        if (beginDiscard(state, effect, item.controller)) return; // a discard is now pending
        continue; // nothing in hand to discard: no-op, like real MTG
      }
      applyEffect(rules, state, effect, item.controller, item.targets);
    }
  } else {
    const spec = targetSpecOf(def);
    const target = item.targets[0];
    if (spec && !(target && isLegalTarget(rules, state, spec, target))) {
      state.log.push(`${def.name} fizzles (its target is gone)`);
    } else {
      state.log.push(`${def.name} resolves`);
      for (const effect of def.effects ?? []) applyEffect(rules, state, effect, item.controller, item.targets);
    }
    owner.graveyard.push(inst.id);
  }
  destroyDeadCreatures(rules, state);
  checkState(state);
}

/** Who must act while a declaration or discard is pending (null if nothing is). */
function pendingActor(state: GameState): PlayerId | null {
  if (state.pending === "discard") return state.discard?.player ?? null;
  return declarer(state);
}

/** Validates a DISCARD action against the pending discard, or an error message. */
function validateDiscard(state: GameState, cardIds: CardId[]): string | null {
  const d = state.discard;
  if (!d) return "Not discarding now";
  if (cardIds.length !== d.count) return `Choose ${d.count} card${d.count === 1 ? "" : "s"} to discard`;
  const hand = state.players[d.player]?.hand ?? [];
  const seen = new Set<CardId>();
  for (const id of cardIds) {
    if (seen.has(id)) return "Can't discard the same card twice";
    seen.add(id);
    if (!hand.includes(id)) return "Card is not in your hand";
  }
  return null;
}

// ---- legality -------------------------------------------------------------

/** Returns an error message if `action` is illegal, or null if it is legal. */
export function validateAction(rules: Ruleset, state: GameState, action: Action): string | null {
  if (state.over) return "The game is over";

  // A player may concede at any time, regardless of priority or a pending declaration.
  if (action.type === "CONCEDE") return state.players[action.player] ? null : "Unknown player";

  // Reclaiming is likewise priority-free: the human decides it for either side, so it
  // can name a player who doesn't currently hold priority.
  if (action.type === "RECLAIM_GRAVEYARD") {
    const p = state.players[action.player];
    if (!p) return "Unknown player";
    if (p.library.length > 0) return "That library isn't empty";
    if (p.graveyard.length === 0) return "That graveyard is empty too";
    return null;
  }

  // While a declaration or discard is pending, only that action is legal.
  if (state.pending) {
    if (action.player !== pendingActor(state)) return "Waiting for the other player to declare";
    if (action.type === "DECLARE_ATTACKERS" && state.pending === "attackers") {
      return validateAttackers(rules, state, action.attackers);
    }
    if (action.type === "DECLARE_BLOCKERS" && state.pending === "blockers") {
      return validateBlocks(rules, state, action.blocks);
    }
    if (action.type === "DISCARD" && state.pending === "discard") {
      return validateDiscard(state, action.cardIds);
    }
    if (state.pending === "attackers") return "Declare attackers first";
    if (state.pending === "blockers") return "Declare blockers first";
    return "Discard a card first";
  }
  if (action.type === "DECLARE_ATTACKERS" || action.type === "DECLARE_BLOCKERS" || action.type === "DISCARD") {
    return "Not declaring now";
  }

  if (state.priority !== action.player) return "You do not have priority";
  const me = state.players[action.player];
  if (!me) return "Unknown player";
  if (action.type === "PASS") return null;

  if (action.type === "ACTIVATE") {
    if (!me.battlefield.includes(action.cardId)) return "You don't control that permanent";
    const inst = state.cards[action.cardId];
    const def = inst && rules.defs[inst.defId];
    const ability = def?.abilities?.[action.abilityIndex];
    if (!ability) return "No such ability";
    if (!canPayCost(rules, state, action.cardId, ability.cost)) return "Cannot pay the cost";
    const spec = targetSpecOfEffect(ability.effect);
    const targets = action.targets ?? [];
    if (spec) {
      const t = targets[0];
      if (targets.length !== 1 || !t) return "Choose a target";
      if (!isLegalTarget(rules, state, spec, t)) return "Invalid target";
    } else if (targets.length > 0) {
      return "This ability has no targets";
    }
    return null;
  }

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

  const spec = targetSpecOf(def);
  const targets = action.targets ?? [];
  if (spec) {
    const t = targets[0];
    if (targets.length !== 1 || !t) return "Choose a target";
    if (!isLegalTarget(rules, state, spec, t)) return "Invalid target";
  } else if (targets.length > 0) {
    return "This spell has no targets";
  }
  return null;
}

export function getLegalActions(rules: Ruleset, state: GameState): Action[] {
  if (state.over) return [];
  const player = state.priority;
  const me = state.players[player];
  if (!me) return [];

  // Declarations: the full set of combinations is exponential, so list the empty
  // declaration, each single choice, and (for attackers) "everything attacks".
  // Use attackCandidates / blockCandidates for custom combinations.
  if (state.pending === "attackers") {
    const all = attackCandidates(rules, state);
    const options: Action[] = [
      { type: "DECLARE_ATTACKERS", player, attackers: [] },
      ...all.map((id): Action => ({ type: "DECLARE_ATTACKERS", player, attackers: [id] })),
    ];
    if (all.length > 1) options.push({ type: "DECLARE_ATTACKERS", player, attackers: all });
    return options;
  }
  if (state.pending === "blockers") {
    const options: Action[] = [{ type: "DECLARE_BLOCKERS", player, blocks: [] }];
    for (const blocker of blockCandidates(rules, state)) {
      for (const attacker of state.combat?.attackers ?? []) {
        const a: Action = { type: "DECLARE_BLOCKERS", player, blocks: [{ blocker, attacker }] };
        if (validateAction(rules, state, a) === null) options.push(a);
      }
    }
    return options;
  }
  if (state.pending === "discard" && state.discard) {
    const { player: who, count } = state.discard;
    const hand = state.players[who]?.hand ?? [];
    if (count >= hand.length) return [{ type: "DISCARD", player: who, cardIds: [...hand] }];
    return hand.map((cardId): Action => ({ type: "DISCARD", player: who, cardIds: [cardId] }));
  }

  const candidates: Action[] = [{ type: "PASS", player }];
  if (me.library.length === 0 && me.graveyard.length > 0) {
    candidates.push({ type: "RECLAIM_GRAVEYARD", player });
  }
  for (const cardId of me.hand) {
    candidates.push({ type: "PLAY_LAND", player, cardId });
    const inst = state.cards[cardId];
    const def = inst && rules.defs[inst.defId];
    if (def && targetSpecOf(def)) {
      for (const t of legalTargets(rules, state, def)) {
        candidates.push({ type: "CAST", player, cardId, targets: [t] });
      }
    } else {
      candidates.push({ type: "CAST", player, cardId });
    }
  }
  for (const cardId of me.battlefield) {
    const inst = state.cards[cardId];
    const def = inst && rules.defs[inst.defId];
    def?.abilities?.forEach((ability, abilityIndex) => {
      if (!canPayCost(rules, state, cardId, ability.cost)) return;
      const spec = targetSpecOfEffect(ability.effect);
      if (spec) {
        for (const t of legalTargetsForSpec(rules, state, spec)) {
          candidates.push({ type: "ACTIVATE", player, cardId, abilityIndex, targets: [t] });
        }
      } else {
        candidates.push({ type: "ACTIVATE", player, cardId, abilityIndex });
      }
    });
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
    case "DECLARE_ATTACKERS": {
      next.pending = null;
      next.passes = 0;
      if (action.attackers.length === 0) {
        next.combat = null;
        next.log.push(`${action.player} declares no attackers`);
        advancePhase(rules, next); // no attackers: skip the rest of combat
      } else {
        declareAttackers(rules, next, action.attackers);
        next.priority = next.activePlayer;
      }
      break;
    }
    case "DECLARE_BLOCKERS": {
      next.pending = null;
      next.passes = 0;
      if (next.combat) next.combat.blocks = [...action.blocks];
      const nameOf = (id: CardId) => {
        const inst = next.cards[id];
        return (inst && rules.defs[inst.defId]?.name) ?? id;
      };
      for (const b of action.blocks) next.log.push(`${nameOf(b.blocker)} blocks ${nameOf(b.attacker)}`);
      next.priority = next.activePlayer;
      break;
    }
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
      next.stack.push({ kind: "spell", cardId: action.cardId, controller: action.player, targets: action.targets ?? [] });
      // After casting, the caster receives priority again and everyone may respond.
      next.passes = 0;
      next.log.push(`${action.player} casts ${def.name}`);
      break;
    }
    case "ACTIVATE": {
      const inst = next.cards[action.cardId];
      const def = inst && rules.defs[inst.defId];
      const ability = def?.abilities?.[action.abilityIndex];
      if (!inst || !ability) return { ok: false, error: "No such ability" };
      payCost(next, action.cardId, ability.cost);
      next.stack.push({
        kind: "ability",
        sourceId: action.cardId,
        controller: action.player,
        effect: ability.effect,
        targets: action.targets ?? [],
      });
      // Same as casting: the activator keeps priority and everyone may respond.
      next.passes = 0;
      next.log.push(`${action.player} activates ${def.name}`);
      break;
    }
    case "CONCEDE": {
      me.lost = true;
      next.log.push(`${action.player} concedes`);
      checkState(next);
      break;
    }
    case "RECLAIM_GRAVEYARD": {
      const shuffled = shuffle(me.graveyard, next.rngState);
      next.rngState = shuffled.state;
      me.library = shuffled.items;
      me.graveyard = [];
      next.log.push(`${action.player} shuffles their graveyard back into their library`);
      break;
    }
    case "PASS": {
      next.passes++;
      if (next.passes >= next.order.length) {
        if (next.stack.length > 0) {
          resolveTop(rules, next);
          next.passes = 0;
          next.priority = pendingActor(next) ?? next.activePlayer;
        } else {
          advancePhase(rules, next);
        }
      } else {
        next.priority = nextPlayer(next, action.player);
      }
      break;
    }
    case "DISCARD": {
      const d = next.discard;
      next.pending = null;
      next.discard = null;
      next.passes = 0;
      if (d) {
        const discarder = next.players[d.player];
        for (const id of action.cardIds) {
          if (discarder) discarder.hand = discarder.hand.filter((c) => c !== id);
          discarder?.graveyard.push(id);
        }
        next.log.push(`${d.player} discards ${action.cardIds.length === 1 ? "a card" : `${action.cardIds.length} cards`}`);
      }
      destroyDeadCreatures(rules, next);
      checkState(next);
      next.priority = next.activePlayer;
      break;
    }
  }
  return { ok: true, state: next };
}
