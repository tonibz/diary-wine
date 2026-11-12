import { test, expect, mock } from "bun:test";
import { readFileSync } from "node:fs";

let updates = [];
let updateError = null;
mock.module("@/integrations/supabase/client", () => ({ supabase: {
  from: () => ({ update: (patch) => ({ eq: (_, id) => ({ abortSignal: async () => { updates.push({ id, patch }); return { error: updateError }; } }) }) }),
} }));
const reports = [];
mock.module("./sentry-browser", () => ({ captureClientError: (...args) => reports.push(args) }));
const { textFeatures, modelProbability, scoreLabelBlobs, scoreLabelPair, MODEL_VERSION } = await import("./label-similarity");

test("orb-1 removes the supplied stop words and accents before per-word trigrams", () => {
  expect(MODEL_VERSION).toBe("orb-1");
  expect(textFeatures({ newName: "Château La ROSÉ", candName: "rose", newProducer: "Domaine Maison Alpha", candProducer: "Alpha Winery" })).toEqual({ missing: 0, textName: 1, textProducer: 1 });
});
test("Jaccard uses a set of padded trigrams for each word", () => {
  expect(textFeatures({ newName: "abc", candName: "abd", newProducer: "x", candProducer: "y" }).textName).toBe(1 / 3);
  expect(textFeatures({ newName: "abc abc", candName: "abc" }).textName).toBe(1);
});
test("an empty name AND producer on either side zeros both text features", () => {
  expect(textFeatures({ newName: "", newProducer: "", candName: "Alpha", candProducer: "Beta" })).toEqual({ missing: 1, textName: 0, textProducer: 0 });
  expect(textFeatures({ newName: "Alpha", newProducer: "Beta", candName: "", candProducer: "" })).toEqual({ missing: 1, textName: 0, textProducer: 0 });
});
test("model uses the exact supplied intercept and coefficients", () => {
  expect(modelProbability(0, 0, 0, 0)).toBeCloseTo(0.000026237359239183224, 12);
  const logit = -10.5483 + 4.8903 + 3.0941 + 2.9513 + 1.3221 * Math.log1p(12);
  expect(modelProbability(1, 1, 1, 12)).toBeCloseTo(1 / (1 + Math.exp(-logit)), 12);
});
test("server calls return null rather than accessing browser or storage", async () => {
  expect(await scoreLabelPair({ newPath: "a", candidatePath: "b" })).toBeNull();
  expect(await scoreLabelBlobs({ newBlob: new Blob(), candidateBlob: new Blob() })).toBeNull();
  expect(updates.length).toBe(0);
});

// Exercise the actual detached task with injected dependencies, never real writes.
const source = readFileSync(new URL("./label-similarity.ts", import.meta.url), "utf8");
const starter = source.slice(source.indexOf("export function startShadowScore"))
  .replace("export function", "function")
  .replace("id: string, input: LabelPairInput, candidateWineId?: string | null): void", "id, input, candidateWineId)");
const makeStarter = new Function("scoreLabelPair", "supabase", "captureClientError", "toError", "window", "setTimeout", `${starter}; return startShadowScore;`);
test("shadow scoring returns before a stalled score and writes only the six shadow columns", async () => {
  let complete;
  const pending = new Promise((resolve) => { complete = resolve; });
  let task;
  const writes = [];
  const db = { from: () => ({ update: (patch) => ({ eq: (_, id) => ({ abortSignal: async () => { writes.push({ id, patch }); return { error: null }; } }) }) }) };
  const start = makeStarter(() => pending, db, () => {}, (e) => e, {}, (callback) => { task = callback; });
  expect(start("decision-1", { newPath: "a", candidatePath: "b" })).toBeUndefined();
  expect(writes).toEqual([]);
  task();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(writes).toEqual([]);
  complete({ version: "orb-1", prob: 0.75, inliers: 24, textName: 0.6, textProducer: 0.9, ms: 123 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(writes).toEqual([{ id: "decision-1", patch: { sim_model_version: "orb-1", sim_model_prob: 0.75, sim_orb_inliers: 24, sim_text_name: 0.6, sim_text_producer: 0.9, sim_ms: 123 } }]);
});
test("null scores and failed writes never throw from the save task", async () => {
  let task;
  let reported = 0;
  const db = { from: () => ({ update: () => ({ eq: () => ({ abortSignal: async () => ({ error: new Error("write failed") }) }) }) }) };
  const start = makeStarter(async () => ({ prob: 0.2 }), db, () => reported++, (e) => e, {}, (callback) => { task = callback; });
  expect(start("decision-2", {})).toBeUndefined(); task();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(reported).toBe(1);
  const skip = makeStarter(async () => null, { from: () => { throw new Error("should not write"); } }, () => reported++, (e) => e, {}, (callback) => { task = callback; });
  skip("decision-3", {}); task();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(reported).toBe(1);
});