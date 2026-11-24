import {
  applyAction,
  clone,
  createGame,
  mtgPack,
  type CardDefs,
  type CardId,
  type GameState,
  type PlayerId,
  type Ruleset,
} from "../src";

/** Generic test fixtures; deliberately not real card names. */
export const defs: CardDefs = {
  forest: { id: "forest", game: "test", name: "Test Forest", types: ["land"], produces: "G" },
  mountain: { id: "mountain", game: "test", name: "Test Mountain", types: ["land"], produces: "R" },
  bear: {
    id: "bear",
    game: "test",
    name: "Test Bear",
    types: ["creature"],
    cost: { generic: 1, G: 1 },
    power: 2,
    toughness: 2,
  },
  bolt: {
    id: "bolt",
    game: "test",
    name: "Test Bolt",
    types: ["instant"],
    cost: { R: 1 },
    effects: [{ kind: "damage", amount: 3, target: "opponent" }],
  },
  tonic: {
    id: "tonic",
    game: "test",
    name: "Test Tonic",
    types: ["instant"],
    cost: { generic: 1 },
    effects: [{ kind: "gain_life", amount: 3, target: "self" }],
  },
  study: {
    id: "study",
    game: "test",
    name: "Test Study",
    types: ["sorcery"],
    cost: { generic: 1 },
    effects: [{ kind: "draw", amount: 2, target: "self" }],
  },
};

export const rules: Ruleset = { pack: mtgPack, defs };

export function deck(size = 30): string[] {
  return Array.from({ length: size }, (_, i) => (i % 2 === 0 ? "forest" : "mountain"));
}

export function newGame(seed = 1, size = 30): GameState {
  return createGame(rules, { decks: { p1: deck(size), p2: deck(size) }, seed });
}

/** Pass priority until the given phase begins (any player's turn). */
export function passUntilPhase(state: GameState, phaseId: string, maxSteps = 100): GameState {
  let s = state;
  for (let i = 0; i < maxSteps; i++) {
    if (rules.pack.phases[s.phaseIndex]?.id === phaseId) return s;
    const r = applyAction(rules, s, { type: "PASS", player: s.priority });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    if (s.over) return s;
  }
  throw new Error(`Never reached phase ${phaseId}`);
}

let counter = 0;

/** Test helper: inject a fresh card into a player's zone. Returns the new state and card id. */
export function give(
  state: GameState,
  player: PlayerId,
  defId: string,
  zone: "hand" | "battlefield",
): { state: GameState; id: CardId } {
  const s = clone(state);
  const id = `${player}:t${counter++}`;
  s.cards[id] = { id, defId, owner: player, tapped: false };
  s.players[player]?.[zone].push(id);
  return { state: s, id };
}
