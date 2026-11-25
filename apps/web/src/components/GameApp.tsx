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
/**
 * Cached entries are `convertScryfallCard` *results*, not raw Scryfall data. Bump this
 * version whenever the importer's support changes (new keywords, effects, etc.),
 * otherwise cards already cached as "unsupported" stay that way forever, even after
 * the engine learns to run them.
 */
const CACHE_KEY = "cwb:scryfall-cache:v2";
const MIN_IMPORT_CARDS = 10;

/** A decklist saved via the `/api/decks` route (backed by the SavedDeck table). */
interface SavedDecklist {
  id: string;
  name: string;
  text: string;
}

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

  const [savedDecks, setSavedDecks] = useState<SavedDecklist[]>([]);
  const [saveName, setSaveName] = useState("");
  const [savingDeck, setSavingDeck] = useState(false);
  const [savedDecksError, setSavedDecksError] = useState("");

  useEffect(() => {
    cache.current = loadCache();
  }, []);

  useEffect(() => {
    fetch("/api/decks")
      .then((r) => (r.ok ? (r.json() as Promise<SavedDecklist[]>) : Promise.reject(new Error("Failed to load"))))
      .then(setSavedDecks)
      .catch(() => setSavedDecksError("Couldn't load saved decks"));
  }, []);

  const saveCurrentDeck = async () => {
    const name = saveName.trim();
    if (!name || !importText.trim()) return;
    setSavingDeck(true);
    setSavedDecksError("");
    try {
      const res = await fetch("/api/decks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, text: importText }),
      });
      if (!res.ok) throw new Error("Save failed");
      const deck = (await res.json()) as SavedDecklist;
      setSavedDecks((cur) => [...cur, deck]);
      setSaveName("");
    } catch {
      setSavedDecksError("Couldn't save this deck");
    } finally {
      setSavingDeck(false);
    }
  };

  const deleteSavedDeck = async (id: string) => {
    const removed = savedDecks.find((d) => d.id === id);
    setSavedDecks((cur) => cur.filter((d) => d.id !== id)); // optimistic
    try {
      const res = await fetch(`/api/decks/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    } catch {
      setSavedDecksError("Couldn't delete that deck");
      if (removed) setSavedDecks((cur) => [...cur, removed]); // restore on failure
    }
  };

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
    <main className="mx-auto max-w-[760px] px-6 py-12">
      <p className="text-xs uppercase tracking-[0.3em] text-[var(--dim)]">Cards With Borders Foundry</p>
      <h1>Play against the AI</h1>
      <p className="dim">Pick a deck for each side, or import a real decklist below. Every game uses a fresh random seed.</p>

      <div className="my-6 grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
        {starterDecks.map((d) => (
          <section
            key={d.id}
            className="rounded-[10px] border border-[var(--line)] bg-[var(--panel)] px-[18px] pt-1 pb-[14px]"
          >
            <h2>{d.name}</h2>
            <p>{d.blurb}</p>
            <details>
              <summary>Decklist</summary>
              <ul className="text-[0.9rem]">
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

      <section
        className="mt-2 mb-6 rounded-[10px] border border-[var(--line)] bg-[var(--panel)] px-[18px] pt-1 pb-[18px]"
        aria-label="Import a deck from Scryfall"
      >
        <h2>Import a deck from Scryfall</h2>
        <p className="dim">
          Paste a decklist (<code>4 Lightning Bolt</code>, Arena and MTGO exports work). Cards are looked up on Scryfall
          from your browser. Anything the engine can&apos;t run exactly yet is skipped and listed with the reason, never
          quietly changed.
        </p>
        <textarea
          className="w-full resize-y rounded-md border border-[var(--line)] bg-[var(--panel-2)] p-[10px] font-mono text-[0.9rem] text-[var(--text)]"
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={10}
          spellCheck={false}
          placeholder={"4 Lightning Bolt\n20 Mountain\n..."}
          aria-label="Decklist"
        />
        <div className="my-[10px] flex flex-wrap gap-[10px]">
          <button type="button" className="btn primary" onClick={runImport} disabled={importing || !importText.trim()}>
            {importing ? `Importing… ${progress}` : "Import"}
          </button>
          <input
            className="rounded-md border border-[var(--line)] bg-[var(--panel-2)] px-[10px] py-2 text-[var(--text)]"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="Name this list to save it"
            aria-label="Name for saving this decklist"
          />
          <button
            type="button"
            className="btn"
            onClick={saveCurrentDeck}
            disabled={savingDeck || !saveName.trim() || !importText.trim()}
          >
            {savingDeck ? "Saving…" : "Save"}
          </button>
        </div>
        {savedDecks.length > 0 && (
          <div className="mb-[10px] flex flex-wrap gap-[10px]">
            {savedDecks.map((d) => (
              <span key={d.id} className="flex items-center gap-1">
                <button type="button" className="btn" onClick={() => setImportText(d.text)} disabled={importing}>
                  Load &quot;{d.name}&quot;
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => deleteSavedDeck(d.id)}
                  aria-label={`Delete saved deck "${d.name}"`}
                  title="Delete"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        {savedDecksError && <p className="error">{savedDecksError}</p>}
        {importError && <p className="error">{importError}</p>}

        {imported && (
          <div aria-live="polite">
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
            <ul className="mt-2 list-none pl-0 text-[0.88rem]">
              {imported.rows.map((r) => (
                <li key={r.name} className="flex gap-2 border-b border-[#1d1d25] py-[3px]">
                  <span
                    className={`w-[1.2em] text-center ${r.status === "ok" ? "text-[var(--good)]" : "text-[#ff7a7a]"}`}
                  >
                    {r.status === "ok" ? "✓" : "✕"}
                  </span>
                  <span>
                    {r.count}× {r.name}
                    {r.reasons.length > 0 && <span className="dim"> — {r.reasons.join("; ")}</span>}
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

      <div className="mb-6 flex flex-wrap gap-6">
        <label className="grid gap-1.5 text-[0.85rem] text-[var(--dim)]">
          Your deck
          <select
            className="rounded-md border border-[var(--line)] bg-[var(--panel-2)] px-[10px] py-2 text-[var(--text)]"
            value={yourDeck}
            onChange={(e) => setYourDeck(e.target.value)}
          >
            {deckOptions}
          </select>
        </label>
        <label className="grid gap-1.5 text-[0.85rem] text-[var(--dim)]">
          Opponent&apos;s deck
          <select
            className="rounded-md border border-[var(--line)] bg-[var(--panel-2)] px-[10px] py-2 text-[var(--text)]"
            value={theirDeck}
            onChange={(e) => setTheirDeck(e.target.value)}
          >
            {deckOptions}
          </select>
        </label>
      </div>

      <button type="button" className="btn primary big" onClick={() => start(yourDeck, theirDeck)}>
        Start game
      </button>

      <p className="dim mt-8 text-xs">
        Imported card data and images are provided by Scryfall. Magic: The Gathering and its card names and art are
        property of Wizards of the Coast; this is an unofficial fan project.
      </p>
    </main>
  );
}
