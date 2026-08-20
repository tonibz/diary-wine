import { supabase } from "@/integrations/supabase/client";
import { withTimeout } from "@/lib/with-timeout";
import { valuesEquivalent } from "@/lib/field-provenance";

/** Reference row from the Wikipedia-derived appellations table. */
export type AppellationRef = {
  id: string;
  name: string;
  country: string | null;
  region: string | null;
  typical_colour: string | null;
  grapes: string[];
  grape_count: number | null;
  score: number;
};

/** Fields where model and reference can be compared. */
export type CheckField = "country" | "region" | "typical_colour" | "grapes";

export type Disagreement = {
  /** the form field to flag */
  field: "wine_type" | "country";
  modelValue: string;
  referenceValue: string;
  note: string;
};

export type ReferenceOutcome = {
  ref: AppellationRef;
  /** gaps we may fill because the model said nothing */
  fills: Partial<Record<"country" | "region" | "wine_type", string>>;
  /** suggestions only — never applied automatically */
  grapeSuggestions: string[];
  disagreements: Disagreement[];
};

export type ModelSnapshot = {
  country: string | null;
  region: string | null;
  wine_type: string | null;
  grapes: string[];
};

const MATCH_THRESHOLD = 0.8;

function toGrapeArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter((s) => s !== "");
}

function normGrape(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Best appellation match by normalised name, falling back to trigram similarity.
 * Returns null when nothing scores above 0.8.
 */
export async function lookupAppellation(appellation: string | null | undefined): Promise<AppellationRef | null> {
  const name = (appellation ?? "").trim();
  if (!name) return null;
  const { data, error } = await withTimeout(
    (async () => await supabase.rpc("lookup_appellation", { _name: name }))(),
    15_000,
    "Appellation lookup timed out",
  );
  if (error) {
    console.error("lookup_appellation failed", error);
    return null;
  }
  const row = (data as Array<Record<string, unknown>> | null)?.[0];
  if (!row) return null;
  const score = Number(row.score ?? 0);
  if (!(score >= MATCH_THRESHOLD)) return null;
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    country: (row.country as string | null) ?? null,
    region: (row.region as string | null) ?? null,
    typical_colour: (row.typical_colour as string | null) ?? null,
    grapes: toGrapeArray(row.grapes),
    grape_count: row.grape_count == null ? null : Number(row.grape_count),
    score,
  };
}

const COLOUR_LABEL: Record<string, string> = {
  red: "red",
  white: "white",
  rose: "rosé",
  sparkling: "sparkling",
  dessert: "dessert",
  fortified: "fortified",
};

/**
 * Compare the model's inferences against the appellation reference, log one
 * inference_checks row per comparable field, and report the gaps we can fill
 * plus the disagreements worth showing the user. Never overwrites model values.
 */
export async function checkAgainstReference(
  recognitionId: string | null,
  model: ModelSnapshot,
  appellation: string | null | undefined,
): Promise<ReferenceOutcome | null> {
  const ref = await lookupAppellation(appellation);
  if (!ref) return null;

  const rows: Array<{
    recognition_id: string;
    appellation_matched: string;
    appellation_match_score: number;
    field: CheckField;
    model_value: unknown;
    reference_value: unknown;
    agrees: boolean | null;
    overlap_count: number | null;
    reference_count: number | null;
  }> = [];

  const push = (
    field: CheckField,
    modelValue: unknown,
    referenceValue: unknown,
    agrees: boolean | null,
    overlap: number | null = null,
    refCount: number | null = null,
  ) => {
    if (!recognitionId) return;
    rows.push({
      recognition_id: recognitionId,
      appellation_matched: ref.name,
      appellation_match_score: ref.score,
      field,
      model_value: modelValue ?? null,
      reference_value: referenceValue ?? null,
      agrees,
      overlap_count: overlap,
      reference_count: refCount,
    });
  };

  // country / region: plain value comparison
  if (model.country && ref.country) {
    push("country", model.country, ref.country, valuesEquivalent(model.country, ref.country));
  }
  if (model.region && ref.region) {
    push("region", model.region, ref.region, valuesEquivalent(model.region, ref.region));
  }
  // colour: the model's wine_type against the reference's typical colour
  if (model.wine_type && ref.typical_colour) {
    push("typical_colour", model.wine_type, ref.typical_colour, valuesEquivalent(model.wine_type, ref.typical_colour));
  }
  // grapes: any overlap counts as agreement, the model may name a subset
  const modelGrapes = toGrapeArray(model.grapes);
  if (modelGrapes.length && ref.grapes.length) {
    const refSet = new Set(ref.grapes.map(normGrape));
    const overlap = new Set(modelGrapes.map(normGrape).filter((g) => refSet.has(g))).size;
    push("grapes", modelGrapes, ref.grapes, overlap > 0, overlap, ref.grapes.length);
  }

  if (rows.length) {
    const { error } = await supabase.from("inference_checks").insert(rows as never);
    if (error) console.error("inference_checks insert failed", error);
  }

  // Fill gaps only where the model said nothing
  const fills: ReferenceOutcome["fills"] = {};
  if (!model.country && ref.country) fills.country = ref.country;
  if (!model.region && ref.region) fills.region = ref.region;
  if (!model.wine_type && ref.typical_colour && COLOUR_LABEL[ref.typical_colour]) {
    fills.wine_type = ref.typical_colour;
  }

  const grapeSuggestions = modelGrapes.length === 0 ? ref.grapes : [];

  const disagreements: Disagreement[] = [];
  if (
    model.wine_type &&
    ref.typical_colour &&
    !valuesEquivalent(model.wine_type, ref.typical_colour)
  ) {
    disagreements.push({
      field: "wine_type",
      modelValue: model.wine_type,
      referenceValue: ref.typical_colour,
      note: `The label reading says ${COLOUR_LABEL[model.wine_type] ?? model.wine_type}, but Wikipedia lists ${ref.name} as ${COLOUR_LABEL[ref.typical_colour] ?? ref.typical_colour}. Worth checking.`,
    });
  }
  if (model.country && ref.country && !valuesEquivalent(model.country, ref.country)) {
    disagreements.push({
      field: "country",
      modelValue: model.country,
      referenceValue: ref.country,
      note: `The label reading says ${model.country}, but Wikipedia places ${ref.name} in ${ref.country}. Worth checking.`,
    });
  }

  return { ref, fills, grapeSuggestions, disagreements };
}

/** Record what the user actually settled on for a disputed field. */
export async function recordUserResolution(
  recognitionId: string | null,
  field: "wine_type" | "country",
  value: string | null,
): Promise<void> {
  if (!recognitionId) return;
  const checkField: CheckField = field === "wine_type" ? "typical_colour" : "country";
  const { error } = await supabase
    .from("inference_checks")
    .update({ user_resolved_to: value } as never)
    .eq("recognition_id", recognitionId)
    .eq("field", checkField);
  if (error) console.error("inference_checks resolution failed", error);
}
