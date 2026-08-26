import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { recogniseLabel, type RecognitionData } from "@/lib/recognise.functions";
import { compareLabels } from "@/lib/compare-labels.functions";
import {
  candidateLabelPath,
  compareLabelsVisually,
  type CompareFn,
  type VisualVerdict,
} from "@/lib/label-compare";
import { getSignedPhotoUrls } from "@/lib/wine-photo";
import { compressImage } from "@/lib/image-compress";
import { readPhotoMeta, reverseGeocode } from "@/lib/photo-meta";
import { recomputeTasteProfile } from "@/lib/taste-profile";
import { getSignedPhotoUrl } from "@/lib/wine-photo";
import { localeCurrency, CURRENCY_OPTIONS } from "@/lib/currency";
import {
  findBestMatch,
  findOrCreateVintage,
  fillEmptyWineFields,
  logAlias,
  logDecision,
  type MatchDecision,
  type WineCandidate,
  type WineDraft,
} from "@/lib/wine-match";
import {
  buildFieldSources,
  rowDataSource,
  diffCorrections,
  mergeFieldSources,
} from "@/lib/field-provenance";
import {
  checkAgainstReference,
  recordUserResolution,
  type ReferenceOutcome,
} from "@/lib/appellation-check";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StarRating } from "@/components/StarRating";
import { toast } from "sonner";
import { ArrowLeft, Camera, X, Loader2, Info, ImagePlus, Images, ScrollText } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { withTimeout } from "@/lib/with-timeout";
import { useTranslation } from "react-i18next";
import { wineTypeOptions } from "@/lib/wine-type";
import { i18next } from "@/i18n";

export const Route = createFileRoute("/_authenticated/add")({
  head: () => ({ meta: [{ title: `${i18next.t("add.title")} — Wine Diary` }, { name: "description", content: i18next.t("add.title") }] }),
  component: AddPage,
});

