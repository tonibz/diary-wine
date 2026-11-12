import { supabase } from "@/integrations/supabase/client";
import { captureClientError } from "./sentry-browser";
import { toError } from "./to-error";

export const MODEL_VERSION = "orb-1";
const OPENCV_URL = "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js";
const STOP = new Set("domaine chateau château bodega bodegas tenuta weingut cantina cantine azienda agricola vineyards vineyard winery wines wine estate cellars famille maison vigneti fattoria podere castello the de di del la le les el".split(" "));

function norm(t: string | null | undefined) {
  const s = (t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
  return s.split(/\s+/).filter((w) => w && !STOP.has(w)).join(" ");
}
function trigrams(t: string) {
  const out = new Set<string>();
  for (const w of t.split(" ").filter(Boolean)) {
    const p = "  " + w + " ";
    for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
  }
  return out;
}
function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

type TextInput = { newName?: string | null; newProducer?: string | null; candName?: string | null; candProducer?: string | null };
export type LabelPairInput = TextInput & { newPath: string; candidatePath: string };
export type LabelSimilarity = { version: typeof MODEL_VERSION; prob: number; inliers: number; textName: number; textProducer: number; ms: number };
export function textFeatures(input: TextInput) {
  const missing = (!(input.newName ?? "").trim() && !(input.newProducer ?? "").trim()) || (!(input.candName ?? "").trim() && !(input.candProducer ?? "").trim()) ? 1 : 0;
  return {
    missing,
    textName: missing ? 0 : jaccard(trigrams(norm(input.newName)), trigrams(norm(input.candName))),
    textProducer: missing ? 0 : jaccard(trigrams(norm(input.newProducer)), trigrams(norm(input.candProducer))),
  };
}
export function modelProbability(textName: number, textProducer: number, missing: number, inliers: number) {
  const logit = -10.5483 + 4.8903 * textName + 3.0941 * textProducer + 2.9513 * missing + 1.3221 * Math.log1p(inliers);
  return 1 / (1 + Math.exp(-logit));
}

interface Disposable { delete(): void }
interface Mat extends Disposable { rows: number; data: Uint8Array }
interface Keypoints extends Disposable { get(i: number): { pt: { x: number; y: number } } }
interface Match { distance: number; queryIdx: number; trainIdx: number }
interface MatchVector extends Disposable { size(): number; get(i: number): Match }
interface Matches extends Disposable { size(): number; get(i: number): MatchVector }
interface Cv {
  Mat: new () => Mat;
  KeyPointVector: new () => Keypoints;
  DMatchVectorVector: new () => Matches;
  ORB: new (count: number) => Disposable & { detectAndCompute(gray: Mat, mask: Mat, kp: Keypoints, ds: Mat): void };
  BFMatcher: new (norm: number, crossCheck: boolean) => Disposable & { knnMatch(a: Mat, b: Mat, matches: Matches, k: number): void };
  matFromImageData(data: ImageData): Mat;
  cvtColor(src: Mat, dst: Mat, code: number): void;
  matFromArray(rows: number, cols: number, type: number, points: number[]): Mat;
  findHomography(a: Mat, b: Mat, method: number, threshold: number, mask: Mat): Mat;
  COLOR_RGBA2GRAY: number; NORM_HAMMING: number; CV_32FC2: number; RANSAC: number;
}
declare global { interface Window { cv?: Cv } }
let cvPromise: Promise<{ cv: Cv }> | undefined;
export function loadOpenCv(): Promise<{ cv: Cv }> {
  if (typeof window === "undefined") return Promise.reject(new Error("OpenCV requires a browser"));
  if (cvPromise) return cvPromise;
  cvPromise = new Promise((resolve, reject) => {
    let poll: ReturnType<typeof setInterval>;
    const finish = (error?: Error) => {
      clearInterval(poll);
      clearTimeout(timeout);
      if (error) reject(error);
      // Emscripten's cv object is thenable; resolving it directly loops forever.
      else if (window.cv?.Mat) resolve({ cv: window.cv });
    };
    const timeout = setTimeout(() => finish(new Error("OpenCV load timeout")), 25_000);
    poll = setInterval(() => { if (window.cv?.Mat) finish(); }, 100);
    if (window.cv?.Mat) { finish(); return; }
    if (!document.querySelector('script[data-label-similarity]')) {
      const script = document.createElement("script");
      script.src = OPENCV_URL;
      script.async = true;
      script.dataset.labelSimilarity = "true";
      script.onerror = () => finish(new Error("OpenCV could not be loaded"));
      document.head.appendChild(script);
    }
  });
  return cvPromise;
}

// Self-contained: serialized into a Worker so ORB/RANSAC cannot stall saving/UI.
function orbInliers(cv: Cv, a: ImageData, b: ImageData): number {
  const owned: Disposable[] = [];
  function own<T extends Disposable>(value: T): T { owned.push(value); return value; }
  try {
    const srcA = own(cv.matFromImageData(a)), srcB = own(cv.matFromImageData(b));
    const grayA = own(new cv.Mat()), grayB = own(new cv.Mat());
    cv.cvtColor(srcA, grayA, cv.COLOR_RGBA2GRAY);
    cv.cvtColor(srcB, grayB, cv.COLOR_RGBA2GRAY);
    const orb = own(new cv.ORB(1500));
    const kpA = own(new cv.KeyPointVector()), kpB = own(new cv.KeyPointVector());
    const dsA = own(new cv.Mat()), dsB = own(new cv.Mat());
    const empty = own(new cv.Mat());
    orb.detectAndCompute(grayA, empty, kpA, dsA);
    orb.detectAndCompute(grayB, empty, kpB, dsB);
    if (dsA.rows < 8 || dsB.rows < 8) return 0;
    const matcher = own(new cv.BFMatcher(cv.NORM_HAMMING, false));
    const matches = own(new cv.DMatchVectorVector());
    matcher.knnMatch(dsA, dsB, matches, 2);
    const good: Match[] = [];
    for (let i = 0; i < matches.size(); i++) {
      const pair = matches.get(i);
      try {
        if (pair.size() < 2) continue;
        const d0 = pair.get(0), d1 = pair.get(1);
        if (d0.distance < 0.8 * d1.distance) good.push({ distance: d0.distance, queryIdx: d0.queryIdx, trainIdx: d0.trainIdx });
      } finally { pair.delete(); }
    }
    if (good.length < 8) return Math.floor(good.length / 4);
    const pointsA: number[] = [], pointsB: number[] = [];
    for (const m of good) {
      const aPt = kpA.get(m.queryIdx).pt, bPt = kpB.get(m.trainIdx).pt;
      pointsA.push(aPt.x, aPt.y); pointsB.push(bPt.x, bPt.y);
    }
    const p1 = own(cv.matFromArray(good.length, 1, cv.CV_32FC2, pointsA));
    const p2 = own(cv.matFromArray(good.length, 1, cv.CV_32FC2, pointsB));
    const mask = own(new cv.Mat());
    own(cv.findHomography(p1, p2, cv.RANSAC, 6.0, mask));
    let inliers = 0;
    for (const value of mask.data) if (value !== 0) inliers++;
    return inliers;
  } finally { for (const value of owned.reverse()) value.delete(); }
}

async function pixels(blob: Blob, signal: AbortSignal): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  try {
    signal.throwIfAborted();
    const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } finally { bitmap.close(); }
}

