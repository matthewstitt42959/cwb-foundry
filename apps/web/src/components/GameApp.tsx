"use client";

import { useEffect, useRef, useState } from "react";
import { applyAction, createGame, type Action, type CardDefs, type GameState, type Ruleset } from "@cwb/engine";
import {
  importDecklist,
  starterDecks,
  starterDefs,
  type ConvertResult,
  type ImportCache,
  type ImportedDeck,
} from "@cwb/cards";
import { autoplay, BOT, HUMAN, makeRules } from "../lib/driver";
import { Board } from "./Board";

interface Session {
  rules: Ruleset;
  state: GameState;
  /** Bumped on every engine step; used as the Board's key so UI selections never outlive their state. */
  version: number;
  seed: number;
}

const IMPORTED = "imported";
const CACHE_KEY = "cwb:scryfall-cache:v1";
const MIN_IMPORT_CARDS = 10;

const EXAMPLE_LIST = `4 Lightning Bolt
3 Shock
2 Lava Axe
3 Lightning Helix
6 Grizzly Bears
3 Hill Giant
2 Serra Angel
6 Mountain
6 Forest
5 Plains
2 Doom Blade
2 Llanowar Elves`;

function loadCache(): ImportCache {
  const cache: ImportCache = new Map();
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (raw) for (const [k, v] of JSON.parse(raw) as [string, ConvertResult][]) cache.set(k, v);
  } catch {
    /* storage unavailable or corrupt: start empty */
  }
  return cache;
}

function saveCache(cache: ImportCache): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify([...cache.entries()]));
  } catch {
    /* quota or private mode: the cache is only an optimisation */
  }
}

function countBy(ids: string[]): [string, number][] {
  const acc: Record<string, number> = {};
  for (const id of ids) acc[id] = (acc[id] ?? 0) + 1;
  return Object.entries(acc);
}

