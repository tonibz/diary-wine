import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { MODEL_NAME, RECOGNISE_PROMPT } from "./recognise.functions";
import { EVAL_CONDITIONS, objectValue, parseRecognitionResponse, promptHash, storagePhotoPath, strictPrompt } from "./eval-utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { toError } from "./to-error";

export const STRICT_PROMPT = strictPrompt(RECOGNISE_PROMPT);
export const JUDGE_MODEL = "claude-opus-5";
export const JUDGE_PROMPT = `You are auditing photographs of wine bottle labels. You will receive one photo of the front label and, possibly, a second photo of the back label. Your job is only to report what is literally printed and legible in each photo. Do not use any knowledge about wine to fill gaps. Do not guess.

For EACH photo separately, and for each field below, report whether the information is printed and legible in that photo, and if so transcribe it.

Fields: name, producer, appellation, region, country, vintage, wine_type, grapes, alcohol_percent.

Strict rules for what counts as printed:
- country counts only if the country name itself appears, or a phrase such as "Product of Chile" or "Wine of Spain". A region, state or city name (for example Napa Valley, California, Rioja) does NOT count as the country.
- wine_type counts only if a colour or style word appears, for example "red wine", "vino tinto", "blanc", "rosé", "sparkling", "brut". A grape variety does NOT count as the wine type.
- grapes counts only if a grape variety name appears.
- appellation means the legally defined origin (for example Rioja DOCa, Chablis, Napa Valley). A slogan or marketing phrase is not an appellation.
- If text is present but not legible, use printed = null.

Return ONLY this JSON, no prose, no code fences:
{
  "front": { "<field>": { "printed": true | false | null, "text": "<transcription or null>" }, ... for all 9 fields },
  "back":  { same shape, or null if no second photo was provided }
}`;

type Client = SupabaseClient<Database>;
type Outcome = { raw: Json | null; parsed: Record<string, unknown> | null; error: string | null; input_tokens: number | null; output_tokens: number | null; halt: boolean };
export type EvalResult = { skipped: boolean; error?: string | null; input_tokens?: number | null; output_tokens?: number | null; halt?: boolean };

async function loadPhotos(client: Client, userId: string, recognitionId: string) {
  const { data: recognition, error } = await client.from("recognitions")
    .select("photo_path, entry_id").eq("id", recognitionId).eq("user_id", userId).single();
  if (error) throw toError(error);
  if (!recognition?.entry_id) throw new Error("Recognition has no linked entry");
  const { data: entry, error: entryError } = await client.from("entries")
    .select("back_photo_url").eq("id", recognition.entry_id).eq("user_id", userId).single();
  if (entryError) throw toError(entryError);
  const front = storagePhotoPath(recognition.photo_path);
  if (!front) throw new Error("Recognition has no front photo");
  return { front, back: storagePhotoPath(entry?.back_photo_url) };
}

async function callModel(client: Client, paths: string[], prompt: string, model: string, maxTokens: number): Promise<Outcome> {
  const outcome: Outcome = { raw: null, parsed: null, error: null, input_tokens: null, output_tokens: null, halt: false };
  try {
    const apiKey = process.env['LOVABLE_API_KEY'];
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { createLovableAiGatewayRunIdFetch } = await import("./eval-run-id.server");
    const content: import("@anthropic-ai/sdk/resources/messages").ContentBlockParam[] = [];
    for (const path of paths) {
      const { data, error } = await client.storage.from("wine-photos").download(path);
      if (error || !data) throw new Error("Could not read the evaluation photo");
      content.push({ type: "image", source: { type: "base64", media_type: (data.type || "image/jpeg") as "image/jpeg", data: Buffer.from(await data.arrayBuffer()).toString("base64") } });
    }
    content.push({ type: "text", text: prompt });
    const gateway = createLovableAiGatewayRunIdFetch();
    const anthropic = new Anthropic({ apiKey, baseURL: "https://ai.gateway.lovable.dev", maxRetries: 0,
      defaultHeaders: { "X-Lovable-AIG-SDK": "anthropic-sdk" }, fetch: gateway.fetch });
    const raw = await anthropic.messages.stream({ model: `anthropic/${model}`, max_tokens: maxTokens, messages: [{ role: "user", content }] }).finalMessage();
    outcome.raw = JSON.parse(JSON.stringify(raw)) as Json;
    outcome.input_tokens = raw.usage.input_tokens;
    outcome.output_tokens = raw.usage.output_tokens;
    if (raw.stop_reason === "refusal") {
      outcome.error = "The model refused this request.";
      outcome.halt = true;
      return outcome;
    }
    outcome.parsed = parseRecognitionResponse(raw);
    if (!outcome.parsed) outcome.error = "Model response was not a JSON object";
  } catch (error) {
    const details = objectValue(error);
    const status = details?.status;
    const body = objectValue(details?.error);
    const safeMessage = objectValue(body?.error)?.message ?? body?.message;
    outcome.error = typeof safeMessage === "string" ? safeMessage : toError(error).message;
    if (body) outcome.raw = JSON.parse(JSON.stringify(body)) as Json;
    // No automatic retries or continuation after provider/configuration failures.
    outcome.halt = typeof status === "number" || outcome.error.includes("not configured");
    if (status === 402 || status === 403) outcome.error = `[ACCESS_PAUSED] ${outcome.error}`;
  }
  return outcome;
}

async function checkAccess(client: Client) {
  // Durable pause across reloads: an owner must restore access before a fresh Run.
  for (const table of ["eval_runs", "eval_judgements"] as const) {
    const { data, error } = await client.from(table).select("error").like("error", "[ACCESS_PAUSED]%").limit(1);
    if (error) throw toError(error);
    if (data?.length) return data[0]?.error;
  }
  return null;
}

