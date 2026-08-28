import { supabase } from "@/integrations/supabase/client";
import { withTimeout } from "@/lib/with-timeout";
import { i18next } from "@/i18n";
import type { LabelComparison } from "@/lib/compare-labels.functions";

export type CompareFn = (args: {
  data: { candidatePath: string; newPath: string };
}) => Promise<
  { ok: true; data: LabelComparison } | { ok: false; error: string }
>;

/** Storage paths only: a legacy full URL cannot be downloaded server-side. */
function isPath(ref: string | null | undefined): ref is string {
  return !!ref && !/^https?:\/\//i.test(ref);
}

/**
 * A label photo we are allowed to show and send for the candidate wine:
 * the catalogue label if there is one, otherwise this user's own earlier photo
 * of the same wine. Never another person's private photo.
 */
export async function candidateLabelPath(wineId: string): Promise<string | null> {
  const { data: wine } = await supabase
    .from("wines")
    .select("label_image_url")
    .eq("id", wineId)
    .maybeSingle();
  if (isPath(wine?.label_image_url)) return wine!.label_image_url as string;

  const { data: vintages } = await supabase
    .from("wine_vintages")
    .select("id")
    .eq("wine_id", wineId);
  const ids = (vintages ?? []).map((v) => v.id);
  if (!ids.length) return null;

  const { data: entries } = await supabase
    .from("entries")
    .select("photo_url, created_at")
    .in("wine_vintage_id", ids)
    .not("photo_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);
  const hit = (entries ?? []).find((e) => isPath(e.photo_url));
  return hit ? (hit.photo_url as string) : null;
}

export type VisualVerdict = {
  comparison: LabelComparison;
  /** 'merge' | 'new' when confident enough, otherwise null → ask the user */
  outcome: "merge" | "new" | null;
};

/**
 * Visual tie-breaker for the ambiguous band. Never blocks a save: any failure,
 * or a 15s timeout, resolves to null so the caller asks the user instead.
 */
export async function compareLabelsVisually(
  compare: CompareFn,
  candidatePath: string | null,
  newPath: string | null,
): Promise<VisualVerdict | null> {
  if (!isPath(candidatePath) || !isPath(newPath)) return null;
  try {
    const res = await withTimeout(
      compare({ data: { candidatePath, newPath } }),
      15_000,
      i18next.t("dupe.compareTimeout"),
    );
    if (!res.ok) {
      console.error("compare-labels failed", res.error);
      return null;
    }
    const c = res.data;
    const confident = c.confidence >= 0.8;
    const outcome =
      confident && c.same_wine === true ? "merge" : confident && c.same_wine === false ? "new" : null;
    return { comparison: c, outcome };
  } catch (e) {
    console.error("compare-labels error", e);
    return null;
  }
}
