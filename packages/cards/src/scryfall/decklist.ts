export interface DeckEntry {
  name: string;
  count: number;
}

export interface ParsedDecklist {
  entries: DeckEntry[];
  /** Lines we couldn't make sense of (shown to the user, never silently dropped). */
  skipped: string[];
}

/**
 * Parse a pasted decklist. Understands "4 Lightning Bolt", "4x Lightning Bolt",
 * Arena/MTGO exports with set codes ("4 Lightning Bolt (M11) 149"), bare names (count 1),
 * comments (// or #), and ignores everything from a "Sideboard" line onward.
 * Also understands Forge's `.dck` format: bracketed section headers ("[Main]",
 * "[Commander]"), "Key=Value" metadata lines inside "[metadata]", and set-coded card
 * lines ("1 Marrow-Gnawer|CHK", "31 Swamp|LEA|2").
 * Duplicate names are merged (case-insensitively).
 */
export function parseDecklist(text: string): ParsedDecklist {
  const merged = new Map<string, DeckEntry>();
  const skipped: string[] = [];
  let skippingSection = false;

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) continue;

    const section = line.match(/^\[(.+)\]$/);
    if (section) {
      skippingSection = /^(sideboard|metadata)$/i.test(section[1]!.trim());
      continue;
    }
    if (skippingSection) continue;

    if (/^(sideboard|sb:?|companion|maybeboard)\b/i.test(line)) break;
    if (/^(deck|main(deck)?|commander)$/i.test(line)) continue;

    // Forge .dck: trailing "|SET" or "|SET|artIndex".
    line = line.replace(/\|[\w-]+(\|\d+)?\s*$/, "").trim();

    // Trailing "(SET) 123" or "(SET)" from Arena/MTGO/Moxfield exports.
    line = line.replace(/\s+\([A-Za-z0-9]{2,6}\)(\s+[\w★-]+)?\s*$/, "").trim();

    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    const count = m ? Number(m[1]) : 1;
    const name = (m ? (m[2] ?? "") : line).trim();
    if (!name || count < 1 || count > 250 || !/[a-z]/i.test(name)) {
      skipped.push(rawLine.trim());
      continue;
    }

    const key = name.toLowerCase();
    const existing = merged.get(key);
    if (existing) existing.count += count;
    else merged.set(key, { name, count });
  }

  return { entries: [...merged.values()], skipped };
}
