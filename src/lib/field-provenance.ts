import { supabase } from "@/integrations/supabase/client";

export type FieldSource = "label" | "inferred" | "user";
export type FieldSources = Record<string, FieldSource>;

/** Fields whose provenance we track. vintage/alcohol live on wine_vintages but are still recorded here. */
export const TRACKED_FIELDS = [
  "name",
  "producer",
  "appellation",
  "region",
  "country",
  "vintage",
  "wine_type",
  "grapes",
  "alcohol_percent",
] as const;

export type TrackedField = (typeof TRACKED_FIELDS)[number];

/* ---------- value normalisation ---------- */

type Norm =
  | { kind: "empty" }
  | { kind: "string"; v: string }
  | { kind: "number"; v: number }
  | { kind: "bool"; v: boolean }
  | { kind: "set"; v: string[] };

/** null, undefined, "" and [] all normalise to the same "no value". */
export function normaliseValue(value: unknown): Norm {
  if (value === null || value === undefined) return { kind: "empty" };
  if (Array.isArray(value)) {
    const items = Array.from(
      new Set(
        value
          .filter((x) => x !== null && x !== undefined)
          .map((x) => String(x).trim().toLowerCase())
          .filter((s) => s !== ""),
      ),
    ).sort();
    return items.length === 0 ? { kind: "empty" } : { kind: "set", v: items };
  }
  if (typeof value === "number") {
    return Number.isNaN(value) ? { kind: "empty" } : { kind: "number", v: value };
  }
  if (typeof value === "boolean") return { kind: "bool", v: value };
  const s = String(value).trim();
  if (s === "") return { kind: "empty" };
  return { kind: "string", v: s.toLowerCase() };
}

export function hasValue(value: unknown): boolean {
  return normaliseValue(value).kind !== "empty";
}

/** True when two values mean the same thing — no correction to record. */
export function valuesEquivalent(a: unknown, b: unknown): boolean {
  const na = normaliseValue(a);
  const nb = normaliseValue(b);
  if (na.kind === "empty" || nb.kind === "empty") {
    return na.kind === "empty" && nb.kind === "empty";
  }
  // numbers may arrive as strings ("13.0" vs 13)
  if (na.kind === "number" || nb.kind === "number") {
    const numA = na.kind === "number" ? na.v : Number(na.kind === "string" ? na.v : NaN);
    const numB = nb.kind === "number" ? nb.v : Number(nb.kind === "string" ? nb.v : NaN);
    if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA === numB;
    return false;
  }
  if (na.kind === "set" && nb.kind === "set") {
    return na.v.length === nb.v.length && na.v.every((x, i) => x === nb.v[i]);
  }
  if (na.kind !== nb.kind) return false;
  if (na.kind === "string" && nb.kind === "string") return na.v === nb.v;
  if (na.kind === "bool" && nb.kind === "bool") return na.v === nb.v;
  return false;
}

/**
 * Genuine differences only. A model null against a user empty array is not a correction.
 * Returns null when nothing was actually corrected.
 */
export function diffCorrections(
  pairs: Array<[string, unknown, unknown]>, // [field, modelValue, userValue]
): Record<string, { model: unknown; user: unknown }> | null {
  const diffs: Record<string, { model: unknown; user: unknown }> = {};
  for (const [field, modelVal, userVal] of pairs) {
    if (valuesEquivalent(modelVal, userVal)) continue;
    diffs[field] = { model: modelVal ?? null, user: userVal ?? null };
  }
  return Object.keys(diffs).length ? diffs : null;
}

/* ---------- provenance ---------- */

/**
 * Per-field provenance for a wine created from a recognition.
 * - model value kept as-is and not listed as inferred -> 'label'
 * - field named in inferred_fields -> 'inferred'
 * - anything the user typed or changed -> 'user'
 */
export function buildFieldSources(
  modelValues: Record<string, unknown> | null,
  userValues: Record<string, unknown>,
  inferredFields: string[],
): FieldSources {
  const inferred = new Set(inferredFields.map((f) => f.trim().toLowerCase()));
  const sources: FieldSources = {};
  for (const field of TRACKED_FIELDS) {
    const userVal = userValues[field];
    if (!hasValue(userVal)) continue;
    const modelVal = modelValues ? modelValues[field] : undefined;
    if (!modelValues || !hasValue(modelVal) || !valuesEquivalent(modelVal, userVal)) {
      sources[field] = "user";
    } else if (inferred.has(field)) {
      sources[field] = "inferred";
    } else {
      sources[field] = "label";
    }
  }
  return sources;
}

/** Row-level fallback: 'label' when anything came off the label. */
export function rowDataSource(sources: FieldSources): "label" | "inferred" | "user" {
  const vals = Object.values(sources);
  if (vals.includes("label")) return "label";
  if (vals.includes("inferred")) return "inferred";
  return "user";
}

/** Merge a patch into wines.field_sources without dropping what's already there. */
export async function mergeFieldSources(wineId: string, patch: FieldSources): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  const { data } = await supabase
    .from("wines")
    .select("field_sources")
    .eq("id", wineId)
    .maybeSingle();
  const current = ((data as { field_sources?: FieldSources } | null)?.field_sources ?? {}) as FieldSources;
  await supabase
    .from("wines")
    .update({ field_sources: { ...current, ...patch } } as never)
    .eq("id", wineId);
}

/** Any field the user typed or edited is theirs from then on. */
export async function markFieldsAsUser(wineId: string, fields: string[]): Promise<void> {
  const patch: FieldSources = {};
  for (const f of fields) patch[f] = "user";
  await mergeFieldSources(wineId, patch);
}
