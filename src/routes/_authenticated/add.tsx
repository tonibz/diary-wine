import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { recogniseLabel, type RecognitionData } from "@/lib/recognise.functions";
import { compressImage } from "@/lib/image-compress";
import { recomputeTasteProfile } from "@/lib/taste-profile";
import { getSignedPhotoUrl } from "@/lib/wine-photo";
import {
  findBestMatch,
  fillEmptyWineFields,
  logAlias,
  logDecision,
  type WineCandidate,
  type WineDraft,
} from "@/lib/wine-match";
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
import { ArrowLeft, Camera, X, Loader2, Info } from "lucide-react";
import { format } from "date-fns";

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
  const [photoDisplayUrl, setPhotoDisplayUrl] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [recognising, setRecognising] = useState(false);
  const [bottle, setBottle] = useState<BottleForm>(emptyBottle);
  const [dataSource, setDataSource] = useState<"label" | "inferred" | "user">("user");
  const [inferredFields, setInferredFields] = useState<string[]>([]);
  const [recognitionId, setRecognitionId] = useState<string | null>(null);
  const [modelData, setModelData] = useState<RecognitionData | null>(null);
  const [rating, setRating] = useState(0);
  const [tastedOn, setTastedOn] = useState(format(new Date(), "yyyy-MM-dd"));
  const [place, setPlace] = useState("");
  const [company, setCompany] = useState("");
  const [notes, setNotes] = useState("");
  const [grapeInput, setGrapeInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [mergePrompt, setMergePrompt] = useState<{
    candidate: WineCandidate;
    draft: WineDraft;
  } | null>(null);

  const bottleFieldsFilled = [
    bottle.name, bottle.producer, bottle.appellation, bottle.region, bottle.country,
    bottle.vintage, bottle.wine_type, bottle.grapes.length ? "g" : "", bottle.alcohol_percent,
  ].filter(Boolean).length;

  async function onPhoto(file: File) {
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
      setPhotoPath(path);
      setPhotoDisplayUrl(await getSignedPhotoUrl(path));

      const result = await recognise({ data: { photoPath: path } });
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

  function addGrape() {
    const g = grapeInput.trim();
    if (!g) return;
    if (!bottle.grapes.includes(g)) setBottle({ ...bottle, grapes: [...bottle.grapes, g] });
    setGrapeInput("");
  }

  function buildDraft(): WineDraft {
    return {
      name: bottle.name.trim(),
      producer: bottle.producer.trim() || null,
      appellation: bottle.appellation.trim() || null,
      region: bottle.region.trim() || null,
      country: bottle.country.trim() || null,
      vintage: bottle.vintage ? Number(bottle.vintage) : null,
      wine_type: bottle.wine_type || null,
      grapes: bottle.grapes,
      alcohol_percent: bottle.alcohol_percent ? Number(bottle.alcohol_percent) : null,
      label_image_url: photoPath, // storage path, not signed URL
      data_source: dataSource,
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
        vintage: draft.vintage,
        wine_type: draft.wine_type as never,
        grapes: draft.grapes,
        alcohol_percent: draft.alcohol_percent,
        label_image_url: draft.label_image_url,
        data_source: draft.data_source as never,
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

    // Create entry
    const { data: entry, error: entryErr } = await supabase.from("entries").insert({
      user_id: uid,
      wine_id: wineId,
      photo_url: photoPath, // storage path
      rating: rating || null,
      tasted_on: tastedOn,
      place: place.trim() || null,
      company: company.trim() || null,
      notes: notes.trim() || null,
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

    await recomputeTasteProfile(uid);
    toast.success("Saved to your diary.");
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

      const candidate = await findBestMatch(draft.name, draft.producer, draft.vintage);

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

      <section className="space-y-4 mt-8">
        <h2 className="text-lg font-serif text-foreground">My tasting</h2>
        <Field label="Rating">
          <StarRating value={rating} onChange={setRating} size={28} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={tastedOn} onChange={(e) => setTastedOn(e.target.value)} /></Field>
          <Field label="Place"><Input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Restaurant, home…" /></Field>
        </div>
        <Field label="With whom"><Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Optional" /></Field>
        <Field label="Notes"><Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How did it taste? What did it remind you of?" /></Field>
      </section>

      <Button onClick={onSave} disabled={saving} className="w-full mt-8 h-12 text-base">
        {saving ? "Saving…" : "Save to my diary"}
      </Button>

      <AlertDialog open={!!mergePrompt}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Is this the same wine?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  We already have a wine that looks very close. Should we log this bottle against
                  the existing one, or is it actually different?
                </p>
                {mergePrompt && (
                  <div className="rounded-lg border border-border bg-parchment p-3 space-y-0.5">
                    <p className="font-serif text-base text-foreground">
                      {mergePrompt.candidate.name}
                      {mergePrompt.candidate.vintage ? ` · ${mergePrompt.candidate.vintage}` : ""}
                    </p>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

// silence unused-import warning if effect not used
void useEffect;
