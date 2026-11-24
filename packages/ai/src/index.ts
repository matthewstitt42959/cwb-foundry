import {
  attackCandidates,
  blockCandidates,
  getLegalActions,
  validateAction,
  type Action,
  type BlockAssignment,
  type CardDef,
  type CardId,
  type GameState,
  type ManaCost,
  type PlayerId,
  type Ruleset,
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

function canBlock(r: Ruleset, s: GameState, blocker: CardId, attacker: CardId): boolean {
  return !isFlyer(r, s, attacker) || isFlyer(r, s, blocker);
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

// ---- main phase -----------------------------------------------------------

function decideMain(rules: Ruleset, state: GameState, me: PlayerId, legal: Action[]): Action | null {
  const phase = rules.pack.phases[state.phaseIndex];
  const myMain = state.activePlayer === me && !!phase?.main && state.stack.length === 0;
  if (!myMain) return null; // never respond; let the stack resolve

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
  return best?.action ?? null;
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
  let score = 0;
  for (const e of def.effects ?? []) {
    switch (e.kind) {
      case "damage": {
        if (e.target === "opponent") return e.amount >= oppLife ? 1000 : 4;
        if (!target) return 0;
        if (target.kind === "player") {
          if (target.id === me) return -1;
          score = e.amount >= oppLife ? 1000 : 3; // face burn only as a low-priority fallback
        } else {
          const owner = state.cards[target.id]?.owner;
          if (owner === me) return -1;
          score = e.amount >= toughnessLeft(rules, state, target.id) ? 40 + value(rules, state, target.id) - cost * 3 : -1;
        }
        break;
      }
      case "destroy": {
        if (!target || target.kind !== "card" || state.cards[target.id]?.owner === me) return -1;
        score = 45 + value(rules, state, target.id) - cost * 3;
        break;
      }
      case "draw":
        score = e.target === "self" ? 12 : -1;
        break;
      case "gain_life":
        score = e.target === "self" && myLife <= 10 ? 15 : -1;
        break;
    }
  }
  return score;
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
