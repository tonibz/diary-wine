import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { recogniseLabel, type RecognitionData } from "@/lib/recognise.functions";
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
  type WineCandidate,
  type WineDraft,
} from "@/lib/wine-match";
import {
  buildFieldSources,
  rowDataSource,
  diffCorrections,
  mergeFieldSources,
} from "@/lib/field-provenance";
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

export const Route = createFileRoute("/_authenticated/add")({
  head: () => ({ meta: [{ title: "Add a wine — Wine Diary" }, { name: "description", content: "Log a new bottle." }] }),
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
  const navigate = useNavigate();
  const recognise = useServerFn(recogniseLabel);
  const fileRef = useRef<HTMLInputElement>(null);
  const backFileRef = useRef<HTMLInputElement>(null);
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
  const [mergePrompt, setMergePrompt] = useState<{
    candidate: WineCandidate;
    draft: WineDraft;
  } | null>(null);

  const tasted = status === "tasted";

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

      const result = await recognise({ data: { photoPath: path, backPhotoPath: backPhotoPath } });
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
      } else {
        toast("Couldn't read that one clearly, fill it in below.");
        setDataSource("user");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
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
        const result = await recognise({ data: { photoPath, backPhotoPath: path } });
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
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
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
    );
    return {
      name: bottle.name.trim(),
      producer: bottle.producer.trim() || null,
      appellation: bottle.appellation.trim() || null,
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
    decision: "auto_merge" | "user_merge" | "user_rejected" | "auto_new",
    candidate: WineCandidate | null,
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
      const diffs: Record<string, { model: unknown; user: unknown }> = {};
      const compare: Array<[keyof RecognitionData, unknown]> = [
        ["name", draft.name],
        ["producer", draft.producer],
        ["appellation", draft.appellation],
        ["region", draft.region],
        ["country", draft.country],
        ["vintage", draft.vintage],
        ["wine_type", draft.wine_type],
        ["grapes", draft.grapes],
        ["alcohol_percent", draft.alcohol_percent],
      ];
      for (const [k, userVal] of compare) {
        const modelVal = (modelData as unknown as Record<string, unknown>)[k];
        if (JSON.stringify(modelVal ?? null) !== JSON.stringify(userVal ?? null)) {
          diffs[k as string] = { model: modelVal ?? null, user: userVal ?? null };
        }
      }
      await supabase.from("recognitions")
        .update({
          entry_id: entry.id,
          corrected_fields: (Object.keys(diffs).length ? diffs : null) as never,
        })
        .eq("id", recognitionId);
    }

    if (tasted) await recomputeTasteProfile(uid);
    toast.success(tasted ? "Saved to your diary." : "Added to your wishlist.");
    navigate({ to: "/entry/$id", params: { id: entry.id } });
  }

  async function onSave() {
    if (!bottle.name.trim()) {
      toast.error("A name is needed, even a rough one.");
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
        await finalizeSave(candidate.id, draft, uid, "auto_merge", candidate);
        return;
      }
      if (candidate && candidate.score >= 0.6) {
        // Ask the user; keep saving state until they decide
        setMergePrompt({ candidate, draft });
        return;
      }
      // Below 0.6 or no candidate → new row
      const wineId = await insertNewWine(draft, uid);
      await finalizeSave(wineId, draft, uid, "auto_new", candidate);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
      setSaving(false);
    }
  }

  async function confirmMerge(sameWine: boolean) {
    if (!mergePrompt) return;
    const { candidate, draft } = mergePrompt;
    setMergePrompt(null);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user!.id;
      if (sameWine) {
        await fillEmptyWineFields(candidate.id, draft);
        await finalizeSave(candidate.id, draft, uid, "user_merge", candidate);
      } else {
        const wineId = await insertNewWine(draft, uid);
        await finalizeSave(wineId, draft, uid, "user_rejected", candidate);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
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
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full h-40 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
          >
            <Camera size={28} />
            <span className="text-sm">Take or upload a photo of the label</span>
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(f); }}
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
            <button
              onClick={() => backFileRef.current?.click()}
              className="w-full h-16 rounded-lg border border-dashed border-border flex items-center justify-center gap-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary"
            >
              <ImagePlus size={16} />
              Add back label (optional — helps with alcohol % and grapes)
            </button>
          )}
          <input
            ref={backFileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onBackPhoto(f); }}
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
            Read a whole gallery of labels at once, review before saving.
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

        <Field label="Name *"><Input value={bottle.name} onChange={(e) => setBottle({ ...bottle, name: e.target.value })} /></Field>
        <Field label="Producer"><Input value={bottle.producer} onChange={(e) => setBottle({ ...bottle, producer: e.target.value })} /></Field>
        <Field label="Appellation"><Input value={bottle.appellation} onChange={(e) => setBottle({ ...bottle, appellation: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Region"><Input value={bottle.region} onChange={(e) => setBottle({ ...bottle, region: e.target.value })} /></Field>
          <Field label="Country"><Input value={bottle.country} onChange={(e) => setBottle({ ...bottle, country: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Vintage"><Input type="number" inputMode="numeric" value={bottle.vintage} onChange={(e) => setBottle({ ...bottle, vintage: e.target.value })} /></Field>
          <Field label="Type">
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
        <Field label="Grapes">
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
        </Field>
        <Field label="Alcohol %"><Input type="number" step="0.1" inputMode="decimal" value={bottle.alcohol_percent} onChange={(e) => setBottle({ ...bottle, alcohol_percent: e.target.value })} /></Field>
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
                  We already have a wine that looks very close. Should we log this bottle against
                  the existing one, or is it actually different? Different years of the same wine
                  belong together.
                </p>
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
