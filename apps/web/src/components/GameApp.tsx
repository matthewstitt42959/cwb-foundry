"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

/**
 * There is no login here: this recognizes the same account pbandj already issued.
 * pbandj hands its current token to this app via a URL fragment (never sent to a
 * server, never logged) when a logged-in user clicks through from its Hub; this app
 * just stores it and sends it back as a bearer token on save/delete.
 */
const TOKEN_KEY = "cwb-foundry-token";
const PBANDJ_URL = "https://playbyjayrpg.com/";

interface AuthUser {
  userId: string;
  username: string;
}

/** Reads a JWT's claims without verifying the signature — display only. The API
 * routes verify the real signature server-side; this just drives the UI. */
function decodeToken(token: string): AuthUser | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as { userId?: unknown; username?: unknown; exp?: unknown };
    if (typeof claims.userId !== "string" || typeof claims.username !== "string") return null;
    if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) return null; // expired
    return { userId: claims.userId, username: claims.username };
  } catch {
    return null;
  }
}

/** A decklist saved via the `/api/decks` route (backed by the SavedDeck table). */
interface SavedDecklist {
  id: string;
  name: string;
  text: string;
  folder?: string | null;
  public?: boolean;
  userId?: string | null;
  ownerName?: string | null;
}

const UNSORTED = "Unsorted";

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
  const [saveFolder, setSaveFolder] = useState("");
  const [savePublic, setSavePublic] = useState(false);
  const [savingDeck, setSavingDeck] = useState(false);
  const [savedDecksError, setSavedDecksError] = useState("");
  const [folderDrafts, setFolderDrafts] = useState<Record<string, string>>({});
  /** Set while editing an existing saved deck in place, instead of saving a new one. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [me, setMe] = useState<AuthUser | null>(null);
  const token = useRef<string | null>(null);

  useEffect(() => {
    cache.current = loadCache();
  }, []);

  useEffect(() => {
    // One-time handoff from pbandj: #token=... in the URL, never sent to any server.
    const hash = window.location.hash;
    const match = hash.startsWith("#") ? new URLSearchParams(hash.slice(1)).get("token") : null;
    const stored = match ?? window.localStorage.getItem(TOKEN_KEY);
    if (match) {
      try {
        window.localStorage.setItem(TOKEN_KEY, match);
      } catch {
        /* private mode or full storage: still usable for this session via the ref */
      }
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    if (stored) {
      const claims = decodeToken(stored);
      if (claims) {
        token.current = stored;
        setMe(claims);
      } else {
        window.localStorage.removeItem(TOKEN_KEY);
      }
    }
  }, []);

  useEffect(() => {
    // Runs after the token-handoff effect above, so token.current is already set
    // if this visitor is logged in — include it so their own private decks show up
    // alongside public ones, not just public decks.
    fetch("/api/decks", {
      headers: token.current ? { Authorization: `Bearer ${token.current}` } : undefined,
    })
      .then((r) => (r.ok ? (r.json() as Promise<SavedDecklist[]>) : Promise.reject(new Error("Failed to load"))))
      .then(setSavedDecks)
      .catch(() => setSavedDecksError("Couldn't load saved decks"));
  }, []);

  const signOut = () => {
    token.current = null;
    setMe(null);
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  };

  const saveCurrentDeck = async () => {
    const name = saveName.trim();
    if (!name || !importText.trim() || !token.current) return;
    setSavingDeck(true);
    setSavedDecksError("");
    try {
      const res = editingId
        ? await fetch(`/api/decks/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.current}` },
            body: JSON.stringify({ name, text: importText }),
          })
        : await fetch("/api/decks", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.current}` },
            body: JSON.stringify({ name, text: importText, folder: saveFolder.trim(), public: savePublic }),
          });
      if (res.status === 401) {
        signOut();
        throw new Error("Your login expired — log in again via Play by Jay");
      }
      if (!res.ok) throw new Error(editingId ? "Update failed" : "Save failed");
      const deck = (await res.json()) as SavedDecklist;
      setSavedDecks((cur) => (editingId ? cur.map((d) => (d.id === deck.id ? deck : d)) : [...cur, deck]));
      setSaveName("");
      setSaveFolder("");
      setSavePublic(false);
      setEditingId(null);
    } catch (e) {
      setSavedDecksError(e instanceof Error ? e.message : "Couldn't save this deck");
    } finally {
      setSavingDeck(false);
    }
  };

  const startEditingDeck = (d: SavedDecklist) => {
    setEditingId(d.id);
    setSaveName(d.name);
    setImportText(d.text);
    setSavedDecksError("");
  };

  const cancelEditingDeck = () => {
    setEditingId(null);
    setSaveName("");
  };

  const toggleDeckPublic = async (d: SavedDecklist) => {
    if (!token.current) return;
    const next = !d.public;
    setSavedDecks((cur) => cur.map((x) => (x.id === d.id ? { ...x, public: next } : x))); // optimistic
    try {
      const res = await fetch(`/api/decks/${d.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.current}` },
        body: JSON.stringify({ public: next }),
      });
      if (res.status === 401) signOut();
      if (!res.ok) throw new Error("Couldn't change visibility");
    } catch {
      setSavedDecksError("Couldn't change that deck's visibility");
      setSavedDecks((cur) => cur.map((x) => (x.id === d.id ? { ...x, public: d.public } : x))); // restore
    }
  };

  const deleteSavedDeck = async (id: string) => {
    if (!token.current) return;
    const removed = savedDecks.find((d) => d.id === id);
    setSavedDecks((cur) => cur.filter((d) => d.id !== id)); // optimistic
    try {
      const res = await fetch(`/api/decks/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token.current}` },
      });
      if (res.status === 401) signOut();
      if (!res.ok) throw new Error("Delete failed");
    } catch {
      setSavedDecksError("Couldn't delete that deck");
      if (removed) setSavedDecks((cur) => [...cur, removed]); // restore on failure
    }
  };

  const moveDeckFolder = async (id: string, folder: string) => {
    if (!token.current) return;
    const prior = savedDecks.find((d) => d.id === id)?.folder ?? "";
    const next = folder.trim();
    if (next === (prior ?? "")) return;
    setSavedDecks((cur) => cur.map((d) => (d.id === id ? { ...d, folder: next || null } : d))); // optimistic
    try {
      const res = await fetch(`/api/decks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.current}` },
        body: JSON.stringify({ folder: next }),
      });
      if (res.status === 401) signOut();
      if (!res.ok) throw new Error("Move failed");
    } catch {
      setSavedDecksError("Couldn't move that deck");
      setSavedDecks((cur) => cur.map((d) => (d.id === id ? { ...d, folder: prior } : d))); // restore on failure
    }
  };

  // Every distinct folder name in use, for the "move to folder" suggestions.
  const folderNames = useMemo(
    () => [...new Set(savedDecks.map((d) => d.folder?.trim()).filter((f): f is string => !!f))].sort(),
    [savedDecks],
  );

  // Saved decks grouped by folder, alphabetical, with ungrouped decks last.
  const groupedDecks = useMemo(() => {
    const groups = new Map<string, SavedDecklist[]>();
    for (const d of savedDecks) {
      const key = d.folder?.trim() || UNSORTED;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(d);
    }
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === UNSORTED) return 1;
      if (b === UNSORTED) return -1;
      return a.localeCompare(b);
    });
  }, [savedDecks]);

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
    <main className="mx-auto max-w-[1040px] px-6 py-12">
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

      <div className="mt-2 mb-6 grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_300px]">
      <section
        className="rounded-[10px] border border-[var(--line)] bg-[var(--panel)] px-[18px] pt-1 pb-[18px]"
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
        <div className="my-[10px] flex flex-wrap items-center gap-[10px]">
          <button type="button" className="btn primary" onClick={runImport} disabled={importing || !importText.trim()}>
            {importing ? `Importing… ${progress}` : "Import"}
          </button>
          {me ? (
            <>
              <input
                className="rounded-md border border-[var(--line)] bg-[var(--panel-2)] px-[10px] py-2 text-[var(--text)]"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Name this list to save it"
                aria-label="Name for saving this decklist"
              />
              {!editingId && (
                <>
                  <input
                    list="cwb-folder-names"
                    className="rounded-md border border-[var(--line)] bg-[var(--panel-2)] px-[10px] py-2 text-[var(--text)]"
                    value={saveFolder}
                    onChange={(e) => setSaveFolder(e.target.value)}
                    placeholder="Folder (optional)"
                    aria-label="Folder to save this decklist into"
                  />
                  <label className="flex items-center gap-1.5 text-[0.85rem] dim">
                    <input
                      type="checkbox"
                      checked={savePublic}
                      onChange={(e) => setSavePublic(e.target.checked)}
                    />
                    Make public
                  </label>
                </>
              )}
              <button
                type="button"
                className="btn"
                onClick={saveCurrentDeck}
                disabled={savingDeck || !saveName.trim() || !importText.trim()}
              >
                {savingDeck ? (editingId ? "Updating…" : "Saving…") : editingId ? "Update" : "Save"}
              </button>
              {editingId && (
                <button type="button" className="btn" onClick={cancelEditingDeck}>
                  Cancel edit
                </button>
              )}
              <span className="text-[0.8rem] dim">Signed in as {me.username}</span>
            </>
          ) : (
            <span className="rounded-md border border-[var(--warn)] bg-[var(--warn)]/10 px-3 py-1.5 text-[0.85rem] font-medium text-[var(--warn)]">
              <a href={PBANDJ_URL} className="font-semibold underline">
                Log in via Play by Jay
              </a>{" "}
              to save your own decks.
            </span>
          )}
        </div>
        {folderNames.length > 0 && (
          <datalist id="cwb-folder-names">
            {folderNames.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
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

      <aside
        className="rounded-[10px] border border-[var(--line)] bg-[var(--panel)] px-[18px] pt-2 pb-[18px]"
        aria-label="Your saved decks"
      >
        <h2 className="text-[1rem]">Saved decks</h2>
        {savedDecks.length === 0 ? (
          <p className="text-[0.85rem] dim">None yet — save a decklist from the import panel.</p>
        ) : (
          <div className="mt-2 flex max-h-[520px] flex-col gap-[14px] overflow-y-auto">
            {groupedDecks.map(([folder, decks]) => (
              <div key={folder}>
                <p className="mb-1 text-[0.7rem] uppercase tracking-[0.1em] dim">{folder}</p>
                <div className="flex flex-col gap-1.5">
                  {decks.map((d) => {
                    const owned = !!me && d.userId === me.userId;
                    const draft = folderDrafts[d.id] ?? d.folder ?? "";
                    return (
                      <div
                        key={d.id}
                        className="rounded-md border border-[var(--line)] bg-[var(--panel-2)] p-2"
                      >
                        <button
                          type="button"
                          className="text-left text-[0.85rem] hover:underline disabled:opacity-50"
                          onClick={() => setImportText(d.text)}
                          disabled={importing}
                        >
                          {d.name}
                          {d.ownerName && <span className="dim"> · {d.ownerName}</span>}
                          {owned && <span className="dim"> ({d.public ? "public" : "private"})</span>}
                        </button>
                        {owned && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            <input
                              list="cwb-folder-names"
                              className="w-0 min-w-[80px] flex-1 rounded-md border border-[var(--line)] bg-[var(--bg)] px-[6px] py-1 text-[0.75rem] text-[var(--text)]"
                              value={draft}
                              onChange={(e) => setFolderDrafts((cur) => ({ ...cur, [d.id]: e.target.value }))}
                              placeholder="Unsorted"
                              aria-label={`Folder for "${d.name}"`}
                            />
                            <button
                              type="button"
                              className="btn"
                              onClick={() => moveDeckFolder(d.id, draft)}
                              disabled={draft.trim() === (d.folder?.trim() ?? "")}
                              title="Move to this folder"
                            >
                              Move
                            </button>
                            <button
                              type="button"
                              className="btn"
                              onClick={() => startEditingDeck(d)}
                              title="Edit name and decklist"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn"
                              onClick={() => toggleDeckPublic(d)}
                              title={d.public ? "Make private" : "Make public"}
                            >
                              {d.public ? "Make private" : "Make public"}
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
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>
      </div>

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
