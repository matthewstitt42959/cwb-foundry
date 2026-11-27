import type { RulePack } from "../types";

/**
 * MTG-style rule pack: 20 life, 7-card hands, one land drop, priority and a stack.
 * The combat steps are skipped automatically when nobody can attack.
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
    { id: "upkeep", name: "Upkeep", hasPriority: true, onEnter: "upkeep" },
    { id: "draw", name: "Draw", hasPriority: true, onEnter: "draw" },
    { id: "main1", name: "First main", hasPriority: true, main: true },
    { id: "attackers", name: "Declare attackers", hasPriority: true, onEnter: "declare_attackers" },
    { id: "blockers", name: "Declare blockers", hasPriority: true, onEnter: "declare_blockers" },
    { id: "damage", name: "Combat damage", hasPriority: true, onEnter: "combat_damage" },
    { id: "main2", name: "Second main", hasPriority: true, main: true },
    { id: "end", name: "End", hasPriority: true },
    { id: "cleanup", name: "Cleanup", hasPriority: false, onEnter: "cleanup" },
  ],
};
