import { supabase } from "@/integrations/supabase/client";
import { withValidSession } from "@/lib/session-guard";
import { i18next } from "@/i18n";
import type { FieldSources } from "@/lib/field-provenance";


export type WineCandidate = {
  id: string;
  name: string;
  producer: string | null;
  region: string | null;
  country: string | null;
  score: number;
};

/** Wine identity — no year, no alcohol. Those live on wine_vintages. */
export type WineDraft = {
  name: string;
  producer: string | null;
  appellation: string | null;
  /** Riserva, Grand Cru, Gran Reserva … kept out of the appellation name */
  classification: string | null;

  region: string | null;
  country: string | null;
  wine_type: string | null;
  grapes: string[];
  label_image_url: string | null;
  data_source: "label" | "inferred" | "user";
  /** per-field provenance: field name -> 'label' | 'inferred' | 'user' */
  field_sources: FieldSources;
  /** carried along for the vintage row, not stored on wines */
  vintage: number | null;
  alcohol_percent: number | null;
};

/** Matching is wine-level: name + producer only, the year is ignored. */
export async function findBestMatch(
  name: string,
  producer: string | null,
): Promise<WineCandidate | null> {
  const [first] = await findBestMatches([{ name, producer }]);
  return first ?? null;
}

/**
 * One database round trip for a whole list of wines — no per-item query and no
 * external API call. Returns a candidate (or null) per input, in order.
 */
export async function findBestMatches(
  inputs: Array<{ name: string; producer: string | null }>,
): Promise<Array<WineCandidate | null>> {
  const out: Array<WineCandidate | null> = inputs.map(() => null);
  if (!inputs.length) return out;

  const { data, error } = await withValidSession(async () =>
    supabase.rpc("find_wine_matches", {
      _names: inputs.map((i) => i.name ?? ""),
      _producers: inputs.map((i) => i.producer ?? ""),
    } as never),
  );

  if (error) {
    console.error("find_wine_matches failed", error);
    const message = (error as { message?: string }).message;
    throw new Error(message || i18next.t("dupe.matchFailed"));
  }


  for (const row of (data ?? []) as unknown as Array<WineCandidate & { idx: number }>) {
    const i = Number(row.idx) - 1; // Postgres arrays are 1-based
    if (i >= 0 && i < out.length) out[i] = { ...row, score: Number(row.score) };
  }
  return out;
}


/** Find or create the vintage row underneath a wine. */
export async function findOrCreateVintage(
  wineId: string,
  vintage: number | null,
  alcoholPercent: number | null,
): Promise<string> {
  let q = supabase.from("wine_vintages").select("id, alcohol_percent").eq("wine_id", wineId);
  q = vintage == null ? q.is("vintage", null) : q.eq("vintage", vintage);
  const { data: existing } = await q.maybeSingle();

  if (existing) {
    if (existing.alcohol_percent == null && alcoholPercent != null) {
      await supabase
        .from("wine_vintages")
        .update({ alcohol_percent: alcoholPercent })
        .eq("id", existing.id);
    }
    return existing.id;
  }

  const { data: created, error } = await supabase
    .from("wine_vintages")
    .insert({ wine_id: wineId, vintage, alcohol_percent: alcoholPercent })
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
}

/** Fill in empty columns on the existing wine row without overwriting anything set. */
export async function fillEmptyWineFields(existingId: string, draft: WineDraft): Promise<void> {
  const { data: existing } = await supabase
    .from("wines")
    .select("producer, appellation, region, country, wine_type, grapes")
    .eq("id", existingId)
    .single();
  if (!existing) return;

  const patch: Record<string, unknown> = {};
  const setIfEmpty = (key: string, cur: unknown, newVal: unknown) => {
    const curEmpty =
      cur === null ||
      cur === undefined ||
      (typeof cur === "string" && cur.trim() === "") ||
      (Array.isArray(cur) && cur.length === 0);
    const newEmpty =
      newVal === null ||
      newVal === undefined ||
      (typeof newVal === "string" && newVal === "") ||
      (Array.isArray(newVal) && newVal.length === 0);
    if (curEmpty && !newEmpty) patch[key] = newVal;
  };

  setIfEmpty("producer", existing.producer, draft.producer);
  setIfEmpty("appellation", existing.appellation, draft.appellation);
  setIfEmpty("region", existing.region, draft.region);
  setIfEmpty("country", existing.country, draft.country);
  setIfEmpty("wine_type", existing.wine_type, draft.wine_type);
  setIfEmpty("grapes", existing.grapes, draft.grapes);
  // label_image_url intentionally not filled: personal photos stay out of the shared catalogue.

  if (Object.keys(patch).length > 0) {
    await supabase.from("wines").update(patch as never).eq("id", existingId);
  }
}

export async function logAlias(
  wineId: string,
  rawName: string,
  rawProducer: string | null,
  source: "label" | "inferred" | "user",
  createdBy: string,
) {
  await supabase.from("wine_aliases").insert({
    wine_id: wineId,
    raw_name: rawName,
    raw_producer: rawProducer,
    source: source as never,
    created_by: createdBy,
  } as never);
}

export type MatchDecision =
  | "auto_merge"
  | "user_merge"
  | "user_rejected"
  | "auto_new"
  | "auto_merge_visual"
  | "auto_new_visual";

export async function logDecision(
  userId: string,
  newName: string,
  newProducer: string | null,
  newVintage: number | null,
  candidate: { id: string | null; score: number | null },
  decision: MatchDecision,
  visual?: { same_wine: boolean | null; confidence: number | null; reason: string | null } | null,
) {
  await supabase.from("match_decisions").insert({
    visual_same_wine: visual?.same_wine ?? null,
    visual_confidence: visual?.confidence ?? null,
    visual_reason: visual?.reason ?? null,
    user_id: userId,
    new_name: newName,
    new_producer: newProducer,
    new_vintage: newVintage,
    candidate_wine_id: candidate.id,
    similarity_score: candidate.score,
    decision: decision as never,
  } as never);
}
