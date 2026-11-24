# cwb-foundry

An open-source, React-based card gaming platform designed to break the boundaries between trading card games, allowing players to build mixed decks, introduce guest cards to play with your deck.

## Layout

```
packages/engine   pure TypeScript rules engine: no UI, no I/O, deterministic
apps/web          Next.js app (currently a shell that runs the engine)
```

The engine takes a **rule pack** (turn structure, starting life, land drops) and **card definitions** (data, not code) and exposes three functions: `createGame`, `getLegalActions`, `applyAction`. State is plain JSON and `applyAction` never mutates its input, so games are replayable and testable. Randomness comes from a seed stored in the state.

## Commands

```bash
npm install
npm test            # vitest, engine unit tests
npm run typecheck   # engine + web
npm run dev         # Next.js dev server on :3000
npm run build
```

## What works today

- Two-player games with seeded shuffles and opening hands
- Turn and phase structure from the rule pack (MTG-style: untap through end)
- Priority passing and a stack: responses resolve last-in, first-out
- Land drops, coloured and generic mana payment, sorcery-speed vs. instant-speed timing
- Declarative effects: `damage`, `draw`, `gain_life`
- Win conditions: life reaching 0, drawing from an empty library

## Not built yet (roadmap)

1. Combat: attacking, blocking, damage. The phase exists but does nothing.
2. Targeting: effects currently use fixed `opponent` / `self` targets.
3. Cleanup step (discard to hand size) and more than two players.
4. Scryfall importer and a card definition format richer than the current one.
5. Playable board UI and a basic AI opponent.
6. Deck builder, then a card editor for custom cards.
7. A second rule pack, to validate that the engine really is game-agnostic.

The engine is only partly game-agnostic so far: the stack and priority are built in, with the rule pack configuring turn structure and setup. Making reaction windows configurable is part of step 7.

## Card data

Test fixtures use invented names on purpose. Real card names, text and art belong to their publishers; the importer will pull data from public APIs at runtime rather than bundling it.
