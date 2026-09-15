import { i18next } from "@/i18n";

/**
 * Internal column names must never reach the screen. Every field the model or
 * the reference can talk about maps to the label the user already sees on the
 * form, so a list of guessed fields reads like the form does.
 */
const FIELD_KEYS: Record<string, string> = {
  name: "add.field.name",
  wine_name: "add.field.name",
  producer: "add.field.producer",
  appellation: "add.field.appellation",
  region: "add.field.region",
  country: "add.field.country",
  vintage: "add.field.vintage",
  year: "add.field.vintage",
  wine_type: "add.field.type",
  type: "add.field.type",
  grapes: "add.field.grapes",
  alcohol_percent: "add.field.alcohol",
  alcohol: "add.field.alcohol",
};

/** Readable label for an internal field name, in the active language. */
export function fieldLabel(field: string): string {
  const key = FIELD_KEYS[field.trim().toLowerCase()];
  if (!key) return field;
  const label = i18next.t(key);
  return label === key ? field : label;
}

/** Comma-separated readable labels, lower-cased for use inside a sentence. */
export function fieldLabelList(fields: string[]): string {
  return fields
    .map((f) => fieldLabel(f).toLocaleLowerCase(i18next.language))
    .filter(Boolean)
    .join(", ");
}
