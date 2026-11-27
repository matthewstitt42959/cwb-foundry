"use client";

import { useState, type CSSProperties } from "react";
import { cardText } from "@cwb/cards";
import type { CardDef, CardInstance, ManaCost } from "@cwb/engine";

const ACCENT: Record<string, string> = {
  R: "#d9534f",
  G: "#4caf50",
  W: "#e0c060",
  U: "#4a90d9",
  B: "#8a6fb0",
  none: "#9a9a9a",
};

function accentOf(def: CardDef): string {
  const fromLand = def.produces;
  const fromCost = (["W", "U", "B", "R", "G"] as const).find((c) => (def.cost?.[c] ?? 0) > 0);
  return ACCENT[fromLand ?? fromCost ?? "none"] ?? ACCENT.none!;
}

export function costString(cost?: ManaCost): string {
  if (!cost) return "";
  const generic = cost.generic ? String(cost.generic) : "";
  const colored = (["W", "U", "B", "R", "G"] as const).map((c) => c.repeat(cost[c] ?? 0)).join("");
  return generic + colored;
}

export interface CardViewProps {
  def: CardDef;
  inst?: CardInstance | undefined;
  mini?: boolean;
  selected?: boolean;
  /** Can be clicked right now (hand card you can play, creature you can declare...). */
  active?: boolean;
  /** Is a valid target for the spell being aimed. */
  targetable?: boolean;
  badge?: string | undefined;
  /** Current power/toughness on the battlefield (computed power, pumps...); falls back to the printed stats. */
  power?: number | undefined;
  toughness?: number | undefined;
  onClick?: (() => void) | undefined;
}

export function CardView({ def, inst, mini, selected, active, targetable, badge, power, toughness, onClick }: CardViewProps) {
  // Imported cards carry an image URL; fall back to the text layout if it can't load.
  const [artFailed, setArtFailed] = useState(false);
  const showArt = !mini && !!def.imageUrl && !artFailed;

  const isCreature = def.types.includes("creature");
  const classes = [
    "card",
    mini ? "mini" : "",
    showArt ? "has-art" : "",
    inst?.tapped ? "tapped" : "",
    selected ? "selected" : "",
    active ? "active" : "",
    targetable ? "targetable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const damage = inst?.damage ?? 0;
  const shownPower = power ?? def.power;
  const shownToughness = toughness ?? def.toughness ?? 0;
  const toughnessLeft = shownToughness - damage;

  return (
    <button
      type="button"
      className={classes}
      style={{ "--accent": accentOf(def) } as CSSProperties}
      onClick={onClick}
      disabled={!onClick}
      aria-label={def.name}
      title={showArt ? `${def.name}: ${cardText(def)}` : undefined}
    >
      {showArt ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="card-art"
            src={def.imageUrl}
            alt={def.name}
            loading="lazy"
            onError={() => setArtFailed(true)}
          />
          {isCreature && damage > 0 && <span className="card-pt hurt overlay">{toughnessLeft} left</span>}
        </>
      ) : (
        <>
          <span className="card-head">
            <span className="card-name">{def.name}</span>
            {!mini && <span className="card-cost">{costString(def.cost)}</span>}
          </span>
          {!mini && <span className="card-type">{def.types.join(" ")}</span>}
          {!mini && <span className="card-text">{cardText(def)}</span>}
          {isCreature && (
            <span className={`card-pt ${damage > 0 ? "hurt" : ""}`}>
              {shownPower}/{damage > 0 ? toughnessLeft : shownToughness}
            </span>
          )}
        </>
      )}
      {badge && <span className="card-badge">{badge}</span>}
    </button>
  );
}
