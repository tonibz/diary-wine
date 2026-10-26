import { test, expect } from "bun:test";
import { ANNOTATED_PREFIXES, EVAL_CONDITIONS, parseRecognitionResponse, promptHash, storagePhotoPath, strictPrompt } from "./eval-utils";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./recognise.functions.ts", import.meta.url), "utf8");
const current = source.match(/export const RECOGNISE_PROMPT = `([\s\S]*?)`;/)?.[1];

test("strict prompt changes exactly the two required passages", () => {
  if (!current) throw new Error("Production prompt not found");
  const strict = strictPrompt(current);
  expect(strict).toContain("- inferred_fields: array naming every field whose value is not literally printed on the label(s) you were given.");
  expect(strict).toContain("so you may infer missing fields, but you must list in inferred_fields every field you did not read literally on the label.");
  expect(strict.replace("- inferred_fields: array naming every field whose value is not literally printed on the label(s) you were given. This includes anything you derived from the appellation, the grape, the region or general knowledge, for example the country from a region name or wine_type from a grape variety. A field whose value is printed must not be listed.", "- inferred_fields: array naming any field you filled in from knowledge of the appellation rather than reading it off the label").replace("so you may infer missing fields, but you must list in inferred_fields every field you did not read literally on the label.", "so you may infer those from the appellation, but you must list every field you inferred in inferred_fields.")).toBe(current);
});
test("missing either substitution fails closed", () => {
  expect(() => strictPrompt("missing")).toThrow("inferred_fields substitution");
  if (!current) throw new Error("Production prompt not found");
  expect(() => strictPrompt(current.replace("so you may infer those", "missing"))).toThrow("inference rule substitution");
});
test("signed front and back values normalize to bare paths", () => {
  expect(storagePhotoPath("https://example.test/storage/v1/object/sign/wine-photos/user/front.jpg?token=redacted")).toBe("user/front.jpg");
  expect(storagePhotoPath("user/back.jpg?token=redacted")).toBe("user/back.jpg");
  expect(storagePhotoPath(" ")).toBeNull();
});
test("hash uses exact prompt bytes and first 16 sha256 hex digits", async () => {
  expect(await promptHash("abc")).toBe("ba7816bf8f01cfea");
  expect(await promptHash("abc\n")).not.toBe(await promptHash("abc"));
});
test("parser keeps production first-text-block and fence behavior", () => {
  expect(parseRecognitionResponse({ content: [{ type: "thinking" }, { type: "text", text: '```json\n{"name":"Wine"}\n```' }, { type: "text", text: "ignored" }] })).toEqual({ name: "Wine" });
  expect(() => parseRecognitionResponse({ content: [{ type: "text", text: "invalid" }] })).toThrow();
  expect(parseRecognitionResponse({ content: [{ type: "text", text: "null" }] })).toBeNull();
});
test("fixed experiment conditions and all 49 annotated prefixes are retained", () => {
  expect(EVAL_CONDITIONS).toEqual(["A_current_front_back", "B_current_front", "C_strict_front"]);
  expect(ANNOTATED_PREFIXES.size).toBe(49);
  expect(ANNOTATED_PREFIXES.has("c988f613")).toBe(true);
  expect(ANNOTATED_PREFIXES.has("bb1f0b3d")).toBe(true);
});