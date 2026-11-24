import type { RulePack } from "../types";

/**
 * MTG-style rule pack: 20 life, 7-card hands, one land drop, priority and a stack.
 * Combat is declared as phases so the turn shape is right, but attacking and
 * blocking are not implemented yet (see README roadmap).
 */
export const mtgPack: RulePack = {
  id: "mtg",
  name: "Magic-style",
  startingLife: 20,
  startingHandSize: 7,
  landDropsPerTurn: 1,
  drawOnFirstTurn: false,
  phases: [
    { id: "untap", name: "Untap", hasPriority: false, onEnter: "untap" },
    { id: "upkeep", name: "Upkeep", hasPriority: true },
    { id: "draw", name: "Draw", hasPriority: true, onEnter: "draw" },
    { id: "main1", name: "First main", hasPriority: true, main: true },
    { id: "combat", name: "Combat", hasPriority: true },
    { id: "main2", name: "Second main", hasPriority: true, main: true },
    { id: "end", name: "End", hasPriority: true },
  ],
};
