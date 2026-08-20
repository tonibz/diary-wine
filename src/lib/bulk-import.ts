import { supabase } from "@/integrations/supabase/client";
import {
  buildFieldSources,
  rowDataSource,
  diffCorrections,
  mergeFieldSources,
} from "@/lib/field-provenance";
import { compressImage } from "@/lib/image-compress";
import { readPhotoMeta, reverseGeocode } from "@/lib/photo-meta";
import { getSignedPhotoUrl } from "@/lib/wine-photo";
import type { RecognitionData } from "@/lib/recognise.functions";
import {
  findBestMatch,
  findOrCreateVintage,
  fillEmptyWineFields,
  logAlias,
  logDecision,
  type WineCandidate,
  type WineDraft,
} from "@/lib/wine-match";
import { format } from "date-fns";

export const BULK_STORAGE_KEY = "wine-diary:bulk-import:v1";

export type BulkFields = {
  name: string;
  producer: string;
  appellation: string;
  region: string;
  country: string;
  vintage: string;
  wine_type: string;
  grapes: string[];
  alcohol_percent: string;
};

export const emptyFields: BulkFields = {
  name: "", producer: "", appellation: "", region: "", country: "",
  vintage: "", wine_type: "", grapes: [], alcohol_percent: "",
};

export type BulkItem = {
  id: string;
  photoPath: string | null;
  thumbUrl: string | null;
  status: "pending" | "processing" | "done" | "failed";
  error: string | null;
  confidence: number | null;
  fields: BulkFields;
  inferredFields: string[];
  dataSource: "label" | "inferred" | "user";
  recognitionId: string | null;
  modelData: RecognitionData | null;
  tastedOn: string;
  dateFromPhoto: boolean;
  place: string;
  placeFromPhoto: boolean;
  notes: string;
  rating: number;
  entryStatus: "tasted" | "interested";
  discarded: boolean;
  /** EXIF capture time in ms, used to find front/back pairs */
  takenAtMs: number | null;
  /** classifier verdict for this photo */
  side: "front" | "back";
  sideReason: string | null;
  /** back label attached to this bottle */
  backPhotoPath: string | null;
  backThumbUrl: string | null;
  /** the item whose photo became this bottle's back label */
  pairedBackId: string | null;
  /** set on a back-label item that has been folded into another row */
  pairedIntoId: string | null;
  /** existing catalogue candidate in the ambiguous 0.6–0.85 band */
  candidate: (WineCandidate & { vintage?: number | null }) | null;
  candidateScore: number | null;
  /** user's answer to the inline "might be the same" prompt; default different */
  mergeChoice: "same" | "different";
  /** another item earlier in this same batch that looks like the same wine */
  dupOfId: string | null;
  dupOfScore: number | null;
  dupChoice: "same" | "different";
};

export function newItem(id: string): BulkItem {
  return {
    id,
    photoPath: null,
    thumbUrl: null,
    status: "pending",
    error: null,
    confidence: null,
    fields: { ...emptyFields, grapes: [] },
    inferredFields: [],
    dataSource: "user",
    recognitionId: null,
    modelData: null,
    tastedOn: format(new Date(), "yyyy-MM-dd"),
    dateFromPhoto: false,
    place: "",
    placeFromPhoto: false,
    notes: "",
    rating: 0,
    entryStatus: "tasted",
    discarded: false,
    takenAtMs: null,
    side: "front",
    sideReason: null,
    backPhotoPath: null,
    backThumbUrl: null,
    pairedBackId: null,
    pairedIntoId: null,
    candidate: null,
    candidateScore: null,
    mergeChoice: "different",
    dupOfId: null,
    dupOfScore: null,
    dupChoice: "different",
  };
}


/* ---------- persistence: survives leaving the screen ---------- */

export function saveProgress(items: BulkItem[], phase: string) {
  try {
    const slim = items.map((i) => ({ ...i, thumbUrl: null }));
    localStorage.setItem(BULK_STORAGE_KEY, JSON.stringify({ phase, items: slim, at: Date.now() }));
  } catch {
    /* quota — ignore */
  }
}