export const runEvalRecognition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ recognitionId: z.uuid(), condition: z.enum(EVAL_CONDITIONS) }).parse(input))
  .handler(async ({ data, context }): Promise<EvalResult> => {
    const { supabase, userId } = context;
    const prompt = data.condition === "C_strict_front" ? STRICT_PROMPT : RECOGNISE_PROMPT;
    const hash = await promptHash(prompt);
    const { data: existing, error } = await supabase.from("eval_runs").select("id").eq("recognition_id", data.recognitionId).eq("condition", data.condition).eq("prompt_hash", hash).maybeSingle();
    if (error) throw toError(error);
    if (existing) return { skipped: true };
    const paths = await loadPhotos(supabase, userId, data.recognitionId);
    if (data.condition === "A_current_front_back" && !paths.back) return { skipped: true };
    const paused = await checkAccess(supabase);
    if (paused) return { skipped: true, error: paused, halt: true };
    const selected = data.condition === "A_current_front_back" && paths.back ? [paths.front, paths.back] : [paths.front];
    const outcome = await callModel(supabase, selected, prompt, MODEL_NAME, 1000);
    const { error: insertError } = await supabase.from("eval_runs").insert({ recognition_id: data.recognitionId, condition: data.condition, model_name: MODEL_NAME, prompt_hash: hash, raw_response: outcome.raw, parsed: outcome.parsed as Json | null, error: outcome.error, input_tokens: outcome.input_tokens, output_tokens: outcome.output_tokens });
    if (insertError) throw toError(insertError);
    return { skipped: false, error: outcome.error, input_tokens: outcome.input_tokens, output_tokens: outcome.output_tokens, halt: outcome.halt };
  });

const judgeFields = ["name", "producer", "appellation", "region", "country", "vintage", "wine_type", "grapes", "alcohol_percent"] as const;
function validJudgement(value: unknown) {
  const object = objectValue(value);
  return object && judgeFields.every((field) => {
    const item = objectValue(object[field]);
    return item && (item.printed === true || item.printed === false || item.printed === null) && (typeof item.text === "string" || item.text === null);
  });
}

export const runEvalJudgement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ recognitionId: z.uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<EvalResult> => {
    const { supabase, userId } = context;
    const hash = await promptHash(JUDGE_PROMPT);
    const { data: existing, error } = await supabase.from("eval_judgements").select("id").eq("recognition_id", data.recognitionId).eq("judge_model", JUDGE_MODEL).eq("prompt_hash", hash).maybeSingle();
    if (error) throw toError(error);
    if (existing) return { skipped: true };
    const paths = await loadPhotos(supabase, userId, data.recognitionId);
    const paused = await checkAccess(supabase);
    if (paused) return { skipped: true, error: paused, halt: true };
    const outcome = await callModel(supabase, paths.back ? [paths.front, paths.back] : [paths.front], JUDGE_PROMPT, JUDGE_MODEL, 4096);
    const front = outcome.parsed?.front;
    const back = paths.back ? outcome.parsed?.back : null;
    if (!outcome.error && (!validJudgement(front) || (paths.back && !validJudgement(back)))) outcome.error = "Judge response did not contain all nine annotated fields";
    const { error: insertError } = await supabase.from("eval_judgements").insert({ recognition_id: data.recognitionId, judge_model: JUDGE_MODEL, prompt_hash: hash, raw_response: outcome.raw, front: validJudgement(front) ? front as Json : null, back: paths.back && validJudgement(back) ? back as Json : null, error: outcome.error, input_tokens: outcome.input_tokens, output_tokens: outcome.output_tokens });
    if (insertError) throw toError(insertError);
    return { skipped: false, error: outcome.error, input_tokens: outcome.input_tokens, output_tokens: outcome.output_tokens, halt: outcome.halt };
  });

export const getEvalOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [currentHash, strictHash, judgeHash] = await Promise.all([promptHash(RECOGNISE_PROMPT), promptHash(STRICT_PROMPT), promptHash(JUDGE_PROMPT)]);
    const recognitions = [];
    // Page explicitly to avoid silently truncating the corpus at the Data API limit.
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.from("recognitions").select("id, raw_response, entries!inner(back_photo_url)").eq("user_id", userId).not("entry_id", "is", null).order("id").range(offset, offset + 499);
      if (error) throw toError(error);
      for (const row of data ?? []) {
        try {
          const parsed = parseRecognitionResponse(row.raw_response);
          if (parsed) recognitions.push({ id: row.id, hasBack: Boolean(storagePhotoPath(row.entries.back_photo_url)) });
        } catch { /* Invalid original JSON is not eligible. */ }
      }
      if ((data?.length ?? 0) < 500) break;
    }
    const runs = [];
    const judgements = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.from("eval_runs").select("recognition_id, condition, prompt_hash, error, input_tokens, output_tokens").order("id").range(offset, offset + 499);
      if (error) throw toError(error);
      runs.push(...(data ?? []));
      if ((data?.length ?? 0) < 500) break;
    }
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.from("eval_judgements").select("recognition_id, judge_model, prompt_hash, error, input_tokens, output_tokens").order("id").range(offset, offset + 499);
      if (error) throw toError(error);
      judgements.push(...(data ?? []));
      if ((data?.length ?? 0) < 500) break;
    }
    return { recognitions, runs: runs.filter((r) => r.prompt_hash === (r.condition === "C_strict_front" ? strictHash : currentHash)), judgements: judgements.filter((j) => j.prompt_hash === judgeHash && j.judge_model === JUDGE_MODEL) };
  });