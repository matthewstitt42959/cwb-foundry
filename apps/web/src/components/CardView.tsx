import type { CSSProperties } from "react";
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
  onClick?: (() => void) | undefined;
}

export function CardView({ def, inst, mini, selected, active, targetable, badge, onClick }: CardViewProps) {
  const isCreature = def.types.includes("creature");
  const classes = [
    "card",
    mini ? "mini" : "",
    inst?.tapped ? "tapped" : "",
    selected ? "selected" : "",
    active ? "active" : "",
    targetable ? "targetable" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const damage = inst?.damage ?? 0;
  const toughnessLeft = (def.toughness ?? 0) - damage;

  return (
    <button
      type="button"
      className={classes}
      style={{ "--accent": accentOf(def) } as CSSProperties}
      onClick={onClick}
      disabled={!onClick}
      aria-label={def.name}
    >
      <span className="card-head">
        <span className="card-name">{def.name}</span>
        {!mini && <span className="card-cost">{costString(def.cost)}</span>}
      </span>
      {!mini && <span className="card-type">{def.types.join(" ")}</span>}
      {!mini && <span className="card-text">{cardText(def)}</span>}
      {isCreature && (
        <span className={`card-pt ${damage > 0 ? "hurt" : ""}`}>
          {def.power}/{damage > 0 ? toughnessLeft : def.toughness}
        </span>
      )}
      {badge && <span className="card-badge">{badge}</span>}
    </button>
  );
}
