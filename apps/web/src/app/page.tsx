import { createGame, getLegalActions, mtgPack, type CardDefs, type Ruleset } from "@cwb/engine";

// Placeholder data until the Scryfall importer exists. Not real card names.
const defs: CardDefs = {
  forest: { id: "forest", game: "demo", name: "Demo Forest", types: ["land"], produces: "G" },
  mountain: { id: "mountain", game: "demo", name: "Demo Mountain", types: ["land"], produces: "R" },
};
const rules: Ruleset = { pack: mtgPack, defs };
const deck = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? "forest" : "mountain"));

// Rendered on the server: the engine is pure, so this is a deterministic snapshot per seed.
export const dynamic = "force-static";

export default function Home() {
  const state = createGame(rules, { decks: { you: deck, opponent: deck }, seed: 42 });
  const phase = mtgPack.phases[state.phaseIndex];
  const legal = getLegalActions(rules, state);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
      <p style={{ letterSpacing: "0.3em", textTransform: "uppercase", fontSize: 12, opacity: 0.7 }}>
        Cards With Borders Foundry
      </p>
      <h1 style={{ fontWeight: 600 }}>Engine is wired up</h1>
      <p style={{ opacity: 0.8 }}>
        This page runs <code>@cwb/engine</code> on the server. The playable board comes next.
      </p>
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "8px 24px" }}>
        <dt>Rule pack</dt>
        <dd>{mtgPack.name}</dd>
        <dt>Turn / phase</dt>
        <dd>
          {state.turn} / {phase?.name}
        </dd>
        <dt>Active player</dt>
        <dd>{state.activePlayer}</dd>
        <dt>Your hand</dt>
        <dd>{state.players.you?.hand.length} cards</dd>
        <dt>Legal actions</dt>
        <dd>{legal.map((a) => a.type).join(", ") || "none"}</dd>
      </dl>
    </main>
  );
}
