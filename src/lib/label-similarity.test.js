import { test, expect, mock } from "bun:test";

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