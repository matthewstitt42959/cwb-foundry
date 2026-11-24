import { describe, expect, it } from "vitest";
import { cardText, starterDecks, starterDefs } from "../src";

describe("starter set", () => {
  it("has exactly 40 cards per deck and only defined cards", () => {
    for (const deck of starterDecks) {
      expect(deck.cards).toHaveLength(40);
      for (const id of deck.cards) expect(starterDefs[id], `${deck.id}: ${id}`).toBeDefined();
    }
  });

  it("is internally consistent", () => {
    for (const [key, def] of Object.entries(starterDefs)) {
      expect(def.id).toBe(key);
      if (def.types.includes("land")) expect(def.produces).toBeDefined();
      if (def.types.includes("creature")) {
        expect(def.power).toBeGreaterThanOrEqual(0);
        expect(def.toughness).toBeGreaterThan(0);
      }
      if (!def.types.includes("land")) expect(def.cost, `${key} needs a cost`).toBeDefined();
    }
  });

  it("every deck colour has lands to cast its spells", () => {
    for (const deck of starterDecks) {
      const produced = new Set(
        deck.cards.map((id) => starterDefs[id]?.produces).filter((c): c is NonNullable<typeof c> => !!c),
      );
      for (const id of deck.cards) {
        const cost = starterDefs[id]?.cost ?? {};
        for (const color of ["W", "U", "B", "R", "G"] as const) {
          if ((cost[color] ?? 0) > 0) expect(produced.has(color), `${deck.id}: ${id} needs ${color}`).toBe(true);
        }
      }
    }
  });

  it("generates rules text", () => {
    expect(cardText(starterDefs.spark!)).toBe("Deal 2 damage to any target.");
    expect(cardText(starterDefs.smite!)).toBe("Destroy target creature.");
    expect(cardText(starterDefs.cloud_drifter!)).toBe("Flying");
  });
});
