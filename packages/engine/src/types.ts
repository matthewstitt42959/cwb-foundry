export type PlayerId = string;
export type CardId = string;
export type DefId = string;

export type Color = "W" | "U" | "B" | "R" | "G";
export const COLORS: readonly Color[] = ["W", "U", "B", "R", "G"];

/** Mana cost: coloured requirements plus a generic amount payable with anything. */
export interface ManaCost {
  generic?: number;
  W?: number;
  U?: number;
  B?: number;
  R?: number;
  G?: number;
}

/**
 * Declarative effects. Cards are data composed from these; adding a mechanic
 * means adding a variant here and a handler in effects.ts, not editing the turn loop.
 * Targeting is not modelled yet: "opponent" / "self" are fixed targets.
 */
export type PlayerTargetSpec = "opponent" | "self";
/** "any" = a player or a creature, chosen on cast; "creature" = a creature, chosen on cast. */
export type ChosenTargetSpec = "any" | "creature";

export type Effect =
  | { kind: "damage"; amount: number; target: PlayerTargetSpec | ChosenTargetSpec }
  | { kind: "draw"; amount: number; target: PlayerTargetSpec }
  | { kind: "gain_life"; amount: number; target: PlayerTargetSpec }
  | { kind: "destroy"; target: "creature" };

/** A target picked when a spell is cast. */
export type Target = { kind: "player"; id: PlayerId } | { kind: "card"; id: CardId };

export type CardType = "land" | "creature" | "instant" | "sorcery";

/**
 * Evergreen keywords the engine understands.
 * haste: may attack the turn it enters. flying: can only be blocked by flyers.
 * vigilance: attacking doesn't tap it.
 */
export type Keyword = "haste" | "flying" | "vigilance";

/** A card definition. `game` lets one engine host cards from different games. */
export interface CardDef {
  id: DefId;
  game: string;
  name: string;
  types: CardType[];
  cost?: ManaCost;
  /** Colour of mana produced when a land is tapped. */
  produces?: Color;
  power?: number;
  toughness?: number;
  keywords?: Keyword[];
  effects?: Effect[];
  /** Optional card image for UIs (e.g. from an importer). The engine never reads it. */
  imageUrl?: string;
}

export type CardDefs = Record<DefId, CardDef>;

export type PhaseHook =
  | "untap"
  | "draw"
  | "declare_attackers"
  | "declare_blockers"
  | "combat_damage"
  | "cleanup";

export interface PhaseDef {
  id: string;
  name: string;
  /** Do players receive priority in this phase? */
  hasPriority: boolean;
  /** Is this a "main" phase (sorceries and land drops allowed)? */
  main?: boolean;
  onEnter?: PhaseHook;
}

/** A rule pack configures the engine for one game's turn structure and setup. */
export interface RulePack {
  id: string;
  name: string;
  phases: PhaseDef[];
  startingLife: number;
  startingHandSize: number;
  landDropsPerTurn: number;
  /** If false, the first player skips their draw on turn 1. */
  drawOnFirstTurn: boolean;
}

export interface PlayerState {
  life: number;
  library: CardId[];
  hand: CardId[];
  battlefield: CardId[];
  graveyard: CardId[];
  landsPlayed: number;
  lost: boolean;
}

export interface CardInstance {
  id: CardId;
  defId: DefId;
  owner: PlayerId;
  tapped: boolean;
  /** Damage marked this turn; cleared in cleanup. */
  damage: number;
  /** Turn number on which it entered the battlefield (for summoning sickness). */
  enteredTurn: number;
}

export interface BlockAssignment {
  blocker: CardId;
  attacker: CardId;
}

export interface CombatState {
  attackers: CardId[];
  /** Order matters: an attacker assigns damage to its blockers in this order. */
  blocks: BlockAssignment[];
}

export interface StackItem {
  cardId: CardId;
  controller: PlayerId;
  /** Chosen targets (at most one for now). Empty for untargeted spells. */
  targets: Target[];
}

export interface GameState {
  packId: string;
  players: Record<PlayerId, PlayerState>;
  /** Turn order. */
  order: PlayerId[];
  cards: Record<CardId, CardInstance>;
  turn: number;
  activePlayer: PlayerId;
  phaseIndex: number;
  priority: PlayerId;
  /** Consecutive passes since the last action. */
  passes: number;
  stack: StackItem[];
  combat: CombatState | null;
  /** Set while a player must declare attackers or blockers before anyone gets priority. */
  pending: "attackers" | "blockers" | null;
  rngState: number;
  over: boolean;
  winner: PlayerId | null;
  log: string[];
}

export type Action =
  | { type: "PASS"; player: PlayerId }
  | { type: "PLAY_LAND"; player: PlayerId; cardId: CardId }
  | { type: "CAST"; player: PlayerId; cardId: CardId; targets?: Target[] }
  | { type: "DECLARE_ATTACKERS"; player: PlayerId; attackers: CardId[] }
  | { type: "DECLARE_BLOCKERS"; player: PlayerId; blocks: BlockAssignment[] };

export type ApplyResult =
  | { ok: true; state: GameState }
  | { ok: false; error: string };

export interface Ruleset {
  pack: RulePack;
  defs: CardDefs;
}
