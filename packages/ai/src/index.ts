import {
  attackCandidates,
  blockCandidates,
  getLegalActions,
  validateAction,
  type Action,
  type BlockAssignment,
  type CardDef,
  type CardId,
  type Effect,
  type GameState,
  type Keyword,
  type ManaCost,
  type PlayerId,
  type Ruleset,
  type Target,
} from "@cwb/engine";

/**
 * Pick an action for whoever currently has priority (or must declare).
 * Purely heuristic and deterministic: the same state always gives the same choice.
 * The result is always a legal action.
 */
export function chooseAction(rules: Ruleset, state: GameState): Action {
  const me = state.priority;
  const legal = getLegalActions(rules, state);
  const pass: Action = { type: "PASS", player: me };

  let choice: Action;
  if (state.pending === "attackers") choice = decideAttackers(rules, state, me);
  else if (state.pending === "blockers") choice = decideBlockers(rules, state, me);
  else if (state.pending === "discard") choice = decideDiscard(rules, state, me);
  else if (state.pending === "target") choice = decideTrigger(rules, state, me, legal);
  else if (state.pending === "search") choice = decideSearch(rules, state, me, legal);
  else choice = decideMain(rules, state, me, legal) ?? pass;

  if (validateAction(rules, state, choice) === null) return choice;
  return legal[0] ?? pass; // safety net: never return something illegal
}

// ---- helpers --------------------------------------------------------------

const defOf = (rules: Ruleset, state: GameState, id: CardId): CardDef | undefined => {
  const inst = state.cards[id];
  return inst ? rules.defs[inst.defId] : undefined;
};

const manaValue = (cost?: ManaCost): number =>
  cost ? (cost.generic ?? 0) + (cost.W ?? 0) + (cost.U ?? 0) + (cost.B ?? 0) + (cost.R ?? 0) + (cost.G ?? 0) : 0;

const power = (r: Ruleset, s: GameState, id: CardId) => defOf(r, s, id)?.power ?? 0;
const toughnessLeft = (r: Ruleset, s: GameState, id: CardId) =>
  (defOf(r, s, id)?.toughness ?? 0) - (s.cards[id]?.damage ?? 0);
const isFlyer = (r: Ruleset, s: GameState, id: CardId) => !!defOf(r, s, id)?.keywords?.includes("flying");
const value = (r: Ruleset, s: GameState, id: CardId) =>
  manaValue(defOf(r, s, id)?.cost) * 3 + power(r, s, id) * 2 + (defOf(r, s, id)?.toughness ?? 0);

function opponentOf(state: GameState, me: PlayerId): PlayerId {
  return state.order.find((p) => p !== me) as PlayerId;
}

const hasKw = (r: Ruleset, s: GameState, id: CardId, kw: Keyword) => !!defOf(r, s, id)?.keywords?.includes(kw);

/** Mirrors the engine's per-pair blocking rules. Menace needs two blockers, which the AI never plans. */
function canBlock(r: Ruleset, s: GameState, blocker: CardId, attacker: CardId): boolean {
  if (hasKw(r, s, attacker, "menace")) return false;
  if (isFlyer(r, s, attacker) && !isFlyer(r, s, blocker)) return false;
  if (hasKw(r, s, attacker, "fear") && !((defOf(r, s, blocker)?.cost?.B ?? 0) > 0)) return false;
  if (hasKw(r, s, attacker, "skulk") && power(r, s, blocker) > power(r, s, attacker)) return false;
  return true;
}

// ---- attacking ------------------------------------------------------------

