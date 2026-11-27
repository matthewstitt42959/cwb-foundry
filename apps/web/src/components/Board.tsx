"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  attackCandidates,
  blockCandidates,
  getLegalActions,
  legalTargets,
  targetSpecOf,
  validateAction,
  validateBlocks,
  type Action,
  type BlockAssignment,
  type CardId,
  type GameState,
  type PlayerId,
  type Ruleset,
  type Target,
} from "@cwb/engine";
import { BOT, HUMAN } from "../lib/driver";
import { CardView } from "./CardView";

interface BoardProps {
  rules: Ruleset;
  state: GameState;
  seed: number;
  stopEverywhere: boolean;
  onToggleStops: () => void;
  onAction: (action: Action) => void;
  onNewGame: () => void;
}

const label = (id: PlayerId) => (id === HUMAN ? "You" : "Opponent");

export function Board({ rules, state, seed, stopEverywhere, onToggleStops, onAction, onNewGame }: BoardProps) {
  const [notice, setNotice] = useState<string>("");
  const [aiming, setAiming] = useState<CardId | null>(null); // spell waiting for a target
  const [xChoice, setXChoice] = useState<Extract<Action, { type: "ACTIVATE" }>[] | null>(null); // affordable X values for an ability
  const [activating, setActivating] = useState<{ cardId: CardId; abilityIndex: number } | null>(null); // ability waiting for a target
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
        setActivating(null);
        setXChoice(null);
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
  const triggerPick = state.pending === "target" && myDecision; // choosing a target for a trigger
  const picking = aiming !== null || activating !== null || triggerPick; // choosing a target for a spell, ability or trigger
  const activations = useMemo(
    () => legal.filter((a): a is Extract<Action, { type: "ACTIVATE" }> => a.type === "ACTIVATE"),
    [legal],
  );
  const targets: Target[] = useMemo(() => {
    if (triggerPick) {
      return legal.flatMap((a) => (a.type === "CHOOSE_TARGET" ? [a.target] : []));
    }
    if (aimingDef) return legalTargets(rules, state, aimingDef);
    if (activating) {
      return activations
        .filter((a) => a.cardId === activating.cardId && a.abilityIndex === activating.abilityIndex)
        .flatMap((a) => a.targets ?? []);
    }
    return [];
  }, [aimingDef, activating, activations, triggerPick, legal, state]);
  const isTarget = (t: Target) => targets.some((x) => x.kind === t.kind && x.id === t.id);

  const pickTarget = (t: Target) => {
    if (!isTarget(t)) return;
    if (triggerPick) act({ type: "CHOOSE_TARGET", player: HUMAN, target: t });
    else if (aiming) act({ type: "CAST", player: HUMAN, cardId: aiming, targets: [t] });
    else if (activating) {
      act({ type: "ACTIVATE", player: HUMAN, cardId: activating.cardId, abilityIndex: activating.abilityIndex, targets: [t] });
    }
  };

  const activate = (id: CardId) => {
    const options = activations.filter((a) => a.cardId === id);
    const first = options[0];
    if (!first) return setNotice("That permanent has no ability you can use right now");
    if (first.x !== undefined && !first.targets) {
      setNotice("");
      return setXChoice(options.filter((a) => a.abilityIndex === first.abilityIndex));
    }
    if (!first.targets) return act(first);
    setNotice("");
    setActivating({ cardId: id, abilityIndex: first.abilityIndex });
  };

  // ---- hand -----------------------------------------------------------
  const playable = (id: CardId) =>
    legal.some((a) => (a.type === "PLAY_LAND" || a.type === "CAST") && a.cardId === id);

  const clickHand = (id: CardId) => {
    const def = defOf(id);
    if (!def) return;
    if (state.pending === "discard") {
      if (myDecision) act({ type: "DISCARD", player: HUMAN, cardIds: [id] });
      return;
    }
    if (state.pending) return;
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
    if (picking) return pickTarget({ kind: "card", id });
    if (attackers.includes(id)) {
      setAttackSel((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
    } else if (blockers.includes(id)) {
      if (blocks.some((b) => b.blocker === id)) setBlocks((bs) => bs.filter((b) => b.blocker !== id));
      else setBlockSel(blockSel === id ? null : id);
    } else if (myDecision && !state.pending) {
      activate(id);
    }
  };

  const clickTheirCreature = (id: CardId) => {
    if (picking) return pickTarget({ kind: "card", id });
    if (blockSel && incoming.includes(id)) {
      const next = [...blocks, { blocker: blockSel, attacker: id }];
      const err = validateBlocks(rules, state, next, true);
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
    const asTarget = picking ? isTarget({ kind: "card", id }) : false;
    const canActivate = mine && !picking && !state.pending && activations.some((a) => a.cardId === id);
    const active =
      asTarget ||
      canActivate ||
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
            : picking || blockSel
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
    const targetable = picking ? isTarget({ kind: "player", id: pid }) : false;
    return (
      <button
        type="button"
        className={`flex items-baseline gap-[14px] rounded-lg border bg-[var(--panel)] px-[14px] py-2 text-left font-[inherit] text-[var(--text)] ${
          state.activePlayer === pid ? "border-[#50505f]" : "border-[var(--line)]"
        } ${targetable ? "targetable active" : ""}`}
        onClick={targetable ? () => pickTarget({ kind: "player", id: pid }) : undefined}
        disabled={!targetable}
      >
        <span className="min-w-[80px] font-semibold">{label(pid)}</span>
        <span className="text-[1.6rem] font-bold">{p.life}</span>
        <span className="text-[0.8rem] dim">
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
    const def = item.kind === "spell" ? defOf(item.cardId) : defOf(item.sourceId);
    const name = item.kind === "spell" ? (def?.name ?? "?") : `${def?.name ?? "?"} ability`;
    const t = item.targets[0];
    const tn = t ? (t.kind === "player" ? label(t.id) : (defOf(t.id)?.name ?? "?")) : "";
    return `${name} (${label(item.controller)})${tn ? ` → ${tn}` : ""}`;
  };

  const winnerText =
    state.winner === HUMAN ? "You win!" : state.winner === BOT ? "You lose." : "Draw.";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-[var(--line)] bg-[var(--panel)] px-4 py-[10px]">
        <strong>Cards With Borders Foundry</strong>
        <span className="dim">seed {seed}</span>
        <label className="ml-auto text-[0.85rem] dim">
          <input type="checkbox" checked={stopEverywhere} onChange={onToggleStops} /> stop at every step
        </label>
        {!state.over && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (window.confirm("Surrender this game?")) act({ type: "CONCEDE", player: HUMAN });
            }}
          >
            Surrender
          </button>
        )}
        <button type="button" className="btn" onClick={onNewGame}>
          New game
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_260px] max-[900px]:grid-cols-1">
        <main className="flex min-w-0 flex-col gap-2 px-4 pt-3 pb-6">
          {playerBar(BOT)}
          <div className="flex min-h-[150px] flex-wrap items-start gap-2">
            {theirs.creatures.map((id) => renderCreature(id, false))}
          </div>
          <div className="flex min-h-[34px] flex-wrap items-start gap-2">{renderLands(theirs.lands)}</div>

          <div className="grid gap-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-[14px] py-[10px]">
            <ol className="flex list-none flex-wrap gap-[6px] p-0 text-xs">
              {rules.pack.phases
                .filter((p) => p.id !== "untap" && p.id !== "cleanup")
                .map((p) => (
                  <li
                    key={p.id}
                    className={`rounded-full px-2 py-[3px] ${
                      p.id === phase?.id ? "bg-[#2d5cff] text-white" : "bg-[var(--panel-2)] dim"
                    }`}
                  >
                    {p.name}
                  </li>
                ))}
            </ol>
            <div className="text-[0.85rem] dim">
              Turn {state.turn} · {label(state.activePlayer)}
              {state.stack.length > 0 && (
                <span className="text-[var(--warn)]"> · stack: {state.stack.length}</span>
              )}
            </div>
            {state.stack.length > 0 && (
              <ul className="m-0 pl-[18px] text-[0.85rem] text-[var(--warn)]">
                {[...state.stack].reverse().map((_, i) => (
                  <li key={i}>{stackText(state.stack.length - 1 - i)}</li>
                ))}
              </ul>
            )}

            <div className="flex min-h-[38px] flex-wrap items-center gap-[10px]">
              {aiming && (
                <>
                  <span>Choose a target for {aimingDef?.name}</span>
                  <button type="button" className="btn" onClick={() => setAiming(null)}>
                    Cancel
                  </button>
                </>
              )}
              {state.pending === "search" && myDecision && (
                <>
                  <span>Search your library for a {state.search?.subtype} card:</span>
                  {legal.flatMap((a) =>
                    a.type === "SEARCH" && a.cardId !== null ? (
                      <button key={a.cardId} type="button" className="btn primary" onClick={() => act(a)}>
                        {defOf(a.cardId)?.name}
                      </button>
                    ) : [],
                  )}
                  <button
                    type="button"
                    className="btn"
                    onClick={() => act({ type: "SEARCH", player: HUMAN, cardId: null })}
                  >
                    Don&apos;t search
                  </button>
                </>
              )}
              {triggerPick && (
                <span>
                  Choose a target for {defOf(state.targeting?.sourceId ?? "")?.name}&apos;s triggered ability
                </span>
              )}
              {xChoice && (
                <>
                  <span>Choose X for {defOf(xChoice[0]?.cardId ?? "")?.name}:</span>
                  {xChoice.map((a) => (
                    <button key={a.x} type="button" className="btn" onClick={() => act(a)}>
                      {a.x}
                    </button>
                  ))}
                  <button type="button" className="btn" onClick={() => setXChoice(null)}>
                    Cancel
                  </button>
                </>
              )}
              {activating && (
                <>
                  <span>Choose a target for {defOf(activating.cardId)?.name}'s ability</span>
                  <button type="button" className="btn" onClick={() => setActivating(null)}>
                    Cancel
                  </button>
                </>
              )}
              {!picking && state.pending === "attackers" && myDecision && (
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
              {!picking && state.pending === "blockers" && myDecision && (
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
              {!picking && state.pending === "discard" && myDecision && <span>Choose a card from your hand to discard</span>}
              {!state.over && opp && opp.library.length === 0 && opp.graveyard.length > 0 && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => act({ type: "RECLAIM_GRAVEYARD", player: BOT })}
                >
                  Let opponent reclaim graveyard ({opp.graveyard.length} cards)
                </button>
              )}
              {!state.over && opp && opp.library.length === 0 && (
                <button type="button" className="btn" onClick={() => act({ type: "CONCEDE", player: BOT })}>
                  End game
                </button>
              )}
              {!picking && !state.pending && myDecision && me && me.library.length === 0 && me.graveyard.length > 0 && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => act({ type: "RECLAIM_GRAVEYARD", player: HUMAN })}
                >
                  Reclaim graveyard ({me.graveyard.length} cards back to your library)
                </button>
              )}
              {!picking && !state.pending && myDecision && (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => act({ type: "PASS", player: HUMAN })}
                >
                  {state.stack.length ? "Pass (resolve)" : `Pass priority (${phase?.name})`}
                </button>
              )}
            </div>
            {notice && <div className="text-[0.85rem] text-[var(--warn)]">{notice}</div>}
          </div>

          <div className="flex min-h-[150px] flex-wrap items-start gap-2">
            {mine.creatures.map((id) => renderCreature(id, true))}
          </div>
          <div className="flex min-h-[34px] flex-wrap items-start gap-2">{renderLands(mine.lands)}</div>
          {playerBar(HUMAN)}

          <div className="flex flex-wrap gap-2 pt-2" aria-label="Your hand">
            {(me?.hand ?? []).map((id) => {
              const def = defOf(id);
              return def ? (
                <CardView
                  key={id}
                  def={def}
                  inst={state.cards[id]}
                  active={(state.pending === "discard" && myDecision) || (playable(id) && !state.pending)}
                  selected={aiming === id}
                  onClick={() => clickHand(id)}
                />
              ) : null;
            })}
          </div>
        </main>

        <aside
          className="sticky top-0 max-h-[calc(100vh-50px)] overflow-y-auto border-l border-[var(--line)] bg-[var(--panel)] p-3 text-[0.8rem] dim max-[900px]:static max-[900px]:max-h-[200px] max-[900px]:border-t max-[900px]:border-l-0"
          ref={logRef}
          aria-label="Game log"
        >
          {state.log.map((line, i) => (
            <div key={i} className="border-b border-[#1d1d25] py-[2px]">
              {line}
            </div>
          ))}
        </aside>
      </div>

      {state.over && (
        <div className="fixed inset-0 grid place-items-center bg-black/60">
          <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-10 py-7 text-center">
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
