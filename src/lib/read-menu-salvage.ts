/**
 * Long wine lists can exhaust the model's token budget mid-object. Rather than
 * throwing the whole page away, pull out every complete JSON object that sits
 * inside the "items" array and report how many survived.
 */
export type SalvageResult = {
  restaurant_name: string | null;
  currency: string | null;
  items: Array<Record<string, unknown>>;
  skipped_count: number;
  skipped_categories: string[];
  truncated: boolean;
};

function topLevelNumber(text: string, key: string): number | null {
  const m = new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`).exec(text);
  return m ? Number(m[1]) : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((v) => (typeof v === "string" && v.trim() ? [v.trim()] : []))
    : [];
}

function topLevelString(text: string, key: string): string | null {
  const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text);
  return m ? m[1]!.replace(/\\"/g, '"').trim() || null : null;
}

/** Extract balanced `{...}` objects from the items array. */
function completeObjects(text: string): Array<Record<string, unknown>> {
  const start = text.indexOf('"items"');
  if (start === -1) return [];
  const arrayStart = text.indexOf("[", start);
  if (arrayStart === -1) return [];

  const out: Array<Record<string, unknown>> = [];
  let depth = 0;
  let objStart = -1;
  let inString = false;
  let escaped = false;

  for (let i = arrayStart; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try {
          out.push(JSON.parse(text.slice(objStart, i + 1)) as Record<string, unknown>);
        } catch {
          /* skip the malformed object */
        }
        objStart = -1;
      }
    } else if (c === "]" && depth === 0) {
      break;
    }
  }
  return out;
}

export function parseMenuJson(text: string): SalvageResult | null {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      restaurant_name: typeof parsed.restaurant_name === "string" ? parsed.restaurant_name : null,
      currency: typeof parsed.currency === "string" ? parsed.currency : null,
      items: Array.isArray(parsed.items) ? (parsed.items as Array<Record<string, unknown>>) : [],
      skipped_count:
        typeof parsed.skipped_count === "number" && parsed.skipped_count > 0
          ? Math.round(parsed.skipped_count)
          : 0,
      skipped_categories: stringArray(parsed.skipped_categories),
      truncated: false,
    };
  } catch {
    const items = completeObjects(cleaned);
    if (!items.length) return null;
    return {
      restaurant_name: topLevelString(cleaned, "restaurant_name"),
      currency: topLevelString(cleaned, "currency"),
      items,
      skipped_count: Math.max(0, Math.round(topLevelNumber(cleaned, "skipped_count") ?? 0)),
      skipped_categories: [],
      truncated: true,
    };
  }
}
