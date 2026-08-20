import { supabase } from "@/integrations/supabase/client";
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
  const { data, error } = await supabase.rpc("find_wine_match", {
    _name: name,
    _producer: producer,
  } as never);
  if (error || !data) return null;
  const rows = data as unknown as WineCandidate[];
  const top = rows[0];
  if (!top) return null;
  return { ...top, score: Number(top.score) };
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

export async function logDecision(
  userId: string,
  newName: string,
  newProducer: string | null,
  newVintage: number | null,
  candidate: { id: string | null; score: number | null },
  decision: "auto_merge" | "user_merge" | "user_rejected" | "auto_new",
) {
  await supabase.from("match_decisions").insert({
    user_id: userId,
    new_name: newName,
    new_producer: newProducer,
    new_vintage: newVintage,
    candidate_wine_id: candidate.id,
    similarity_score: candidate.score,
    decision: decision as never,
  } as never);
}