function decideAttackers(rules: Ruleset, state: GameState, me: PlayerId): Action {
  const candidates = attackCandidates(rules, state);
  const blockers = blockCandidates(rules, state);
  const oppLife = state.players[opponentOf(state, me)]?.life ?? 20;

  // Lethal check: assume each potential blocker stops the biggest remaining attacker.
  const sorted = [...candidates].sort((a, b) => power(rules, state, b) - power(rules, state, a));
  const unblocked = sorted.slice(blockers.length).reduce((sum, id) => sum + power(rules, state, id), 0);
  if (unblocked >= oppLife) return { type: "DECLARE_ATTACKERS", player: me, attackers: candidates };

  const attackers = candidates.filter((a) => {
    const possible = blockers.filter((b) => canBlock(rules, state, b, a));
    if (possible.length === 0) return true;
    // Attack if no blocker could kill it, or if killing it would cost them a better creature.
    return possible.every((b) => {
      const kills = power(rules, state, b) >= toughnessLeft(rules, state, a);
      const dies = power(rules, state, a) >= toughnessLeft(rules, state, b);
      return !kills || (dies && value(rules, state, b) >= value(rules, state, a));
    });
  });
  return { type: "DECLARE_ATTACKERS", player: me, attackers };
}

// ---- blocking -------------------------------------------------------------

function decideBlockers(rules: Ruleset, state: GameState, me: PlayerId): Action {
  const attackers = [...(state.combat?.attackers ?? [])].sort((a, b) => power(rules, state, b) - power(rules, state, a));
  const available = new Set(blockCandidates(rules, state));
  const blocks: BlockAssignment[] = [];
  const cheapest = (ids: CardId[]) => [...ids].sort((a, b) => value(rules, state, a) - value(rules, state, b))[0];

  const assign = (attacker: CardId, blocker: CardId) => {
    blocks.push({ blocker, attacker });
    available.delete(blocker);
  };

  for (const a of attackers) {
    const can = [...available].filter((b) => canBlock(rules, state, b, a));
    const kills = (b: CardId) => power(rules, state, b) >= toughnessLeft(rules, state, a);
    const survives = (b: CardId) => toughnessLeft(rules, state, b) > power(rules, state, a);

    const safe = cheapest(can.filter((b) => kills(b) && survives(b)));
    if (safe) {
      assign(a, safe);
      continue;
    }
    const trade = cheapest(can.filter((b) => kills(b) && value(rules, state, b) <= value(rules, state, a)));
    if (trade) assign(a, trade);
  }

  // If we'd still be in danger, chump block the biggest unblocked attackers.
  const life = state.players[me]?.life ?? 20;
  const blockedAttackers = new Set(blocks.map((b) => b.attacker));
  let incoming = attackers.filter((a) => !blockedAttackers.has(a)).reduce((s, a) => s + power(rules, state, a), 0);
  for (const a of attackers) {
    if (life - incoming > 3) break;
    if (blockedAttackers.has(a)) continue;
    const chump = cheapest([...available].filter((b) => canBlock(rules, state, b, a)));
    if (chump) {
      assign(a, chump);
      blockedAttackers.add(a);
      incoming -= power(rules, state, a);
    }
  }

  const action: Action = { type: "DECLARE_BLOCKERS", player: me, blocks };
  return validateAction(rules, state, action) === null ? action : { type: "DECLARE_BLOCKERS", player: me, blocks: [] };
}

// ---- discarding -------------------------------------------------------------

/** Discard the least valuable card in hand. */
function decideDiscard(rules: Ruleset, state: GameState, me: PlayerId): Action {
  const hand = state.players[me]?.hand ?? [];
  const worst = [...hand].sort((a, b) => value(rules, state, a) - value(rules, state, b))[0];
  return { type: "DISCARD", player: me, cardIds: worst ? [worst] : [] };
}

// ---- trigger targets -----------------------------------------------------------

/** Pick a target for one of our triggers: a lethal one if there is one, else anything that isn't ours. */
function decideTrigger(rules: Ruleset, state: GameState, me: PlayerId, legal: Action[]): Action {
  const effect = state.targeting?.effect;
  let best: { action: Action; score: number } | null = null;
  for (const a of legal) {
    if (a.type !== "CHOOSE_TARGET") continue;
    const t = a.target;
    const owner = t.kind === "player" ? t.id : state.cards[t.id]?.owner;
    let score = owner === me ? -100 : 0;
    if (t.kind === "card") score += value(rules, state, t.id);
    if (effect && t.kind === "card") score += Math.max(0, scoreAbility(rules, state, me, effect, t));
    if (!best || score > best.score) best = { action: a, score };
  }
  return best?.action ?? { type: "PASS", player: me };
}

