"use client";

import { useState } from "react";
import { applyAction, createGame, type Action, type GameState } from "@cwb/engine";
import { starterDecks, starterDefs } from "@cwb/cards";
import { autoplay, BOT, HUMAN, rules } from "../lib/driver";
import { Board } from "./Board";

interface Session {
  state: GameState;
  /** Bumped on every engine step; used as the Board's key so UI selections never outlive their state. */
  version: number;
  seed: number;
  yourDeck: string;
  theirDeck: string;
}

function deckCards(id: string): string[] {
  return starterDecks.find((d) => d.id === id)?.cards ?? [];
}

export function GameApp() {
  const [yourDeck, setYourDeck] = useState(starterDecks[0]?.id ?? "");
  const [theirDeck, setTheirDeck] = useState(starterDecks[1]?.id ?? "");
  const [stopEverywhere, setStopEverywhere] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  const start = (mine: string, theirs: string) => {
    const seed = Math.floor(Math.random() * 2 ** 31);
    const initial = createGame(rules, {
      decks: { [HUMAN]: deckCards(mine), [BOT]: deckCards(theirs) },
      seed,
    });
    setSession({
      state: autoplay(initial, { stopEverywhere }),
      version: 0,
      seed,
      yourDeck: mine,
      theirDeck: theirs,
    });
  };

  const onAction = (action: Action) => {
    setSession((cur) => {
      if (!cur) return cur;
      const r = applyAction(rules, cur.state, action);
      if (!r.ok) return cur;
      return { ...cur, version: cur.version + 1, state: autoplay(r.state, { stopEverywhere }) };
    });
  };

  if (!session) {
    return (
      <main className="menu">
        <p className="eyebrow">Cards With Borders Foundry</p>
        <h1>Play against the AI</h1>
        <p className="dim">Pick a deck for each side. Every game uses a fresh random seed.</p>

        <div className="decks">
          {starterDecks.map((d) => (
            <section key={d.id} className="deck">
              <h2>{d.name}</h2>
              <p>{d.blurb}</p>
              <details>
                <summary>Decklist</summary>
                <ul>
                  {Object.entries(
                    d.cards.reduce<Record<string, number>>((acc, id) => {
                      acc[id] = (acc[id] ?? 0) + 1;
                      return acc;
                    }, {}),
                  ).map(([id, n]) => (
                    <li key={id}>
                      {n}× {starterDefs[id]?.name ?? id}
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          ))}
        </div>

        <div className="pickers">
          <label>
            Your deck
            <select value={yourDeck} onChange={(e) => setYourDeck(e.target.value)}>
              {starterDecks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Opponent&apos;s deck
            <select value={theirDeck} onChange={(e) => setTheirDeck(e.target.value)}>
              {starterDecks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button type="button" className="btn primary big" onClick={() => start(yourDeck, theirDeck)}>
          Start game
        </button>
      </main>
    );
  }

  return (
    <Board
      key={session.version}
      state={session.state}
      seed={session.seed}
      stopEverywhere={stopEverywhere}
      onToggleStops={() => setStopEverywhere((v) => !v)}
      onAction={onAction}
      onNewGame={() => setSession(null)}
    />
  );
}
