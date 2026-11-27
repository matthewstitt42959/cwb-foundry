# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

Cards With Borders Foundry (`cwb-foundry`): an open-source, React/Next.js card game where the rules live in a pure TypeScript engine and cards are data. It currently plays an MTG-style game, one human vs. a heuristic AI, in the browser. The long-term goal is a game-agnostic engine: other rule packs, mixed decks, user-made cards. MIT licensed.

## Commands

```bash
npm install
npm run dev                      # Next.js dev server, http://localhost:3000
npm run build                    # production build of the web app
npm test                         # vitest, all packages
npx vitest run packages/engine/test/combat.test.ts   # one file
SCRYFALL_LIVE=1 npm test         # also runs the opt-in test against the real Scryfall API
npm run typecheck                # tsc for every package, plus the web app
```

Run `npm test` and `npm run typecheck` before committing. Both must pass.

## Layout

```
packages/engine   pure rules engine. No UI, no I/O, no Node/DOM types.
packages/cards    starter cards + decks, rules-text generator, Scryfall importer
packages/ai       heuristic opponent
apps/web          Next.js 15 / React 19 app (deck picker, import panel, board)
```

Workspace packages ship as TypeScript source (`main: src/index.ts`); `apps/web/next.config.mjs` lists them in `transpilePackages`. Add any new workspace package there too.

## Engine rules (`packages/engine`)

- **Pure and deterministic.** `applyAction(rules, state, action)` returns `{ ok, state }` or `{ ok: false, error }` and never mutates its input. Randomness comes from a seed stored in `GameState` (`rng.ts`). Same seed + same actions = same game. Keep it that way.
- **State is plain JSON.** `clone()` is a JSON round trip on purpose (no `structuredClone`, so no DOM/Node typings are needed). Don't put functions, Maps or Sets in `GameState`.
- **One source of truth for legality.** `validateAction` decides what's legal; `getLegalActions` enumerates candidates and filters through it. Add new rules in `validateAction`, not in the UI or AI.
- **Rule packs** (`rulepacks/mtg.ts`) configure turn structure and setup. Phases carry an `onEnter` hook handled in `enterPhase` in `engine.ts`. The stack and priority are still built in, not configurable. Making reaction windows pluggable is needed before a second game.
- **Cards are data.** `CardDef` plus declarative `Effect`s (`damage`, `draw`, `gain_life`, `destroy`, `discard`, `pump`, `lose_life`, `damage_all`, `search_library`, `create_token`). To add a mechanic: add an `Effect` variant in `types.ts`, handle it in `effects.ts` (`applyEffect`, with the `never` exhaustiveness check), then teach `cards` (`cardText`) and the importer's `parseClause` about it. Effects that need a player's decision (`discard`, `search_library`) are not applied in `applyEffect`: `resolveTop` starts a pending decision via `beginChoice` instead, at every resolution site (creature enter, spell, ability).
- **Abilities and triggers.** `CardDef.abilities` are activated (`ACTIVATE`); costs are `tap`, `mana` and `x` (optionally colour-restricted), merged into one mana payment. `CardDef.triggers` fire on `dies`, `attacks` or `upkeep`: `queueTriggers` records them, `flushTriggers` (end of every `applyAction`) puts them on the stack, pausing on a `target` decision only when there is a real choice.
- **Tokens, subtypes, computed power.** Token defs (`token: true`) must be in `rules.defs`; the importer returns them in `ConvertResult.tokens` and `importDecklist` merges them. A token that dies is removed, not sent to the graveyard. `subtypes` come from the type line; `colors` is only for cards with no mana cost; `powerFrom` counts a subtype. Always read stats through `effectivePower` / `effectiveToughness`, never `def.power`.
- **Combat and declarations.** Attackers and blockers are declared with `DECLARE_ATTACKERS` / `DECLARE_BLOCKERS`. While `state.pending` is set, only that declaration is legal. Combat steps are skipped when nobody can attack. During a declaration `getLegalActions` returns only the empty declaration, single choices and "all attack"; use `attackCandidates` / `blockCandidates` for arbitrary combinations.
- **Targeting.** `any` / `creature` targets are chosen on cast and stored on the stack item. Spells fizzle if the target is gone on resolution.
- Keywords: haste, flying, vigilance, deathtouch, fear (black only; artifact creatures aren't modelled), menace, skulk, can't block, lifelink (combat damage only), first strike, trample.
- **Reclaim / concede.** `CONCEDE` and `RECLAIM_GRAVEYARD` ignore priority. Reclaim (empty library: shuffle the graveyard back in) is a player option the human takes for either side; the AI never chooses it.
- Not implemented yet: double strike, player-chosen damage order, discard to hand size, more than two players, counters, auras, sacrifice/discard/life costs, static abilities ("all Rats have fear"), copy effects, buyback, computed toughness, artifacts and enchantments.

## Scryfall importer (`packages/cards/src/scryfall`)

- **Rule: never run a card wrongly.** `convertScryfallCard` returns a `CardDef` only if the engine can run the card exactly; otherwise `def: null` plus human-readable reasons, which the UI shows. Do not "approximate" unsupported text. (One documented exception: "target player" damage maps to "opponent", since this is a two-player game with no planeswalkers.)
- To support more cards, extend `parseClause` / `SUPPORTED_KEYWORDS` in `convert.ts` and add a test using a real card from `packages/cards/test/fixtures/scryfall-collection.json` (trimmed real API responses; add cards there by re-fetching, don't hand-write them).
- The client batches 75 names per request, waits 100 ms between requests and retries 429s. Scryfall's API terms ask for that; keep it. The web app calls Scryfall directly from the browser (CORS is open), so no server proxy.
- Card data and images belong to Scryfall / Wizards of the Coast. Keep the attribution on the menu page. Don't bundle card images or full card databases in the repo.
- Test fixtures for the engine and starter set use invented names (Test Bolt, Briar Cub...). The importer tests are the only place real card names appear, because reading real card data is their job.

## Web app (`apps/web`)

- `lib/driver.ts` runs the AI between the player's decisions (`autoplay`) and auto-passes steps where the player has nothing to do. `makeRules(extraDefs)` builds the rules for a game from starter + imported cards.
- `GameApp` remounts `Board` on every engine step (`key={version}`). That is deliberate: UI selections (aiming, attackers, blockers) live in `Board` state and must never outlive the engine state they refer to. Don't "optimize" it away with an effect that resets state; that caused a one-frame stale render.
- Everything runs client-side. Imported-card conversions are cached in `localStorage` (`cwb:scryfall-cache:v3`; bump it whenever the importer learns something new, or stale "unsupported" results stick around).

## AI (`packages/ai`)

`chooseAction(rules, state)` always returns a legal action (it falls back to the first legal action). It never responds on the player's turn. The tests play whole games AI-vs-AI across many seeds and fail on any illegal action, so run them after touching the engine, the AI or the card set.

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess` on. Prefer narrowing over `!`/`as`.
- Tests live next to each package in `test/`. New engine behaviour needs a test; for rules, include the failing case (what's rejected and the exact error).
- Commit messages: imperative summary line, then a short bullet body.