// ---- library search ------------------------------------------------------------

/** Take the most valuable card the search allows. */
function decideSearch(rules: Ruleset, state: GameState, me: PlayerId, legal: Action[]): Action {
  let best: { action: Action; score: number } | null = null;
  for (const a of legal) {
    if (a.type !== "SEARCH" || a.cardId === null) continue;
    const score = value(rules, state, a.cardId);
    if (!best || score > best.score) best = { action: a, score };
  }
  return best?.action ?? { type: "SEARCH", player: me, cardId: null };
}

// ---- main phase -----------------------------------------------------------

function decideMain(rules: Ruleset, state: GameState, me: PlayerId, legal: Action[]): Action | null {
  // Activated abilities (e.g. a combat trick) are worth considering any time the AI has
  // priority, unlike casting sorcery-speed spells, which still waits for its own main phase.
  let bestActivation: { action: Action; score: number } | null = null;
  for (const a of legal) {
    if (a.type !== "ACTIVATE") continue;
    const inst = state.cards[a.cardId];
    const ability = rules.defs[inst?.defId ?? ""]?.abilities?.[a.abilityIndex];
    if (!ability) continue;
    const score = scoreAbility(rules, state, me, ability.effect, a.targets?.[0], a.x);
    if (score > 0 && (!bestActivation || score > bestActivation.score)) bestActivation = { action: a, score };
  }
  if (bestActivation) return bestActivation.action;

  const phase = rules.pack.phases[state.phaseIndex];
  const myMain = state.activePlayer === me && !!phase?.main && state.stack.length === 0;
  if (!myMain) return null; // never respond by casting; let the stack resolve

  const lands = legal.filter((a): a is Extract<Action, { type: "PLAY_LAND" }> => a.type === "PLAY_LAND");
  if (lands.length > 0) return bestLand(rules, state, me, lands);

  const opp = opponentOf(state, me);
  const oppLife = state.players[opp]?.life ?? 20;
  const myLife = state.players[me]?.life ?? 20;
  let best: { action: Action; score: number } | null = null;

  for (const a of legal) {
    if (a.type !== "CAST") continue;
    const def = defOf(rules, state, a.cardId);
    if (!def) continue;
    const score = scoreSpell(rules, state, me, opp, def, a, oppLife, myLife);
    if (score > 0 && (!best || score > best.score)) best = { action: a, score };
  }
  if (best) return best.action;

  // Nothing worth casting: spend spare mana on "lose life" abilities.
  return (
    legal.find((a) => {
      if (a.type !== "ACTIVATE") return false;
      const effect = defOf(rules, state, a.cardId)?.abilities?.[a.abilityIndex]?.effect;
      return effect?.kind === "lose_life" && effect.target === "opponent";
    }) ?? null
  );
}

function scoreSpell(
  rules: Ruleset,
  state: GameState,
  me: PlayerId,
  opp: PlayerId,
  def: CardDef,
  a: Extract<Action, { type: "CAST" }>,
  oppLife: number,
  myLife: number,
): number {
  const cost = manaValue(def.cost);
  if (def.types.includes("creature")) return 20 + cost * 3 + (def.power ?? 0) + (def.toughness ?? 0);

  const target = a.targets?.[0];
  // Damage/destroy decide whether a spell is worth casting at all; drawing and life gain are
  // bonuses on top, so a compound spell isn't judged by whichever clause happens to come last.
  let main = 0;
  let hasMain = false;
  let bonus = 0;
  let onlyLifeGain = true;
  for (const e of def.effects ?? []) {
    if (e.kind !== "gain_life") onlyLifeGain = false;
    switch (e.kind) {
      case "damage": {
        hasMain = true;
        if (e.target === "opponent") {
          main += e.amount >= oppLife ? 1000 : 4;
          break;
        }
        if (!target) return 0;
        if (target.kind === "player") {
          if (target.id === me) return -1;
          main += e.amount >= oppLife ? 1000 : 3; // face burn only as a low-priority fallback
        } else {
          if (state.cards[target.id]?.owner === me) return -1;
          if (e.amount < toughnessLeft(rules, state, target.id)) return -1; // wouldn't kill it
          main += 40 + value(rules, state, target.id) - cost * 3;
        }
        break;
      }
      case "destroy": {
        hasMain = true;
        if (!target || target.kind !== "card" || state.cards[target.id]?.owner === me) return -1;
        main += 45 + value(rules, state, target.id) - cost * 3;
        break;
      }
      case "draw":
        bonus += e.target === "self" ? 12 : -100;
        break;
      case "create_token":
        bonus += 8 * e.count; // bodies on the board; worth a card, less than removal
        break;
      case "gain_life":
        bonus += e.target === "self" ? (myLife <= 10 ? 15 : 2) : -100;
        break;
    }
  }
  if (!hasMain && onlyLifeGain && myLife > 10) return -1; // standalone life gain only when hurting
  return main + bonus;
}

