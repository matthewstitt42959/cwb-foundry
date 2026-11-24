# cwb-foundry

An open-source, React-based card gaming platform designed to break the boundaries between trading card games, allowing players to build mixed decks, introduce guest cards to play with your deck.

## Play it

```bash
npm install
npm run dev     # then open http://localhost:3000
```

Pick a deck for each side and play against the AI in your browser. Click a land or spell in your hand to play it. Spells with targets (burn, removal) enter an aiming mode: click a creature or a player's life total, or press Esc to cancel. When it's time to attack or block you'll be prompted: click your creatures to select attackers, or click one of your creatures and then an attacker to block it. "Stop at every step" in the top bar gives you priority at every step instead of skipping steps where nothing is happening.

## Import a real decklist (Scryfall)

On the menu, paste a decklist (`4 Lightning Bolt`; Arena, MTGO and Moxfield exports work, and everything from a `Sideboard` line on is ignored) and press Import. Cards are looked up on [Scryfall](https://scryfall.com/docs/api) from your browser (batched 75 per request, 100 ms apart, rate limits retried) and converted into engine cards, with art shown where available. Lookups are cached in `localStorage`, so re-importing makes no requests.

The importer's rule is **never run a card wrongly**. A card is imported only if the engine can run it *exactly*; otherwise it is skipped and listed with the reason, for example:

- `Doom Blade`: "Destroy target nonblack creature" (the engine can't enforce the restriction yet)
- `Llanowar Elves`: mana abilities on creatures aren't supported
- `Brazen Borrower`, `Delver of Secrets`: multi-faced and adventure cards
- `Fireball`: `{X}` costs. Also hybrid, Phyrexian and colourless mana, `*` power/toughness, non-basic lands that make several colours, artifacts, enchantments and planeswalkers.

Supported: basic and single-colour lands, creatures with only flying/haste/vigilance, and instants/sorceries built from damage (any target / creature / opponent), destroy target creature, gain life and draw. That already covers a lot of burn, vanilla creatures and simple removal.

```bash
SCRYFALL_LIVE=1 npm test    # also runs the opt-in test against the real API
```

Card data and images come from Scryfall; Magic: The Gathering and its card names and art are property of Wizards of the Coast. This is an unofficial fan project.

## Layout

```
packages/engine   pure TypeScript rules engine: no UI, no I/O, deterministic
packages/cards    starter card set, two 40-card decks, rules-text generator, Scryfall importer
packages/ai       heuristic opponent: reads state, returns a legal action
apps/web          Next.js app: deck picker and playable board
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
- Declarative effects: `damage`, `draw`, `gain_life`, `destroy`
- Targeting: `any` (player or creature) and `creature` targets are chosen on cast; spells fizzle if their target is gone when they resolve
- Win conditions: life reaching 0, drawing from an empty library
- Combat: declare attackers, declare blockers, simultaneous combat damage
  - Declarations are their own actions (`DECLARE_ATTACKERS`, `DECLARE_BLOCKERS`); passing is illegal until they're made
  - Summoning sickness, tapped creatures, damage that wears off at cleanup, creatures dying to lethal damage
  - Several blockers on one attacker: lethal damage assigned in declaration order, excess to the last
  - Keywords: `haste`, `flying`, `vigilance`
  - Combat is skipped when nobody can attack

`getLegalActions` lists the empty declaration, each single choice and "everything attacks" during a declaration. For other combinations use `attackCandidates` / `blockCandidates` and build the action yourself.

## Not built yet (roadmap)

1. More combat: first strike, trample, menace, player-chosen damage assignment order.
2. Multiple targets, "target player" only, auras/equipment, counters, activated and triggered abilities.
3. Discard to hand size at cleanup, and more than two players.
4. Wider importer coverage: more keywords (trample, first strike, reach...), triggered and activated abilities, modal and X spells, multi-faced cards, creature mana abilities.
5. Deck builder (search Scryfall, save decks), then a card editor for custom cards.
6. A smarter AI (it never responds on your turn, and doesn't hold burn or bluff).
7. A second rule pack, to validate that the engine really is game-agnostic.
8. Saving games, and online multiplayer.

The engine is only partly game-agnostic so far: the stack and priority are built in, with the rule pack configuring turn structure and setup. Making reaction windows configurable is part of step 7.

## Card data

Test fixtures use invented names on purpose. Real card names, text and art belong to their publishers; the importer will pull data from public APIs at runtime rather than bundling it.
