export const EVAL_CONDITIONS = ["A_current_front_back", "B_current_front", "C_strict_front"] as const;
export type EvalCondition = (typeof EVAL_CONDITIONS)[number];

export function storagePhotoPath(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const path = value.trim().split("/wine-photos/").pop()?.split("?")[0]?.trim();
  return path || null;
}

export function strictPrompt(current: string): string {
  const oldField = "- inferred_fields: array naming any field you filled in from knowledge of the appellation rather than reading it off the label";
  const newField = "- inferred_fields: array naming every field whose value is not literally printed on the label(s) you were given. This includes anything you derived from the appellation, the grape, the region or general knowledge, for example the country from a region name or wine_type from a grape variety. A field whose value is printed must not be listed.";
  const oldRule = "so you may infer those from the appellation, but you must list every field you inferred in inferred_fields.";
  const newRule = "so you may infer missing fields, but you must list in inferred_fields every field you did not read literally on the label.";
  const first = current.replace(oldField, newField);
  if (first === current) throw new Error("STRICT_PROMPT inferred_fields substitution not found");
  const second = first.replace(oldRule, newRule);
  if (second === first) throw new Error("STRICT_PROMPT inference rule substitution not found");
  return second;
}

export async function promptHash(prompt: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(prompt));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

export function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Same first text block, fence stripping and JSON parsing as production recognition. */
export function parseRecognitionResponse(raw: unknown): Record<string, unknown> | null {
  const blocks = objectValue(raw)?.content;
  const first = Array.isArray(blocks) ? blocks.find((b) => objectValue(b)?.type === "text") : null;
  const text = objectValue(first)?.text;
  const cleaned = (typeof text === "string" ? text : "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return objectValue(JSON.parse(cleaned));
}

export const ANNOTATED_PREFIXES = new Set(`c988f613 3767ad89 eacf6281 bedc18f1 8594fff1 8e2881ca 945ff922 5866a254 a5c701cc df25e8e4 aa3ba713 3f3df4cf eb6cfa18 46e61a83 6f8328b0 d0e37f8e 3985da83 9c4d19c6 ce35128e 41bc876b c90e50dd 489211bf 9a023b41 58ef4614 69553482 2cf4b883 291a76e6 ffe2fbff 4085f43f ffab2ddd c0c3a62c f6aa337d 99bc061c 73be7ba0 1dddbcbe daf40dcd b164b7e9 29bf375e 46d981f9 6d81d92a deb0e48a a15506f0 920b7733 abe8335e 7c75c6be 1855477c e8bc49a4 27f312e0 bb1f0b3d`.split(" "));