/**
 * Knows two shapes: a negative "pump" (debuff) aimed at an opponent's creature, worth
 * using if it's lethal on its own (e.g. Rabid Rats' -1/-1 finishing off a blocker), and
 * "lose life" for the opponent when it's lethal. Anything else scores 0.
 */
function scoreAbility(
  rules: Ruleset,
  state: GameState,
  me: PlayerId,
  effect: Effect,
  target?: Target,
  x = 0,
): number {
  if (effect.kind === "damage_all") {
    const amount = effect.amount === "x" ? x : effect.amount;
    if (amount <= 0) return 0;
    const opp = opponentOf(state, me);
    const myLife = state.players[me]?.life ?? 20;
    const oppLife = state.players[opp]?.life ?? 20;
    if (myLife <= amount) return -1; // never kill ourselves
    if (oppLife <= amount) return 1000; // lethal
    // Otherwise only if the creatures we'd take out are worth more than the ones we'd lose.
    let net = 0;
    for (const pid of state.order) {
      for (const id of state.players[pid]?.battlefield ?? []) {
        if (!defOf(rules, state, id)?.types.includes("creature")) continue;
        if (toughnessLeft(rules, state, id) > amount) continue;
        net += pid === me ? -value(rules, state, id) : value(rules, state, id);
      }
    }
    return net > 10 ? net : 0;
  }
  if (effect.kind === "lose_life") {
    // Only worth interrupting everything else when it's lethal; otherwise decideMain spends spare mana on it.
    return effect.target === "opponent" && effect.amount >= (state.players[opponentOf(state, me)]?.life ?? 20) ? 1000 : 0;
  }
  if (effect.kind !== "pump" || effect.power > 0 || effect.toughness > 0) return 0;
  if (!target || target.kind !== "card") return 0;
  if (state.cards[target.id]?.owner === me) return -1; // never weaken our own creature
  if (toughnessLeft(rules, state, target.id) + effect.toughness > 0) return -1; // wouldn't kill it
  return 40 + value(rules, state, target.id);
}

/** Play the land whose colour the hand needs most and the battlefield has least of. */
function bestLand(
  rules: Ruleset,
  state: GameState,
  me: PlayerId,
  lands: Extract<Action, { type: "PLAY_LAND" }>[],
): Action {
  const p = state.players[me];
  const need: Record<string, number> = {};
  for (const id of p?.hand ?? []) {
    const cost = defOf(rules, state, id)?.cost;
    for (const c of ["W", "U", "B", "R", "G"] as const) need[c] = (need[c] ?? 0) + (cost?.[c] ?? 0);
  }
  const have: Record<string, number> = {};
  for (const id of p?.battlefield ?? []) {
    const c = defOf(rules, state, id)?.produces;
    if (c) have[c] = (have[c] ?? 0) + 1;
  }
  const score = (id: CardId) => {
    const c = defOf(rules, state, id)?.produces;
    return c ? (need[c] ?? 0) * 2 - (have[c] ?? 0) : -99;
  };
  return [...lands].sort((a, b) => score(b.cardId) - score(a.cardId))[0] as Action;
}
