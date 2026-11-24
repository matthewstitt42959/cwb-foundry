"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  attackCandidates,
  blockCandidates,
  getLegalActions,
  legalTargets,
  targetSpecOf,
  validateAction,
  type Action,
  type BlockAssignment,
  type CardId,
  type GameState,
  type PlayerId,
  type Target,
} from "@cwb/engine";
import { BOT, HUMAN, rules } from "../lib/driver";
import { CardView } from "./CardView";

interface BoardProps {
  state: GameState;
  seed: number;
  stopEverywhere: boolean;
  onToggleStops: () => void;
  onAction: (action: Action) => void;
  onNewGame: () => void;
}

const label = (id: PlayerId) => (id === HUMAN ? "You" : "Opponent");

export function Board({ state, seed, stopEverywhere, onToggleStops, onAction, onNewGame }: BoardProps) {
  const [notice, setNotice] = useState<string>("");
  const [aiming, setAiming] = useState<CardId | null>(null); // spell waiting for a target
  const [attackSel, setAttackSel] = useState<CardId[]>([]);
  const [blocks, setBlocks] = useState<BlockAssignment[]>([]);
  const [blockSel, setBlockSel] = useState<CardId | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // In-progress choices (aiming, selections) live in this component's state. GameApp
  // remounts the Board on every engine step (key={version}), so they reset with no stale frame.
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [state.log.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAiming(null);
        setBlockSel(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const me = state.players[HUMAN];
  const opp = state.players[BOT];
  const phase = rules.pack.phases[state.phaseIndex];
  const myDecision = !state.over && state.priority === HUMAN;
  const legal = useMemo(() => (myDecision ? getLegalActions(rules, state) : []), [state, myDecision]);

  const defOf = (id: CardId) => {
    const inst = state.cards[id];
    return inst ? rules.defs[inst.defId] : undefined;
  };

  const act = (action: Action) => {
    const err = validateAction(rules, state, action);
    if (err) {
      setNotice(err);
      return;
    }
    setNotice("");
    onAction(action);
  };

  const aimingDef = aiming ? defOf(aiming) : undefined;
  const targets: Target[] = useMemo(
    () => (aimingDef ? legalTargets(rules, state, aimingDef) : []),
    [aimingDef, state],
  );
  const isTarget = (t: Target) => targets.some((x) => x.kind === t.kind && x.id === t.id);

  const pickTarget = (t: Target) => {
    if (!aiming || !isTarget(t)) return;
    act({ type: "CAST", player: HUMAN, cardId: aiming, targets: [t] });
  };

  // ---- hand -----------------------------------------------------------
  const playable = (id: CardId) =>
    legal.some((a) => (a.type === "PLAY_LAND" || a.type === "CAST") && a.cardId === id);

  const clickHand = (id: CardId) => {
    const def = defOf(id);
    if (!def || state.pending) return;
    if (def.types.includes("land")) return act({ type: "PLAY_LAND", player: HUMAN, cardId: id });
    if (targetSpecOf(def)) {
      if (playable(id)) {
        setNotice("");
        setAiming(aiming === id ? null : id);
        return;
      }
      const first = legalTargets(rules, state, def)[0];
      return setNotice(
        first
          ? (validateAction(rules, state, { type: "CAST", player: HUMAN, cardId: id, targets: [first] }) ?? "")
          : "No legal targets",
      );
    }
    act({ type: "CAST", player: HUMAN, cardId: id });
  };

  // ---- combat declarations ---------------------------------------------
  const attackers = state.pending === "attackers" && myDecision ? attackCandidates(rules, state) : [];
  const blockers = state.pending === "blockers" && myDecision ? blockCandidates(rules, state) : [];
  const incoming = state.combat?.attackers ?? [];

  const clickMyCreature = (id: CardId) => {
    if (aiming) return pickTarget({ kind: "card", id });
    if (attackers.includes(id)) {
      setAttackSel((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
    } else if (blockers.includes(id)) {
      if (blocks.some((b) => b.blocker === id)) setBlocks((bs) => bs.filter((b) => b.blocker !== id));
      else setBlockSel(blockSel === id ? null : id);
    }
  };

  const clickTheirCreature = (id: CardId) => {
    if (aiming) return pickTarget({ kind: "card", id });
    if (blockSel && incoming.includes(id)) {
      const next = [...blocks, { blocker: blockSel, attacker: id }];
      const err = validateAction(rules, state, { type: "DECLARE_BLOCKERS", player: HUMAN, blocks: next });
      if (err) return setNotice(err);
      setNotice("");
      setBlocks(next);
      setBlockSel(null);
    }
  };

  // ---- rendering helpers -------------------------------------------------
  const zone = (pid: PlayerId) => {
    const p = state.players[pid];
    const ids = p?.battlefield ?? [];
    const creatures = ids.filter((id) => defOf(id)?.types.includes("creature"));
    const lands = ids.filter((id) => !defOf(id)?.types.includes("creature"));
    return { creatures, lands };
  };

  const badgeFor = (id: CardId): string | undefined => {
    if (incoming.includes(id)) return "Attacking";
    const b = [...(state.combat?.blocks ?? []), ...blocks].find((x) => x.blocker === id);
    if (b) return `Blocks ${defOf(b.attacker)?.name ?? ""}`;
    return undefined;
  };

  const renderCreature = (id: CardId, mine: boolean) => {
    const def = defOf(id);
    const inst = state.cards[id];
    if (!def) return null;
    const asTarget = aiming ? isTarget({ kind: "card", id }) : false;
    const active =
      asTarget ||
      (mine && (attackers.includes(id) || (blockers.includes(id) && !blocks.some((b) => b.blocker === id)))) ||
      (!mine && !!blockSel && incoming.includes(id));
    return (
      <CardView
        key={id}
        def={def}
        inst={inst}
        selected={attackSel.includes(id) || blockSel === id}
        active={active}
        targetable={asTarget}
        badge={badgeFor(id)}
        onClick={
          mine
            ? () => clickMyCreature(id)
            : aiming || blockSel
              ? () => clickTheirCreature(id)
              : undefined
        }
      />
    );
  };

  const renderLands = (ids: CardId[]) =>
    ids.map((id) => {
      const def = defOf(id);
      return def ? <CardView key={id} def={def} inst={state.cards[id]} mini /> : null;
    });

  const playerBar = (pid: PlayerId) => {
    const p = state.players[pid];
    if (!p) return null;
    const targetable = aiming ? isTarget({ kind: "player", id: pid }) : false;
    return (
      <button
        type="button"
        className={`player-bar ${targetable ? "targetable active" : ""} ${state.activePlayer === pid ? "turn" : ""}`}
        onClick={targetable ? () => pickTarget({ kind: "player", id: pid }) : undefined}
        disabled={!targetable}
      >
        <span className="who">{label(pid)}</span>
        <span className="life">{p.life}</span>
        <span className="meta">
          hand {p.hand.length} · library {p.library.length} · graveyard {p.graveyard.length}
        </span>
      </button>
    );
  };

  const theirs = zone(BOT);
  const mine = zone(HUMAN);

  const stackText = (i: number) => {
    const item = state.stack[i];
    if (!item) return "";
    const def = defOf(item.cardId);
    const t = item.targets[0];
    const tn = t ? (t.kind === "player" ? label(t.id) : (defOf(t.id)?.name ?? "?")) : "";
    return `${def?.name ?? "?"} (${label(item.controller)})${tn ? ` → ${tn}` : ""}`;
  };

  const winnerText =
    state.winner === HUMAN ? "You win!" : state.winner === BOT ? "You lose." : "Draw.";

  return (
    <div className="game">
      <header className="topbar">
        <strong>Cards With Borders Foundry</strong>
        <span className="dim">seed {seed}</span>
        <label className="toggle">
          <input type="checkbox" checked={stopEverywhere} onChange={onToggleStops} /> stop at every step
        </label>
        <button type="button" className="btn" onClick={onNewGame}>
          New game
        </button>
      </header>

      <div className="layout">
        <main className="board">
          {playerBar(BOT)}
          <div className="row creatures">{theirs.creatures.map((id) => renderCreature(id, false))}</div>
          <div className="row lands">{renderLands(theirs.lands)}</div>

          <div className="middle">
            <ol className="phases">
              {rules.pack.phases
                .filter((p) => p.id !== "untap" && p.id !== "cleanup")
                .map((p) => (
                  <li key={p.id} className={p.id === phase?.id ? "now" : ""}>
                    {p.name}
                  </li>
                ))}
            </ol>
            <div className="turn-line">
              Turn {state.turn} · {label(state.activePlayer)}
              {state.stack.length > 0 && <span className="stack-flag"> · stack: {state.stack.length}</span>}
            </div>
            {state.stack.length > 0 && (
              <ul className="stack">
                {[...state.stack].reverse().map((_, i) => (
                  <li key={i}>{stackText(state.stack.length - 1 - i)}</li>
                ))}
              </ul>
            )}

            <div className="controls">
              {aiming && (
                <>
                  <span>Choose a target for {aimingDef?.name}</span>
                  <button type="button" className="btn" onClick={() => setAiming(null)}>
                    Cancel
                  </button>
                </>
              )}
              {!aiming && state.pending === "attackers" && myDecision && (
                <>
                  <span>Declare attackers: click your creatures</span>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => act({ type: "DECLARE_ATTACKERS", player: HUMAN, attackers: attackSel })}
                  >
                    {attackSel.length ? `Attack with ${attackSel.length}` : "No attack"}
                  </button>
                  {attackers.length > 1 && (
                    <button type="button" className="btn" onClick={() => setAttackSel(attackers)}>
                      Select all
                    </button>
                  )}
                </>
              )}
              {!aiming && state.pending === "blockers" && myDecision && (
                <>
                  <span>Declare blockers: click your creature, then an attacker</span>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => act({ type: "DECLARE_BLOCKERS", player: HUMAN, blocks })}
                  >
                    {blocks.length ? `Confirm ${blocks.length} block${blocks.length > 1 ? "s" : ""}` : "No blocks"}
                  </button>
                </>
              )}
              {!aiming && !state.pending && myDecision && (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => act({ type: "PASS", player: HUMAN })}
                >
                  {state.stack.length ? "Pass (resolve)" : `Pass priority (${phase?.name})`}
                </button>
              )}
            </div>
            {notice && <div className="notice">{notice}</div>}
          </div>

          <div className="row creatures">{mine.creatures.map((id) => renderCreature(id, true))}</div>
          <div className="row lands">{renderLands(mine.lands)}</div>
          {playerBar(HUMAN)}

          <div className="hand" aria-label="Your hand">
            {(me?.hand ?? []).map((id) => {
              const def = defOf(id);
              return def ? (
                <CardView
                  key={id}
                  def={def}
                  inst={state.cards[id]}
                  active={playable(id) && !state.pending}
                  selected={aiming === id}
                  onClick={() => clickHand(id)}
                />
              ) : null;
            })}
          </div>
        </main>

        <aside className="log" ref={logRef} aria-label="Game log">
          {state.log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </aside>
      </div>

      {state.over && (
        <div className="overlay">
          <div className="dialog">
            <h2>{winnerText}</h2>
            <p className="dim">
              You {me?.life} · Opponent {opp?.life} · turn {state.turn}
            </p>
            <button type="button" className="btn primary" onClick={onNewGame}>
              Play again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
