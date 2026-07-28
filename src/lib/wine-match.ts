import { supabase } from "@/integrations/supabase/client";

export type WineCandidate = {
  id: string;
  name: string;
  producer: string | null;
  region: string | null;
  country: string | null;
  vintage: number | null;
  score: number;
};

export type WineDraft = {
  name: string;
  producer: string | null;
  appellation: string | null;
  region: string | null;
  country: string | null;
  vintage: number | null;
  wine_type: string | null;
  grapes: string[];
  alcohol_percent: number | null;
  label_image_url: string | null;
  data_source: "label" | "inferred" | "user";
};

export async function findBestMatch(
  name: string,
  producer: string | null,
  vintage: number | null,
): Promise<WineCandidate | null> {
  const { data, error } = await supabase.rpc("find_wine_match", {
    _name: name,
    _producer: producer,
    _vintage: vintage,
  } as never);
  if (error || !data) return null;
  const rows = data as unknown as WineCandidate[];
  const top = rows[0];
  if (!top) return null;
  return { ...top, score: Number(top.score) };
}

/** Fill in empty columns on the existing wine row without overwriting anything set. */
export async function fillEmptyWineFields(existingId: string, draft: WineDraft): Promise<void> {
  const { data: existing } = await supabase
    .from("wines")
    .select("producer, appellation, region, country, wine_type, grapes, alcohol_percent, label_image_url")
    .eq("id", existingId)
    .single();
  if (!existing) return;

  const patch: Record<string, unknown> = {};
  const setIfEmpty = (key: keyof typeof existing, newVal: unknown) => {
    const cur = existing[key] as unknown;
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
    if (curEmpty && !newEmpty) patch[key as string] = newVal;
  };

  setIfEmpty("producer", draft.producer);
  setIfEmpty("appellation", draft.appellation);
  setIfEmpty("region", draft.region);
  setIfEmpty("country", draft.country);
  setIfEmpty("wine_type", draft.wine_type);
  setIfEmpty("grapes", draft.grapes);
  setIfEmpty("alcohol_percent", draft.alcohol_percent);
  setIfEmpty("label_image_url", draft.label_image_url);

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