export function clearProgress() {
  try {
    localStorage.removeItem(BULK_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export async function loadProgress(): Promise<{ phase: string; items: BulkItem[] } | null> {
  try {
    const raw = localStorage.getItem(BULK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { phase: string; items: BulkItem[] };
    if (!parsed?.items?.length) return null;
    const items = await Promise.all(
      parsed.items.map(async (i) => ({ ...i, thumbUrl: await getSignedPhotoUrl(i.photoPath) })),
    );
    return { phase: parsed.phase, items };
  } catch {
    return null;
  }
}

/* ---------- local similarity, for within-batch duplicates ---------- */

const NOISE = [
  "domaine", "chateau", "château", "bodega", "bodegas", "celler", "cellar", "cellier",
  "tenuta", "weingut", "quintal", "pere et fils", "père et fils", "e figli", "grand vin",
  "mis en bouteille", "produce of france", "produit de france",
];

export function normalise(s: string | null | undefined): string {
  if (!s) return "";
  let t = s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  t = t.replace(/[^a-z0-9\s]/g, " ");
  for (const n of NOISE) t = t.replace(new RegExp(`\\b${n}\\b`, "g"), " ");
  return t.replace(/\s+/g, " ").trim();
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Trigram similarity, close enough to pg_trgm for in-batch comparison. */
export function similarity(a: string, b: string): number {
  const A = trigrams(normalise(a));
  const B = trigrams(normalise(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  A.forEach((t) => { if (B.has(t)) shared++; });
  return shared / (A.size + B.size - shared);
}

export function batchScore(
  aName: string, aProducer: string,
  bName: string, bProducer: string,
): number {
  const nameSim = similarity(aName, bName);
  if (!aProducer.trim() || !bProducer.trim()) return nameSim;
  return 0.7 * nameSim + 0.3 * similarity(aProducer, bProducer);
}

/* ---------- per-photo processing (mirrors the single-photo flow) ---------- */

export type RecogniseFn = (args: {
  data: { photoPath: string; backPhotoPath?: string | null };
}) => Promise<Awaited<ReturnType<typeof import("@/lib/recognise.functions").recogniseLabel>>>;

/**
 * Step 1: EXIF, compress, upload. No API call — pairing is decided from these
 * results before any label is read.
 */
export async function uploadPhoto(
  file: File,
  uid: string,
  gpsEnabled: boolean,
): Promise<Partial<BulkItem>> {
  // EXIF first — compression re-encodes and destroys metadata.
  const meta = await readPhotoMeta(file);
  let tastedOn: string | null = null;
  let place: string | null = null;
  if (meta.takenAt) tastedOn = format(meta.takenAt, "yyyy-MM-dd");
  if (meta.gps && gpsEnabled) {
    place = await reverseGeocode(meta.gps.lat, meta.gps.lon);
  }

  const compressed = await compressImage(file);
  const path = `${uid}/${crypto.randomUUID()}.jpg`;
  const up = await supabase.storage.from("wine-photos").upload(path, compressed, {
    contentType: "image/jpeg",
  });
  if (up.error) throw up.error;

  return {
    photoPath: path,
    thumbUrl: await getSignedPhotoUrl(path),
    takenAtMs: meta.takenAt ? meta.takenAt.getTime() : null,
    ...(tastedOn ? { tastedOn, dateFromPhoto: true } : {}),
    ...(place ? { place, placeFromPhoto: true } : {}),
  };
}

/** Step 2: read the label. Sends the back photo too when the bottle is paired. */
export async function recogniseItem(
  item: BulkItem,
  recognise: RecogniseFn,
): Promise<Partial<BulkItem>> {
  if (!item.photoPath) return { status: "failed", error: "Photo is no longer available" };
  const result = await recognise({
    data: { photoPath: item.photoPath, backPhotoPath: item.backPhotoPath },
  });

  const base: Partial<BulkItem> = { recognitionId: result.recognition_id ?? null };

  if (!result.ok) {
    return { ...base, status: "failed", error: result.error, confidence: null };
  }

  const d = result.data;
  return {
    ...base,
    status: "done",
    error: null,
    confidence: d.confidence,
    modelData: d,
    inferredFields: d.inferred_fields ?? [],
    dataSource: d.inferred_fields?.length ? "inferred" : "label",
    fields: {
      name: d.name ?? "",
      producer: d.producer ?? "",
      appellation: d.appellation ?? "",
      region: d.region ?? "",
      country: d.country ?? "",
      vintage: d.vintage ? String(d.vintage) : "",
      wine_type: d.wine_type ?? "",
      grapes: d.grapes ?? [],
      alcohol_percent: d.alcohol_percent ? String(d.alcohol_percent) : "",
    },
  };
}

/** Photos taken within this window are candidates for being one bottle. */
export const PAIR_WINDOW_MS = 2 * 60 * 1000;

/**
 * Pairs each back label with the nearest front label taken within two minutes.
 * Returns a patch map; nothing is paired silently — the review screen shows it.
 */
export function pairFrontsAndBacks(items: BulkItem[]): Map<string, Partial<BulkItem>> {
  const patches = new Map<string, Partial<BulkItem>>();
  const takenBack = new Set<string>();

  const backs = items.filter((i) => i.side === "back" && i.takenAtMs != null);
  for (const back of backs) {
    const fronts = items
      .filter(
        (i) =>
          i.side === "front" &&
          i.takenAtMs != null &&
          !patches.get(i.id)?.pairedBackId &&
          !i.pairedBackId &&
          Math.abs((i.takenAtMs as number) - (back.takenAtMs as number)) <= PAIR_WINDOW_MS,
      )
      .sort(
        (a, b) =>
          Math.abs((a.takenAtMs as number) - (back.takenAtMs as number)) -
          Math.abs((b.takenAtMs as number) - (back.takenAtMs as number)),
      );
    const front = fronts.find((f) => !takenBack.has(f.id));
    if (!front) continue;
    takenBack.add(front.id);
    patches.set(front.id, {
      ...(patches.get(front.id) ?? {}),
      pairedBackId: back.id,
      backPhotoPath: back.photoPath,
      backThumbUrl: back.thumbUrl,
    });
    patches.set(back.id, { ...(patches.get(back.id) ?? {}), pairedIntoId: front.id });
  }
  return patches;
}


/* ---------- saving ---------- */

export function draftOf(item: BulkItem): WineDraft {
  const f = item.fields;
  const userValues: Record<string, unknown> = {
    name: f.name.trim(),
    producer: f.producer.trim(),
    appellation: f.appellation.trim(),
    region: f.region.trim(),
    country: f.country.trim(),
    vintage: f.vintage ? Number(f.vintage) : null,
    wine_type: f.wine_type,
    grapes: f.grapes,
    alcohol_percent: f.alcohol_percent ? Number(f.alcohol_percent) : null,
  };
  const sources = buildFieldSources(
    (item.modelData as unknown as Record<string, unknown> | null) ?? null,
    userValues,
    item.inferredFields ?? [],
  );
  return {
    name: f.name.trim(),
    producer: f.producer.trim() || null,
    appellation: f.appellation.trim() || null,
    region: f.region.trim() || null,
    country: f.country.trim() || null,
    wine_type: f.wine_type || null,
    grapes: f.grapes,
    label_image_url: null, // privacy: personal photos stay out of the shared catalogue
    data_source: rowDataSource(sources),
    field_sources: sources,
    vintage: f.vintage ? Number(f.vintage) : null,
    alcohol_percent: f.alcohol_percent ? Number(f.alcohol_percent) : null,
  };
}

async function insertWine(draft: WineDraft, uid: string): Promise<string> {
  const { data, error } = await supabase
    .from("wines")
    .insert({
      name: draft.name,
      producer: draft.producer,
      appellation: draft.appellation,
      region: draft.region,
      country: draft.country,
      wine_type: draft.wine_type as never,
      grapes: draft.grapes,
      label_image_url: null,
      data_source: draft.data_source as never,
      field_sources: draft.field_sources as never,
      created_by: uid,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Saves one reviewed row. Returns the wine id used, so in-batch duplicates can reuse it. */
export async function saveItem(
  item: BulkItem,
  uid: string,
  reuseWineId: string | null,
): Promise<string> {
  const draft = draftOf(item);
  let wineId: string;
  let decision: "auto_merge" | "user_merge" | "user_rejected" | "auto_new" = "auto_new";
  let candidate: WineCandidate | null = null;

  if (reuseWineId) {
    wineId = reuseWineId;
    decision = "user_merge";
  } else {
    candidate = await findBestMatch(draft.name, draft.producer);
    if (candidate && candidate.score >= 0.85) {
      await fillEmptyWineFields(candidate.id, draft);
      await mergeFieldSources(candidate.id, draft.field_sources, { onlyMissing: true });
      wineId = candidate.id;
      decision = "auto_merge";
    } else if (candidate && candidate.score >= 0.6 && item.mergeChoice === "same") {
      await fillEmptyWineFields(candidate.id, draft);
      await mergeFieldSources(candidate.id, draft.field_sources, { onlyMissing: true });
      wineId = candidate.id;
      decision = "user_merge";
    } else {
      wineId = await insertWine(draft, uid);
      decision = candidate && candidate.score >= 0.6 ? "user_rejected" : "auto_new";
    }
  }

  await logAlias(wineId, draft.name, draft.producer, draft.data_source, uid);
  await logDecision(
    uid,
    draft.name,
    draft.producer,
    draft.vintage,
    { id: candidate?.id ?? reuseWineId ?? null, score: candidate?.score ?? item.dupOfScore ?? null },
    decision,
  );

  const vintageId = await findOrCreateVintage(wineId, draft.vintage, draft.alcohol_percent);
  const tasted = item.entryStatus === "tasted";

  const { data: entry, error } = await supabase
    .from("entries")
    .insert({
      user_id: uid,
      wine_vintage_id: vintageId,
      status: item.entryStatus,
      photo_url: item.photoPath,
      back_photo_url: item.backPhotoPath,
      rating: tasted && item.rating > 0 ? item.rating : null,

      tasted_on: tasted ? item.tastedOn : format(new Date(), "yyyy-MM-dd"),
      place: tasted ? item.place.trim() || null : null,
      company: null,
      notes: item.notes.trim() || null,
    })
    .select("id")
    .single();
  if (error) throw error;

  if (item.recognitionId) {
    const m = (item.modelData as unknown as Record<string, unknown> | null) ?? null;
    const diffs = m
      ? diffCorrections([
          ["name", m.name, draft.name],
          ["producer", m.producer, draft.producer],
          ["appellation", m.appellation, draft.appellation],
          ["region", m.region, draft.region],
          ["country", m.country, draft.country],
          ["vintage", m.vintage, draft.vintage],
          ["wine_type", m.wine_type, draft.wine_type],
          ["grapes", m.grapes, draft.grapes],
          ["alcohol_percent", m.alcohol_percent, draft.alcohol_percent],
        ])
      : null;
    await supabase
      .from("recognitions")
      .update({ entry_id: entry.id, corrected_fields: diffs as never })
      .eq("id", item.recognitionId);
  }

  return wineId;
}