async function runOrb(a: ImageData, b: ImageData, signal: AbortSignal): Promise<number> {
  signal.throwIfAborted();
  const source = `importScripts(${JSON.stringify(OPENCV_URL)}); const compute = ${orbInliers.toString()}; onmessage = async ({data}) => { try { for(let i=0;i<250;i++){ if(self.cv?.Mat) break; await new Promise(r=>setTimeout(r,100)); } if(!self.cv?.Mat) throw new Error('OpenCV load timeout'); postMessage({inliers:compute(self.cv,data.a,data.b)}); } catch(e) { postMessage({error:e instanceof Error ? e.message : 'ORB failed'}); } };`;
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    return await new Promise<number>((resolve, reject) => {
      const worker = new Worker(url);
      const finish = (value?: number, error?: Error) => {
        worker.terminate(); signal.removeEventListener("abort", abort);
        if (error) reject(error); else resolve(value ?? 0);
      };
      const abort = () => finish(undefined, new Error("Label similarity timeout"));
      signal.addEventListener("abort", abort, { once: true });
      worker.onerror = () => finish(undefined, new Error("ORB worker failed"));
      worker.onmessage = (event: MessageEvent<{ inliers?: number; error?: string }>) => {
        if (event.data.error) finish(undefined, new Error(event.data.error));
        else finish(event.data.inliers);
      };
      worker.postMessage({ a, b }, [a.data.buffer, b.data.buffer]);
    });
  } finally { URL.revokeObjectURL(url); }
}

async function score(input: TextInput, blobs: (signal: AbortSignal) => Promise<[Blob, Blob]>): Promise<LabelSimilarity | null> {
  if (typeof window === "undefined") return null;
  const start = performance.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Label similarity timeout")); }, 30_000);
    });
    return await Promise.race([timeout, (async (): Promise<LabelSimilarity> => {
      await loadOpenCv();
      controller.signal.throwIfAborted();
      const [a, b] = await blobs(controller.signal);
      const [pa, pb] = await Promise.all([pixels(a, controller.signal), pixels(b, controller.signal)]);
      const inliers = await runOrb(pa, pb, controller.signal);
      const { textName, textProducer, missing } = textFeatures(input);
      return { version: MODEL_VERSION, prob: modelProbability(textName, textProducer, missing, inliers), inliers, textName, textProducer, ms: Math.round(performance.now() - start) };
    })()]);
  } catch (error) {
    captureClientError(toError(error), { area: "label-similarity" });
    return null;
  } finally { clearTimeout(timer); }
}

export function scoreLabelBlobs(input: TextInput & { newBlob: Blob; candidateBlob: Blob }) {
  return score(input, async () => [input.newBlob, input.candidateBlob]);
}
export function scoreLabelPair(input: LabelPairInput) {
  return score(input, async (signal) => {
    const download = async (path: string) => {
      signal.throwIfAborted();
      const { data, error } = await supabase.storage.from("wine-photos").download(path);
      signal.throwIfAborted();
      if (error) throw error;
      if (!data) throw new Error("Label photo is unavailable");
      return data;
    };
    return Promise.all([download(input.newPath), download(input.candidatePath)]);
  });
}

export function startShadowScore(id: string, input: LabelPairInput): void {
  if (typeof window === "undefined") return;
  // A later task, never awaited by the save path. Heavy computation uses a Worker.
  setTimeout(() => {
    void scoreLabelPair(input).then(async (result) => {
      if (!result) return;
      const { error } = await supabase.from("match_decisions").update({
        sim_model_version: result.version, sim_model_prob: result.prob,
        sim_orb_inliers: result.inliers, sim_text_name: result.textName,
        sim_text_producer: result.textProducer, sim_ms: result.ms,
      }).eq("id", id).abortSignal(AbortSignal.timeout(15_000));
      if (error) throw error;
    }).catch((error) => captureClientError(toError(error), { area: "label-similarity" }));
  }, 0);
}