type BottleForm = {
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

const emptyBottle: BottleForm = {
  name: "", producer: "", appellation: "", region: "", country: "",
  vintage: "", wine_type: "", grapes: [], alcohol_percent: "",
};

function AddPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const recognise = useServerFn(recogniseLabel);
  const compare = useServerFn(compareLabels) as unknown as CompareFn;
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const backCameraRef = useRef<HTMLInputElement>(null);
  const backLibraryRef = useRef<HTMLInputElement>(null);

  const [photoDisplayUrl, setPhotoDisplayUrl] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [backPhotoDisplayUrl, setBackPhotoDisplayUrl] = useState<string | null>(null);
  const [backPhotoPath, setBackPhotoPath] = useState<string | null>(null);
  const [recognising, setRecognising] = useState(false);
  const [bottle, setBottle] = useState<BottleForm>(emptyBottle);
  const [dataSource, setDataSource] = useState<"label" | "inferred" | "user">("user");
  const [inferredFields, setInferredFields] = useState<string[]>([]);
  const [recognitionId, setRecognitionId] = useState<string | null>(null);
  const [modelData, setModelData] = useState<RecognitionData | null>(null);
  const [status, setStatus] = useState<"tasted" | "interested">("tasted");
  const [rating, setRating] = useState(0);
  const [tastedOn, setTastedOn] = useState(format(new Date(), "yyyy-MM-dd"));
  const [tastedFromPhoto, setTastedFromPhoto] = useState(false);
  const [place, setPlace] = useState("");
  const [placeFromPhoto, setPlaceFromPhoto] = useState(false);
  const [company, setCompany] = useState("");
  const [notes, setNotes] = useState("");
  const [pricePaid, setPricePaid] = useState("");
  const [priceCurrency, setPriceCurrency] = useState(localeCurrency());
  const [priceContext, setPriceContext] = useState("");
  const [grapeInput, setGrapeInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [refCheck, setRefCheck] = useState<ReferenceOutcome | null>(null);
  const [referenceValues, setReferenceValues] = useState<Record<string, unknown>>({});
  const [mergePrompt, setMergePrompt] = useState<{
    candidate: WineCandidate;
    draft: WineDraft;
    /** the visual check's verdict, when it ran but was not confident enough */
    visual: VisualVerdict | null;
    candidatePhotoUrl: string | null;
    newPhotoUrl: string | null;
  } | null>(null);

  const tasted = status === "tasted";

  // Fields the model worked out rather than read — the ones most worth checking.
  const inferredSet = new Set(inferredFields.map((f) => f.trim().toLowerCase()));
  const check = (field: string) => {
    if (referenceValues[field] !== undefined) return t("add.fromWikipedia");
    return inferredSet.has(field) ? t("add.guessedCheck") : undefined;
  };
  const disagreement = (field: "wine_type" | "country") =>
    refCheck?.disagreements.find((d) => d.field === field) ?? null;

  /** Check the model's inferences against the appellations reference table. */
  async function runReferenceCheck(recId: string | null, data: RecognitionData) {
    try {
      const outcome = await checkAgainstReference(
        recId,
        {
          country: data.country,
          region: data.region,
          wine_type: data.wine_type,
          grapes: data.grapes ?? [],
        },
        data.appellation,
      );
      if (!outcome) return;
      setRefCheck(outcome);
      if (Object.keys(outcome.fills).length) {
        setReferenceValues((prev) => ({ ...prev, ...outcome.fills }));
        // Fill gaps only — never override what the model or the user provided.
        setBottle((b) => ({
          ...b,
          country: b.country || outcome.fills.country || "",
          region: b.region || outcome.fills.region || "",
          wine_type: b.wine_type || outcome.fills.wine_type || "",
        }));
      }
    } catch (e) {
      console.error("appellation reference check failed", e);
    }
  }


  const bottleFieldsFilled = [
    bottle.name, bottle.producer, bottle.appellation, bottle.region, bottle.country,
    bottle.vintage, bottle.wine_type, bottle.grapes.length ? "g" : "", bottle.alcohol_percent,
  ].filter(Boolean).length;

  async function prefillFromMeta(file: File) {
    // CRITICAL: read EXIF from the ORIGINAL file, before compression re-encodes it.
    const meta = await readPhotoMeta(file);
    if (meta.takenAt) {
      setTastedOn(format(meta.takenAt, "yyyy-MM-dd"));
      setTastedFromPhoto(true);
    }
    if (meta.gps) {
      // Only reverse-geocode if the user opted in.
      const { data: userRes } = await supabase.auth.getUser();
      if (userRes.user) {
        const { data: p } = await supabase
          .from("profiles")
          .select("gps_lookup_enabled")
          .eq("id", userRes.user.id)
          .maybeSingle();
        if (p?.gps_lookup_enabled) {
          const name = await reverseGeocode(meta.gps.lat, meta.gps.lon);
          if (name) {
            setPlace(name);
            setPlaceFromPhoto(true);
          }
        }
      }
    }
  }

  async function onPhoto(file: File) {
    try {
      setRecognising(true);
      // 1. EXIF first, on the original file
      prefillFromMeta(file).catch(() => {});
      // 2. Then compress + upload
      const compressed = await compressImage(file);
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user!.id;
      const path = `${uid}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("wine-photos").upload(path, compressed, {
        contentType: "image/jpeg",
      });
      if (up.error) throw up.error;
      setPhotoPath(path);
      setPhotoDisplayUrl(await getSignedPhotoUrl(path));

      const result = await withTimeout(
        recognise({ data: { photoPath: path, backPhotoPath: backPhotoPath } }),
        120_000,
        t("add.toast.readTimeout"),
      );
      if (result.recognition_id) setRecognitionId(result.recognition_id);
      if (result.ok && result.data.confidence >= 0.6) {
        setModelData(result.data);
        setBottle({
          name: result.data.name ?? "",
          producer: result.data.producer ?? "",
          appellation: result.data.appellation ?? "",
          region: result.data.region ?? "",
          country: result.data.country ?? "",
          vintage: result.data.vintage ? String(result.data.vintage) : "",
          wine_type: result.data.wine_type ?? "",
          grapes: result.data.grapes ?? [],
          alcohol_percent: result.data.alcohol_percent ? String(result.data.alcohol_percent) : "",
        });
        setInferredFields(result.data.inferred_fields ?? []);
        setDataSource(result.data.inferred_fields?.length ? "inferred" : "label");
        await runReferenceCheck(result.recognition_id ?? null, result.data);
      } else {
        toast(t("add.toast.couldntRead"));
        setDataSource("user");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("add.toast.uploadFailed"));
    } finally {
      setRecognising(false);
    }
  }

  async function onBackPhoto(file: File) {
    try {
      setRecognising(true);
      const compressed = await compressImage(file);
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user!.id;
      const path = `${uid}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("wine-photos").upload(path, compressed, {
        contentType: "image/jpeg",
      });
      if (up.error) throw up.error;
      setBackPhotoPath(path);
      setBackPhotoDisplayUrl(await getSignedPhotoUrl(path));

      // If we already have a front photo, re-run recognition with both.
      if (photoPath) {
        const result = await withTimeout(
          recognise({ data: { photoPath, backPhotoPath: path } }),
          120_000,
          t("add.toast.readTimeout"),
        );
        if (result.recognition_id) setRecognitionId(result.recognition_id);
        if (result.ok && result.data.confidence >= 0.6) {
          setModelData(result.data);
          setBottle((b) => ({
            name: b.name || result.data.name || "",
            producer: b.producer || result.data.producer || "",
            appellation: b.appellation || result.data.appellation || "",
            region: b.region || result.data.region || "",
            country: b.country || result.data.country || "",
            vintage: b.vintage || (result.data.vintage ? String(result.data.vintage) : ""),
            wine_type: b.wine_type || result.data.wine_type || "",
            grapes: b.grapes.length ? b.grapes : (result.data.grapes ?? []),
            alcohol_percent:
              b.alcohol_percent ||
              (result.data.alcohol_percent ? String(result.data.alcohol_percent) : ""),
          }));
          setInferredFields(result.data.inferred_fields ?? []);
          setDataSource(result.data.inferred_fields?.length ? "inferred" : "label");
          await runReferenceCheck(result.recognition_id ?? null, result.data);
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("add.toast.uploadFailed"));
    } finally {
      setRecognising(false);
    }
  }


  function addGrape() {
    const g = grapeInput.trim();
    if (!g) return;
    if (!bottle.grapes.includes(g)) setBottle({ ...bottle, grapes: [...bottle.grapes, g] });
    setGrapeInput("");
  }

  function buildDraft(): WineDraft {
    const userValues: Record<string, unknown> = {
      name: bottle.name.trim(),
      producer: bottle.producer.trim(),
      appellation: bottle.appellation.trim(),
      region: bottle.region.trim(),
      country: bottle.country.trim(),
      vintage: bottle.vintage ? Number(bottle.vintage) : null,
      wine_type: bottle.wine_type,
      grapes: bottle.grapes,
      alcohol_percent: bottle.alcohol_percent ? Number(bottle.alcohol_percent) : null,
    };
    const sources = buildFieldSources(
      modelData as unknown as Record<string, unknown> | null,
      userValues,
      inferredFields,
      referenceValues,
    );
    return {
      name: bottle.name.trim(),
      producer: bottle.producer.trim() || null,
      appellation: bottle.appellation.trim() || null,
      classification: (modelData?.classification ?? null) || null,
      region: bottle.region.trim() || null,
      country: bottle.country.trim() || null,
      wine_type: bottle.wine_type || null,
      grapes: bottle.grapes,
      label_image_url: null, // privacy: never contribute personal photos to shared catalogue
      data_source: rowDataSource(sources),
      field_sources: sources,
      vintage: bottle.vintage ? Number(bottle.vintage) : null,
      alcohol_percent: bottle.alcohol_percent ? Number(bottle.alcohol_percent) : null,
    };
  }

  async function insertNewWine(draft: WineDraft, uid: string): Promise<string> {
    const { data: wine, error } = await supabase
      .from("wines")
      .insert({
        name: draft.name,
        producer: draft.producer,
        appellation: draft.appellation,
        classification: draft.classification,
        region: draft.region,
        country: draft.country,
        wine_type: draft.wine_type as never,
        grapes: draft.grapes,
        label_image_url: draft.label_image_url,
        data_source: draft.data_source as never,
        field_sources: draft.field_sources as never,
        created_by: uid,
      })
      .select("id")
      .single();
    if (error) throw error;
    return wine.id;
  }

  async function finalizeSave(
    wineId: string,
    draft: WineDraft,
    uid: string,
    decision: MatchDecision,
    candidate: WineCandidate | null,
    visual?: VisualVerdict | null,
  ) {
    // Alias log (every save)
    await logAlias(wineId, draft.name, draft.producer, draft.data_source, uid);
    // Decision log
    await logDecision(
      uid,
      draft.name,
      draft.producer,
      draft.vintage,
      { id: candidate?.id ?? null, score: candidate?.score ?? null },
      decision,
      visual
        ? {
            same_wine: visual.comparison.same_wine,
            confidence: visual.comparison.confidence,
            reason: visual.comparison.reason,
          }
        : null,
    );

    // Find or create the vintage row underneath the wine
    const vintageId = await findOrCreateVintage(wineId, draft.vintage, draft.alcohol_percent);

    // Create entry
    const { data: entry, error: entryErr } = await supabase.from("entries").insert({
      user_id: uid,
      wine_vintage_id: vintageId,
      status,
      photo_url: photoPath, // storage path
      back_photo_url: backPhotoPath,
      rating: tasted ? rating || null : null,
      tasted_on: tasted ? tastedOn : format(new Date(), "yyyy-MM-dd"),
      place: tasted ? place.trim() || null : null,
      company: tasted ? company.trim() || null : null,
      notes: notes.trim() || null,
      price_paid: pricePaid ? Number(pricePaid) : null,
      price_currency: pricePaid ? priceCurrency : null,
      price_context: (priceContext || null) as never,
    }).select("id").single();
    if (entryErr) throw entryErr;

    if (recognitionId && modelData) {
      const m = modelData as unknown as Record<string, unknown>;
      // Only genuine differences count: a model null against an empty array is not a correction.
      const diffs = diffCorrections([
        ["name", m.name, draft.name],
        ["producer", m.producer, draft.producer],
        ["appellation", m.appellation, draft.appellation],
        ["region", m.region, draft.region],
        ["country", m.country, draft.country],
        ["vintage", m.vintage, draft.vintage],
        ["wine_type", m.wine_type, draft.wine_type],
        ["grapes", m.grapes, draft.grapes],
        ["alcohol_percent", m.alcohol_percent, draft.alcohol_percent],
      ]);
      await supabase.from("recognitions")
        .update({
          entry_id: entry.id,
          corrected_fields: diffs as never,
        })
        .eq("id", recognitionId);
    }

    // The user's own choice on a disputed field is the most valuable signal we have.
    if (recognitionId && refCheck?.disagreements.length) {
      for (const d of refCheck.disagreements) {
        const value = d.field === "wine_type" ? draft.wine_type : draft.country;
        await recordUserResolution(recognitionId, d.field, value ?? null);
      }
    }



    if (tasted) await recomputeTasteProfile(uid);
    toast.success(tasted ? t("add.toast.savedDiary") : t("add.toast.savedWishlist"));
    navigate({ to: "/entry/$id", params: { id: entry.id } });
  }

  async function onSave() {
    if (!bottle.name.trim()) {
      toast.error(t("add.toast.nameRequired"));
      return;
    }
    setSaving(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user!.id;
      const draft = buildDraft();

      // Matching is wine-level now: the year no longer splits a wine in two.
      const candidate = await findBestMatch(draft.name, draft.producer);

      if (candidate && candidate.score >= 0.85) {
        await fillEmptyWineFields(candidate.id, draft);
        await mergeFieldSources(candidate.id, draft.field_sources, { onlyMissing: true });
        await finalizeSave(candidate.id, draft, uid, "auto_merge", candidate);
        return;
      }
      if (candidate && candidate.score >= 0.6) {
        // Ambiguous band only: let the labels themselves settle it before asking.
        const candPath = await candidateLabelPath(candidate.id);
        const visual = await compareLabelsVisually(compare, candPath, photoPath);

        if (visual?.outcome === "merge") {
          await fillEmptyWineFields(candidate.id, draft);
          await mergeFieldSources(candidate.id, draft.field_sources, { onlyMissing: true });
          await finalizeSave(candidate.id, draft, uid, "auto_merge_visual", candidate, visual);
          return;
        }
        if (visual?.outcome === "new") {
          const newId = await insertNewWine(draft, uid);
          await finalizeSave(newId, draft, uid, "auto_new_visual", candidate, visual);
          return;
        }

        // Still unclear — ask, but show both labels.
        const [candidatePhotoUrl, newPhotoUrl] = await getSignedPhotoUrls([candPath, photoPath]);
        setMergePrompt({ candidate, draft, visual, candidatePhotoUrl, newPhotoUrl });
        return;
      }
      // Below 0.6 or no candidate → new row
      const wineId = await insertNewWine(draft, uid);
      await finalizeSave(wineId, draft, uid, "auto_new", candidate);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("add.toast.saveFailed"));
      setSaving(false);
    }
  }

  async function confirmMerge(sameWine: boolean) {
    if (!mergePrompt) return;
    const { candidate, draft, visual } = mergePrompt;
    setMergePrompt(null);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user!.id;
      if (sameWine) {
        await fillEmptyWineFields(candidate.id, draft);
        await mergeFieldSources(candidate.id, draft.field_sources, { onlyMissing: true });
        await finalizeSave(candidate.id, draft, uid, "user_merge", candidate, visual);
      } else {
        const wineId = await insertNewWine(draft, uid);
        await finalizeSave(wineId, draft, uid, "user_rejected", candidate, visual);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("add.toast.saveFailed"));
      setSaving(false);
    }
  }

  return (
    <div className="px-5 pt-6 pb-8">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigate({ to: "/diary" })} className="p-2 -ml-2 text-muted-foreground">
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-2xl font-serif text-primary">Add a wine</h1>
        <span className="w-8" />
      </div>

      {/* Tasted or just curious? */}
      <div className="mb-5 rounded-2xl bg-card p-2 border border-border shadow-notebook">
        <div className="grid grid-cols-2 gap-2">
          {([
            ["tasted", "I tasted this"],
            ["interested", "Haven't tried it yet"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              className={cn(
                "rounded-xl py-2.5 text-sm transition-colors",
                status === value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-card p-4 shadow-notebook border border-border mb-5">
        {photoDisplayUrl ? (
          <div className="relative">
            <img src={photoDisplayUrl} alt="label" className="w-full h-56 object-cover rounded-lg" />
            <button
              onClick={() => { setPhotoDisplayUrl(null); setPhotoPath(null); }}
              className="absolute top-2 right-2 bg-background/90 rounded-full p-1"
            >
              <X size={18} />
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              className="h-28 flex-col gap-2"
              onClick={() => cameraRef.current?.click()}
            >
              <Camera size={24} />
              <span className="text-sm">Take a photo</span>
            </Button>
            <Button
              variant="outline"
              className="h-28 flex-col gap-2"
              onClick={() => libraryRef.current?.click()}
            >
              <Images size={24} />
              <span className="text-sm">Choose from library</span>
            </Button>
          </div>
        )}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = ""; }}
        />
        <input
          ref={libraryRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = ""; }}
        />

        {/* Back label — optional, does not block saving */}
        <div className="mt-3">
          {backPhotoDisplayUrl ? (
            <div className="relative">
              <img src={backPhotoDisplayUrl} alt="back label" className="w-full h-36 object-cover rounded-lg" />
              <button
                onClick={() => { setBackPhotoDisplayUrl(null); setBackPhotoPath(null); }}
                className="absolute top-2 right-2 bg-background/90 rounded-full p-1"
              >
                <X size={16} />
              </button>
              <span className="absolute bottom-2 left-2 text-[10px] uppercase tracking-wide bg-background/90 rounded px-1.5 py-0.5 text-muted-foreground">
                Back label
              </span>
            </div>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                Back label (optional — helps with alcohol % and grapes)
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={() => backCameraRef.current?.click()}>
                  <Camera size={14} /> Take a photo
                </Button>
                <Button variant="outline" size="sm" onClick={() => backLibraryRef.current?.click()}>
                  <ImagePlus size={14} /> Choose from library
                </Button>
              </div>
            </>
          )}
          <input
            ref={backCameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onBackPhoto(f); e.target.value = ""; }}
          />
          <input
            ref={backLibraryRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onBackPhoto(f); e.target.value = ""; }}
          />
        </div>


        {recognising && (
          <p className="mt-3 flex items-center gap-2 text-sm text-primary">
            <Loader2 size={16} className="animate-spin" /> Reading the label…
          </p>
        )}
        {dataSource === "inferred" && inferredFields.length > 0 && !recognising && (
          <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
            <Info size={14} className="mt-0.5 shrink-0" />
            <span>
              Some fields ({inferredFields.join(", ")}) were worked out from the appellation
              rather than read off the label — do check them.
            </span>
          </p>
        )}
      </div>

      {/* Got a backlog on your phone? */}
      <button
        onClick={() => navigate({ to: "/bulk" })}
        className="mb-5 flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left shadow-notebook hover:border-primary/40"
      >
        <Images size={20} className="text-primary shrink-0" />
        <span className="min-w-0">
          <span className="block text-sm font-medium">Import several photos</span>
          <span className="block text-xs text-muted-foreground">
            Read a whole gallery of labels at once, then review and save.
          </span>
        </span>
      </button>

      {/* Handed a wine list? */}
      <button
        onClick={() => navigate({ to: "/menu" })}
        className="mb-5 flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left shadow-notebook hover:border-primary/40"
      >
        <ScrollText size={20} className="text-primary shrink-0" />
        <span className="min-w-0">
          <span className="block text-sm font-medium">Scan a menu</span>
          <span className="block text-xs text-muted-foreground">
            Photograph a restaurant wine list and see what to order.
          </span>
        </span>
      </button>



      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-serif text-foreground">The bottle</h2>
          <span className="text-xs text-muted-foreground">{bottleFieldsFilled} of 9 filled in</span>
        </div>

        <Field label="Name *" hint={check("name")}><Input value={bottle.name} onChange={(e) => setBottle({ ...bottle, name: e.target.value })} /></Field>
        <Field label="Producer" hint={check("producer")}><Input value={bottle.producer} onChange={(e) => setBottle({ ...bottle, producer: e.target.value })} /></Field>
        <Field label="Appellation" hint={check("appellation")}><Input value={bottle.appellation} onChange={(e) => setBottle({ ...bottle, appellation: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Region" hint={check("region")}><Input value={bottle.region} onChange={(e) => setBottle({ ...bottle, region: e.target.value })} /></Field>
          <Field label="Country" hint={check("country")}><Input value={bottle.country} onChange={(e) => setBottle({ ...bottle, country: e.target.value })} /></Field>
        </div>
        {disagreement("country") && (
          <Conflict
            note={disagreement("country")!.note}
            options={[disagreement("country")!.modelValue, disagreement("country")!.referenceValue]}
            current={bottle.country}
            onPick={(v) => setBottle({ ...bottle, country: v })}
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vintage" hint={check("vintage")}><Input type="number" inputMode="numeric" value={bottle.vintage} onChange={(e) => setBottle({ ...bottle, vintage: e.target.value })} /></Field>
          <Field label="Type" hint={check("wine_type")}>
            <Select value={bottle.wine_type} onValueChange={(v) => setBottle({ ...bottle, wine_type: v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="red">Red</SelectItem>
                <SelectItem value="white">White</SelectItem>
                <SelectItem value="rose">Rosé</SelectItem>
                <SelectItem value="sparkling">Sparkling</SelectItem>
                <SelectItem value="dessert">Dessert</SelectItem>
                <SelectItem value="fortified">Fortified</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        {disagreement("wine_type") && (
          <Conflict
            note={disagreement("wine_type")!.note}
            options={[disagreement("wine_type")!.modelValue, disagreement("wine_type")!.referenceValue]}
            current={bottle.wine_type}
            onPick={(v) => setBottle({ ...bottle, wine_type: v })}
          />
        )}
        <Field label="Grapes" hint={check("grapes")}>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {bottle.grapes.map((g) => (
              <span key={g} className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs">
                {g}
                <button onClick={() => setBottle({ ...bottle, grapes: bottle.grapes.filter((x) => x !== g) })}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Type a grape and press Enter"
              value={grapeInput}
              onChange={(e) => setGrapeInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addGrape(); } }}
            />
            <Button type="button" variant="secondary" onClick={addGrape}>Add</Button>
          </div>
          {refCheck && refCheck.grapeSuggestions.length > 0 && bottle.grapes.length === 0 && (
            <div className="mt-2 rounded-xl border border-border bg-parchment p-3">
              <p className="text-xs text-muted-foreground">
                Wikipedia lists these grapes as permitted in {refCheck.ref.name}. This bottle may only
                use some of them, so tap the ones that apply.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {refCheck.grapeSuggestions.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() =>
                      setBottle((b) => (b.grapes.includes(g) ? b : { ...b, grapes: [...b.grapes, g] }))
                    }
                    className="rounded-full border border-primary/30 px-2.5 py-1 text-xs text-primary hover:bg-primary/10"
                  >
                    + {g}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Field>
        <Field label="Alcohol %" hint={check("alcohol_percent")}><Input type="number" step="0.1" inputMode="decimal" value={bottle.alcohol_percent} onChange={(e) => setBottle({ ...bottle, alcohol_percent: e.target.value })} /></Field>
      </section>

      {tasted ? (
        <section className="space-y-4 mt-8">
          <h2 className="text-lg font-serif text-foreground">My tasting</h2>
          <Field label="Rating">
            <StarRating value={rating} onChange={setRating} size={28} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" hint={tastedFromPhoto ? "From photo" : undefined}>
              <Input type="date" value={tastedOn} onChange={(e) => { setTastedOn(e.target.value); setTastedFromPhoto(false); }} />
            </Field>
            <Field label="Place" hint={placeFromPhoto ? "From photo" : undefined}>
              <Input value={place} onChange={(e) => { setPlace(e.target.value); setPlaceFromPhoto(false); }} placeholder="Restaurant, home…" />
            </Field>
          </div>
          <Field label="With whom"><Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Optional" /></Field>
          <Field label="Notes"><Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How did it taste? What did it remind you of?" /></Field>
        </section>
      ) : (
        <section className="space-y-4 mt-8">
          <h2 className="text-lg font-serif text-foreground">A note to yourself</h2>
          <p className="text-xs text-muted-foreground">
            Saw it somewhere and want to remember it? Jot down where, and we'll keep it on your wishlist.
          </p>
          <Field label="Note"><Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Spotted at the corner shop, my friend swears by it…" /></Field>
        </section>
      )}

      <PriceSection
        pricePaid={pricePaid}
        setPricePaid={setPricePaid}
        priceCurrency={priceCurrency}
        setPriceCurrency={setPriceCurrency}
        priceContext={priceContext}
        setPriceContext={setPriceContext}
      />

      <Button onClick={onSave} disabled={saving} className="w-full mt-8 h-12 text-base">
        {saving ? "Saving…" : tasted ? "Save to my diary" : "Add to my wishlist"}
      </Button>

      <AlertDialog open={!!mergePrompt}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Is this the same wine?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  Compare the two labels. Should we log this bottle against the existing wine, or is
                  it actually different? Different years of the same wine belong together.
                </p>
                {mergePrompt && (mergePrompt.candidatePhotoUrl || mergePrompt.newPhotoUrl) && (
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "Already in the catalogue", url: mergePrompt.candidatePhotoUrl },
                      { label: "This bottle", url: mergePrompt.newPhotoUrl },
                    ].map((p) => (
                      <div key={p.label} className="space-y-1">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {p.label}
                        </p>
                        {p.url ? (
                          <img
                            src={p.url}
                            alt={`${p.label} wine label`}
                            className="w-full h-56 object-cover rounded-lg border border-border bg-parchment"
                          />
                        ) : (
                          <div className="w-full h-56 rounded-lg border border-dashed border-border bg-parchment flex items-center justify-center text-xs text-muted-foreground px-2 text-center">
                            No photo
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {mergePrompt?.visual?.comparison.reason && (
                  <p className="text-xs text-foreground rounded-lg bg-primary/5 border border-primary/20 p-2">
                    {mergePrompt.visual.comparison.reason}
                  </p>
                )}
                {mergePrompt && (
                  <div className="rounded-lg border border-border bg-parchment p-3 space-y-0.5">
                    <p className="font-serif text-base text-foreground">{mergePrompt.candidate.name}</p>
                    {mergePrompt.candidate.producer && (
                      <p className="text-muted-foreground">{mergePrompt.candidate.producer}</p>
                    )}
                    {(mergePrompt.candidate.region || mergePrompt.candidate.country) && (
                      <p className="text-xs text-muted-foreground">
                        {[mergePrompt.candidate.region, mergePrompt.candidate.country].filter(Boolean).join(", ")}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground pt-1">
                      Match confidence {(mergePrompt.candidate.score * 100).toFixed(0)}%
                    </p>
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => confirmMerge(false)}>No, different wine</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmMerge(true)}>Yes, same wine</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function PriceSection({
  pricePaid, setPricePaid, priceCurrency, setPriceCurrency, priceContext, setPriceContext,
}: {
  pricePaid: string;
  setPricePaid: (v: string) => void;
  priceCurrency: string;
  setPriceCurrency: (v: string) => void;
  priceContext: string;
  setPriceContext: (v: string) => void;
}) {
  return (
    <section className="mt-8 rounded-2xl bg-card p-4 border border-border shadow-notebook space-y-3">
      <div>
        <h2 className="text-lg font-serif text-foreground">What it cost</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Entirely optional — skip it if you'd rather.</p>
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <Field label="Price">
          <Input
            type="number"
            step="0.01"
            inputMode="decimal"
            value={pricePaid}
            onChange={(e) => setPricePaid(e.target.value)}
            placeholder="Optional"
          />
        </Field>
        <Field label="Currency">
          <Select value={priceCurrency} onValueChange={setPriceCurrency}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CURRENCY_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field label="Where">
        <Select value={priceContext} onValueChange={setPriceContext}>
          <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="restaurant">Restaurant</SelectItem>
            <SelectItem value="shop">Shop</SelectItem>
            <SelectItem value="online">Online</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-sm text-muted-foreground">{label}</Label>
        {hint && <span className="text-[10px] uppercase tracking-wide text-primary/70">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** Model vs. reference disagreement — the user picks, and we record their choice. */
function Conflict({
  note,
  options,
  current,
  onPick,
}: {
  note: string;
  options: string[];
  current: string;
  onPick: (v: string) => void;
}) {
  const choices = Array.from(new Set(options.filter(Boolean)));
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
      <p className="flex items-start gap-2 text-xs text-foreground">
        <Info size={14} className="mt-0.5 shrink-0 text-primary" />
        <span>{note}</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {choices.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onPick(c)}
            className={cn(
              "rounded-full px-3 py-1 text-xs border",
              current === c
                ? "bg-primary text-primary-foreground border-primary"
                : "border-primary/30 text-primary hover:bg-primary/10",
            )}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}