export function GameApp() {
  const [yourDeck, setYourDeck] = useState(starterDecks[0]?.id ?? "");
  const [theirDeck, setTheirDeck] = useState(starterDecks[1]?.id ?? "");
  const [stopEverywhere, setStopEverywhere] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState("");
  const [importError, setImportError] = useState("");
  const [imported, setImported] = useState<ImportedDeck | null>(null);
  const cache = useRef<ImportCache>(new Map());

  useEffect(() => {
    cache.current = loadCache();
  }, []);

  const importedUsable = !!imported && imported.playableCount >= MIN_IMPORT_CARDS;
  const defsFor = (): CardDefs => imported?.defs ?? {};

  const deckCards = (id: string): string[] =>
    id === IMPORTED ? (imported?.cards ?? []) : (starterDecks.find((d) => d.id === id)?.cards ?? []);

  const start = (mine: string, theirs: string) => {
    const rules = makeRules(defsFor());
    const seed = Math.floor(Math.random() * 2 ** 31);
    const initial = createGame(rules, {
      decks: { [HUMAN]: deckCards(mine), [BOT]: deckCards(theirs) },
      seed,
    });
    setSession({ rules, state: autoplay(rules, initial, { stopEverywhere }), version: 0, seed });
  };

  const onAction = (action: Action) => {
    setSession((cur) => {
      if (!cur) return cur;
      const r = applyAction(cur.rules, cur.state, action);
      if (!r.ok) return cur;
      return { ...cur, version: cur.version + 1, state: autoplay(cur.rules, r.state, { stopEverywhere }) };
    });
  };

  const runImport = async () => {
    setImporting(true);
    setImportError("");
    setProgress("");
    try {
      const deck = await importDecklist(importText, {
        fetch: (url, init) => window.fetch(url, init),
        cache: cache.current,
        onProgress: (done, total) => setProgress(`${done}/${total}`),
      });
      saveCache(cache.current);
      setImported(deck);
      if (deck.playableCount >= MIN_IMPORT_CARDS) setYourDeck(IMPORTED);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  if (session) {
    return (
      <Board
        key={session.version}
        rules={session.rules}
        state={session.state}
        seed={session.seed}
        stopEverywhere={stopEverywhere}
        onToggleStops={() => setStopEverywhere((v) => !v)}
        onAction={onAction}
        onNewGame={() => setSession(null)}
      />
    );
  }

  const deckOptions = (
    <>
      {starterDecks.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
      {importedUsable && <option value={IMPORTED}>Imported deck ({imported?.playableCount} cards)</option>}
    </>
  );

  const hasLands = !!imported?.cards.some((id) => imported.defs[id]?.types.includes("land"));

  return (
    <main className="menu">
      <p className="eyebrow">Cards With Borders Foundry</p>
      <h1>Play against the AI</h1>
      <p className="dim">Pick a deck for each side, or import a real decklist below. Every game uses a fresh random seed.</p>

      <div className="decks">
        {starterDecks.map((d) => (
          <section key={d.id} className="deck">
            <h2>{d.name}</h2>
            <p>{d.blurb}</p>
            <details>
              <summary>Decklist</summary>
              <ul>
                {countBy(d.cards).map(([id, n]) => (
                  <li key={id}>
                    {n}× {starterDefs[id]?.name ?? id}
                  </li>
                ))}
              </ul>
            </details>
          </section>
        ))}
      </div>

      <section className="import" aria-label="Import a deck from Scryfall">
        <h2>Import a deck from Scryfall</h2>
        <p className="dim">
          Paste a decklist (<code>4 Lightning Bolt</code>, Arena and MTGO exports work). Cards are looked up on Scryfall
          from your browser. Anything the engine can&apos;t run exactly yet is skipped and listed with the reason, never
          quietly changed.
        </p>
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={10}
          spellCheck={false}
          placeholder={"4 Lightning Bolt\n20 Mountain\n..."}
          aria-label="Decklist"
        />
        <div className="import-actions">
          <button type="button" className="btn primary" onClick={runImport} disabled={importing || !importText.trim()}>
            {importing ? `Importing… ${progress}` : "Import"}
          </button>
          <button type="button" className="btn" onClick={() => setImportText(EXAMPLE_LIST)} disabled={importing}>
            Load an example
          </button>
        </div>
        {importError && <p className="error">{importError}</p>}

        {imported && (
          <div className="report" aria-live="polite">
            <p>
              <strong>
                {imported.playableCount} playable
                {imported.skippedCount > 0 ? `, ${imported.skippedCount} skipped` : ""}
              </strong>
              {imported.playableCount < MIN_IMPORT_CARDS && (
                <span className="error"> · need at least {MIN_IMPORT_CARDS} playable cards to start a game</span>
              )}
            </p>
            {importedUsable && imported.playableCount < 40 && (
              <p className="warn">Fewer than 40 playable cards: you may run out of library sooner.</p>
            )}
            {importedUsable && !hasLands && <p className="warn">No lands in the playable cards: you won&apos;t be able to cast anything.</p>}
            <ul className="rows">
              {imported.rows.map((r) => (
                <li key={r.name} className={r.status}>
                  <span className="mark">{r.status === "ok" ? "✓" : "✕"}</span>
                  <span>
                    {r.count}× {r.name}
                    {r.reasons.length > 0 && <span className="reason"> — {r.reasons.join("; ")}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {imported.skippedLines.length > 0 && (
              <p className="warn">Couldn&apos;t read: {imported.skippedLines.join(" · ")}</p>
            )}
          </div>
        )}
      </section>

      <div className="pickers">
        <label>
          Your deck
          <select value={yourDeck} onChange={(e) => setYourDeck(e.target.value)}>
            {deckOptions}
          </select>
        </label>
        <label>
          Opponent&apos;s deck
          <select value={theirDeck} onChange={(e) => setTheirDeck(e.target.value)}>
            {deckOptions}
          </select>
        </label>
      </div>

      <button type="button" className="btn primary big" onClick={() => start(yourDeck, theirDeck)}>
        Start game
      </button>

      <p className="credit dim">
        Imported card data and images are provided by Scryfall. Magic: The Gathering and its card names and art are
        property of Wizards of the Coast; this is an unofficial fan project.
      </p>
    </main>
  );
}
