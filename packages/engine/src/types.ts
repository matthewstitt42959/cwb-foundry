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
/**
 * "any" = a player or a creature, chosen on cast; "creature" = a creature, chosen on
 * cast; "blocking_creature" = a creature currently declared as a blocker in the
 * active combat (any attacker's), chosen on cast/activation.
 */
export type ChosenTargetSpec = "any" | "creature" | "blocking_creature";

export type Effect =
  | { kind: "damage"; amount: number; target: PlayerTargetSpec | ChosenTargetSpec }
  | { kind: "draw"; amount: number; target: PlayerTargetSpec }
  | { kind: "gain_life"; amount: number; target: PlayerTargetSpec }
  | { kind: "destroy"; target: "creature" }
  | { kind: "discard"; amount: number; target: PlayerTargetSpec }
  | { kind: "lose_life"; amount: number; target: PlayerTargetSpec }
  /** Damage to every creature and every player (the controller's side included). "x" reads the ability's X. */
  | { kind: "damage_all"; amount: number | "x" }
  /** "You may search your library for a <subtype> card, reveal it, put it into your hand, then shuffle." */
  | { kind: "search_library"; subtype: string }
  | { kind: "pump"; power: number; toughness: number; target: ChosenTargetSpec; duration: "until_end_of_turn" };

/** A target picked when a spell is cast. */
export type Target = { kind: "player"; id: PlayerId } | { kind: "card"; id: CardId };

export type CardType = "land" | "creature" | "instant" | "sorcery";

/**
 * What an activated ability costs: "tap" the source and/or pay mana. More kinds
 * (sacrifice, discard, life) slot in here later without touching anything that
 * already works. `Ability.cost` is an array since real costs combine several.
 */
export type Cost =
  | { kind: "tap" }
  | { kind: "mana"; cost: ManaCost }
  /** Pay X mana, chosen on activation; `only` restricts it to one colour ("spend only black mana on X"). */
  | { kind: "x"; only?: Color };

export interface Ability {
  cost: Cost[];
  effect: Effect;
}

/** Events a triggered ability can listen for on its own creature. */
export type TriggerEvent = "dies" | "attacks" | "upkeep";

/** "When this dies, ..." / "Whenever this attacks, ...": goes on the stack when the event happens. */
export interface Trigger {
  on: TriggerEvent;
  effect: Effect;
}

/** A trigger that has fired but isn't on the stack yet (it may still need a target chosen). */
export interface PendingTrigger {
  sourceId: CardId;
  controller: PlayerId;
  effect: Effect;
}

/**
 * Evergreen keywords the engine understands.
 * haste: may attack the turn it enters. flying: can only be blocked by flyers.
 * vigilance: attacking doesn't tap it. deathtouch: any damage it deals is lethal.
 * fear: can only be blocked by black creatures (artifact creatures aren't modelled).
 * menace: can't be blocked except by two or more creatures.
 * skulk: can't be blocked by creatures with greater power.
 * cant_block: this creature can't block.
 * lifelink: combat damage it deals also gains its controller that much life.
 * first_strike: deals combat damage before creatures without it.
 * trample: lethal damage to its blockers, the rest goes to the defending player.
 */
export type Keyword =
  | "haste"
  | "flying"
  | "vigilance"
  | "deathtouch"
  | "fear"
  | "menace"
  | "skulk"
  | "cant_block"
  | "lifelink"
  | "first_strike"
  | "trample";

/** A card definition. `game` lets one engine host cards from different games. */
export interface CardDef {
  id: DefId;
  game: string;
  name: string;
  types: CardType[];
  /** Lowercase subtypes from the type line after the dash ("rat", "ogre", "swamp"...). */
  subtypes?: string[];
  cost?: ManaCost;
  /** Colour of mana produced when a land is tapped. */
  produces?: Color;
  power?: number;
  toughness?: number;
  keywords?: Keyword[];
  effects?: Effect[];
  abilities?: Ability[];
  triggers?: Trigger[];
  /** Optional card image for UIs (e.g. from an importer). The engine never reads it. */
  imageUrl?: string;
}

export type CardDefs = Record<DefId, CardDef>;

export type PhaseHook =
  | "untap"
  | "upkeep"
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
  /** Marked when any damage this turn came from a deathtouch source; cleared in cleanup. */
  deathtouch?: boolean;
  /** Temporary stat deltas from effects like "pump" (e.g. -1/-1); cleared in cleanup. */
  tempPower?: number;
  tempToughness?: number;
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

/**
 * Something waiting to resolve. A "spell" is a cast card (as before); an "ability"
 * is an activated ability's single effect, identified by its source permanent
 * rather than a card being cast. Both resolve the same way once popped.
 */
export type StackItem =
  | { kind: "spell"; cardId: CardId; controller: PlayerId; targets: Target[] }
  | { kind: "ability"; sourceId: CardId; controller: PlayerId; effect: Effect; targets: Target[]; x?: number };

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
  /** Set while a player must declare attackers/blockers, choose a card to discard, or pick a trigger's target. */
  pending: "attackers" | "blockers" | "discard" | "target" | "search" | null;
  /** Triggers that have fired and are waiting to go on the stack, in order. */
  triggers: PendingTrigger[];
  /** Set while `pending` is "search": who is searching their library, and for which subtype. */
  search: { player: PlayerId; subtype: string } | null;
  /** Set while `pending` is "target": whose trigger needs a target, and what it does. */
  targeting: { player: PlayerId; sourceId: CardId; effect: Effect } | null;
  /** Set while `pending` is "discard": who must discard, and how many cards. */
  discard: { player: PlayerId; count: number } | null;
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
  | { type: "DECLARE_BLOCKERS"; player: PlayerId; blocks: BlockAssignment[] }
  | { type: "DISCARD"; player: PlayerId; cardIds: CardId[] }
  | { type: "ACTIVATE"; player: PlayerId; cardId: CardId; abilityIndex: number; targets?: Target[]; x?: number }
  | { type: "CHOOSE_TARGET"; player: PlayerId; target: Target }
  /** Resolves a library search: the chosen card, or null to decline. */
  | { type: "SEARCH"; player: PlayerId; cardId: CardId | null }
  | { type: "CONCEDE"; player: PlayerId }
  | { type: "RECLAIM_GRAVEYARD"; player: PlayerId };

export type ApplyResult =
  | { ok: true; state: GameState }
  | { ok: false; error: string };

export interface Ruleset {
  pack: RulePack;
  defs: CardDefs;
}
