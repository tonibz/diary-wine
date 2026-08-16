import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { recogniseLabel } from "@/lib/recognise.functions";
import { findBestMatch } from "@/lib/wine-match";
import { recomputeTasteProfile } from "@/lib/taste-profile";
import {
  type BulkItem,
  type BulkFields,
  newItem,
  processPhoto,
  saveItem,
  batchScore,
  saveProgress,
  loadProgress,
  clearProgress,
} from "@/lib/bulk-import";
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
import { toast } from "sonner";
import {
  ArrowLeft, Images, X, Loader2, ChevronDown, ChevronRight, Trash2, Camera, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/bulk")({
  head: () => ({
    meta: [
      { title: "Import several photos — Wine Diary" },
      { name: "description", content: "Import a backlog of bottle photos from your gallery in one go." },
      { property: "og:title", content: "Import several photos — Wine Diary" },
      { property: "og:description", content: "Read a whole gallery of wine labels at once, then review before saving." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BulkPage,
});

type Phase = "pick" | "processing" | "review" | "saving";

const WINE_TYPES = ["red", "white", "rose", "sparkling", "dessert", "fortified"] as const;

function BulkPage() {
  const navigate = useNavigate();
  const recognise = useServerFn(recogniseLabel);
  const fileRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<Map<string, File>>(new Map());

  const [phase, setPhase] = useState<Phase>("pick");
  const [items, setItems] = useState<BulkItem[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [openGroups, setOpenGroups] = useState({ good: false, check: true, bad: true });

  /* restore an interrupted batch */
  useEffect(() => {
    let alive = true;
    loadProgress().then((saved) => {
      if (!alive || !saved) return;
      // Only recognised rows can be restored; un-uploaded files are gone with the page.
      const restorable = saved.items.filter((i) => i.photoPath);
      if (!restorable.length) return;
      setItems(restorable);
      setPhase("review");
      toast("Picked up where you left off.");
    });
    return () => { alive = false; };
  }, []);

  /* warn before navigating away mid-flight */
  useEffect(() => {
    if (phase !== "processing" && phase !== "saving") return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [phase]);

  function onPick(files: FileList) {
    const next: BulkItem[] = [];
    Array.from(files).forEach((f) => {
      const id = crypto.randomUUID();
      filesRef.current.set(id, f);
      const it = newItem(id);
      it.thumbUrl = URL.createObjectURL(f);
      next.push(it);
    });
    setItems((prev) => [...prev, ...next]);
  }

  function removePicked(id: string) {
    filesRef.current.delete(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  async function startProcessing() {
    setConfirmOpen(false);
    setPhase("processing");
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user!.id;
    const { data: profile } = await supabase
      .from("profiles")
      .select("gps_lookup_enabled")
      .eq("id", uid)
      .maybeSingle();
    const gpsEnabled = !!profile?.gps_lookup_enabled;

    // One at a time, deliberately serial to stay inside API rate limits.
    const working = [...items];
    for (let i = 0; i < working.length; i++) {
      setCurrentIdx(i);
      const item = working[i];
      setItems((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "processing" } : p)));
      const file = filesRef.current.get(item.id);
      let patch: Partial<BulkItem>;
      try {
        if (!file) throw new Error("Photo is no longer available");
        patch = await processPhoto(file, uid, gpsEnabled, recognise);
      } catch (e) {
        patch = { status: "failed", error: e instanceof Error ? e.message : "Failed to read this photo" };
      }
      let merged: BulkItem = { ...item, ...patch } as BulkItem;

      // Catalogue match, computed now so the review screen can prompt inline.
      if (merged.status === "done" && merged.fields.name.trim()) {
        try {
          const cand = await findBestMatch(merged.fields.name.trim(), merged.fields.producer.trim() || null);
          if (cand && cand.score >= 0.6) {
            merged = { ...merged, candidate: cand, candidateScore: cand.score };
          }
        } catch { /* matching is best-effort */ }

        // Duplicates within this same batch.
        for (let j = 0; j < i; j++) {
          const other = working[j];
          if (other.status !== "done" || !other.fields.name.trim() || other.dupOfId) continue;
          const s = batchScore(
            merged.fields.name, merged.fields.producer,
            other.fields.name, other.fields.producer,
          );
          if (s >= 0.6) {
            merged = {
              ...merged,
              dupOfId: other.id,
              dupOfScore: s,
              dupChoice: s >= 0.85 ? "same" : "different",
            };
            break;
          }
        }
      }

      working[i] = merged;
      setItems((prev) => prev.map((p) => (p.id === merged.id ? merged : p)));
      saveProgress(working, "review");
    }
    setPhase("review");
  }

  function patchItem(id: string, patch: Partial<BulkItem>) {
    setItems((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, ...patch } : p));
      saveProgress(next, "review");
      return next;
    });
  }

  function patchFields(id: string, patch: Partial<BulkFields>) {
    setItems((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, fields: { ...p.fields, ...patch } } : p));
      saveProgress(next, "review");
      return next;
    });
  }

  const keep = useMemo(() => items.filter((i) => !i.discarded), [items]);
  const groups = useMemo(() => {
    const byConf = (a: BulkItem, b: BulkItem) => (a.confidence ?? -1) - (b.confidence ?? -1);
    return {
      good: keep.filter((i) => i.status === "done" && (i.confidence ?? 0) >= 0.8).sort(byConf),
      check: keep
        .filter((i) => i.status === "done" && (i.confidence ?? 0) >= 0.6 && (i.confidence ?? 0) < 0.8)
        .sort(byConf),
      bad: keep
        .filter((i) => i.status === "failed" || (i.status === "done" && (i.confidence ?? 0) < 0.6))
        .sort(byConf),
    };
  }, [keep]);

  const savable = keep.filter((i) => i.fields.name.trim().length > 0);

  async function saveAll() {
    if (!savable.length) {
      toast.error("Give at least one of them a name first.");
      return;
    }
    setPhase("saving");
    setSavedCount(0);
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user!.id;
    const wineIdByItem = new Map<string, string>();
    let ok = 0;
    let failed = 0;
    let anyTasted = false;

    for (const item of savable) {
      try {
        const reuse =
          item.dupOfId && item.dupChoice === "same" ? wineIdByItem.get(item.dupOfId) ?? null : null;
        const wineId = await saveItem(item, uid, reuse);
        wineIdByItem.set(item.id, wineId);
        if (item.entryStatus === "tasted") anyTasted = true;
        ok++;
      } catch {
        failed++;
      }
      setSavedCount(ok + failed);
    }

    if (anyTasted) await recomputeTasteProfile(uid);
    clearProgress();
    toast.success(
      failed
        ? `Added ${ok} to your diary, ${failed} couldn't be saved.`
        : `Added ${ok} ${ok === 1 ? "wine" : "wines"} to your diary.`,
    );
    navigate({ to: "/diary" });
  }

  /* ---------------- render ---------------- */

  if (phase === "processing" || phase === "saving") {
    const total = phase === "processing" ? items.length : savable.length;
    const done = phase === "processing" ? currentIdx : savedCount;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const current = phase === "processing" ? items[currentIdx] : null;
    return (
      <div className="px-5 pt-10 pb-8">
        <h1 className="text-2xl font-serif text-primary mb-2">
          {phase === "processing" ? "Reading your labels" : "Saving"}
        </h1>
        <p className="text-sm text-muted-foreground mb-5">
          {phase === "processing"
            ? `Reading label ${Math.min(done + 1, total)} of ${total}`
            : `Saved ${done} of ${total}`}
        </p>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden mb-5">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        {current?.thumbUrl && (
          <img
            src={current.thumbUrl}
            alt="label being read"
            className="w-40 h-40 object-cover rounded-2xl shadow-notebook border border-border mx-auto"
          />
        )}
        <p className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="animate-spin" size={16} /> Please stay on this screen.
        </p>
      </div>
    );
  }

  if (phase === "review") {
    return (
      <div className="px-5 pt-6 pb-32">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => navigate({ to: "/diary" })} className="p-2 -ml-2 text-muted-foreground">
            <ArrowLeft size={22} />
          </button>
          <h1 className="text-2xl font-serif text-primary">Review</h1>
          <span className="w-8" />
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          Nothing is in your diary yet. Check the ones flagged below, then save.
        </p>

        <Section
          title="Looks good"
          count={groups.good.length}
          open={openGroups.good}
          onToggle={() => setOpenGroups((g) => ({ ...g, good: !g.good }))}
        >
          {groups.good.map((i) => (
            <Row key={i.id} item={i} items={items} expanded={!!expanded[i.id]}
              onExpand={() => setExpanded((e) => ({ ...e, [i.id]: !e[i.id] }))}
              patchItem={patchItem} patchFields={patchFields} />
          ))}
        </Section>

        <Section
          title="Worth checking"
          count={groups.check.length}
          open={openGroups.check}
          onToggle={() => setOpenGroups((g) => ({ ...g, check: !g.check }))}
        >
          {groups.check.map((i) => (
            <Row key={i.id} item={i} items={items} expanded={!!expanded[i.id]}
              onExpand={() => setExpanded((e) => ({ ...e, [i.id]: !e[i.id] }))}
              patchItem={patchItem} patchFields={patchFields} />
          ))}
        </Section>

        <Section
          title="Couldn't read these"
          count={groups.bad.length}
          open={openGroups.bad}
          onToggle={() => setOpenGroups((g) => ({ ...g, bad: !g.bad }))}
        >
          {groups.bad.map((i) => (
            <Row key={i.id} item={i} items={items} expanded
              onExpand={() => setExpanded((e) => ({ ...e, [i.id]: !e[i.id] }))}
              patchItem={patchItem} patchFields={patchFields} />
          ))}
        </Section>

        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <Button className="w-full h-12 rounded-xl" onClick={saveAll} disabled={!savable.length}>
            Add {savable.length} {savable.length === 1 ? "wine" : "wines"} to my diary
          </Button>
        </div>
      </div>
    );
  }

  /* pick phase */
  return (
    <div className="px-5 pt-6 pb-8">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigate({ to: "/add" })} className="p-2 -ml-2 text-muted-foreground">
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-2xl font-serif text-primary">Import several</h1>
        <span className="w-8" />
      </div>

      <div className="rounded-2xl bg-card p-4 shadow-notebook border border-border mb-5">
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full h-36 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
        >
          <Images size={28} />
          <span className="text-sm">Pick photos from your gallery</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files?.length) onPick(e.target.files); e.target.value = ""; }}
        />

        {items.length > 0 && (
          <>
            <p className="mt-4 mb-2 text-sm text-muted-foreground">
              {items.length} {items.length === 1 ? "photo" : "photos"} chosen
            </p>
            <div className="grid grid-cols-3 gap-2">
              {items.map((i) => (
                <div key={i.id} className="relative aspect-square">
                  {i.thumbUrl && (
                    <img src={i.thumbUrl} alt="chosen label" className="h-full w-full rounded-lg object-cover" />
                  )}
                  <button
                    onClick={() => removePicked(i.id)}
                    aria-label="Remove photo"
                    className="absolute top-1 right-1 rounded-full bg-background/90 p-1"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <Button
        className="w-full h-12 rounded-xl"
        disabled={!items.length}
        onClick={() => setConfirmOpen(true)}
      >
        Read {items.length || ""} {items.length === 1 ? "label" : "labels"}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ready?</AlertDialogTitle>
            <AlertDialogDescription>
              This will read {items.length} labels. Each one is an API call.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={startProcessing}>Start reading</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Section({
  title, count, open, onToggle, children,
}: {
  title: string; count: number; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  if (!count) return null;
  return (
    <div className="mb-5">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 py-2 text-left font-serif text-lg text-foreground"
      >
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        {title}
        <span className="text-sm font-sans text-muted-foreground">({count})</span>
      </button>
      {open && <div className="space-y-3">{children}</div>}
    </div>
  );
}

function Row({
  item, items, expanded, onExpand, patchItem, patchFields,
}: {
  item: BulkItem;
  items: BulkItem[];
  expanded: boolean;
  onExpand: () => void;
  patchItem: (id: string, patch: Partial<BulkItem>) => void;
  patchFields: (id: string, patch: Partial<BulkFields>) => void;
}) {
  const f = item.fields;
  const dupOf = item.dupOfId ? items.find((i) => i.id === item.dupOfId) : null;
  const ambiguousCandidate =
    item.candidate && (item.candidateScore ?? 0) >= 0.6 && (item.candidateScore ?? 0) < 0.85
      ? item.candidate
      : null;

  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-notebook">
      <div className="flex gap-3">
        {item.thumbUrl ? (
          <img src={item.thumbUrl} alt="label" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Camera size={18} />
          </div>
        )}
        <button onClick={onExpand} className="min-w-0 flex-1 text-left">
          <p className="truncate font-medium">{f.name || "Not read — fill in by hand"}</p>
          <p className="truncate text-sm text-muted-foreground">
            {[f.producer, f.vintage].filter(Boolean).join(" · ") || "—"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {item.status === "failed"
              ? item.error ?? "Failed"
              : `Confidence ${Math.round((item.confidence ?? 0) * 100)}%`}
            {item.dateFromPhoto && ` · ${item.tastedOn} from photo`}
          </p>
        </button>
        <button
          onClick={() => patchItem(item.id, { discarded: true })}
          aria-label="Discard"
          className="self-start p-1 text-muted-foreground hover:text-destructive"
        >
          <Trash2 size={16} />
        </button>
      </div>

      {ambiguousCandidate && (
        <div className="mt-3 rounded-xl bg-muted/60 p-3 text-sm">
          <p className="mb-2">
            Might be the same as <span className="font-medium">{ambiguousCandidate.name}</span>
            {ambiguousCandidate.producer ? ` — ${ambiguousCandidate.producer}` : ""}
            {ambiguousCandidate.region ? `, ${ambiguousCandidate.region}` : ""}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={item.mergeChoice === "same" ? "default" : "outline"}
              onClick={() => patchItem(item.id, { mergeChoice: "same" })}
            >
              Same wine
            </Button>
            <Button
              size="sm"
              variant={item.mergeChoice === "different" ? "default" : "outline"}
              onClick={() => patchItem(item.id, { mergeChoice: "different" })}
            >
              Different wine
            </Button>
          </div>
        </div>
      )}

      {dupOf && (item.dupOfScore ?? 0) < 0.85 && (
        <div className="mt-3 rounded-xl bg-muted/60 p-3 text-sm">
          <p className="mb-2">
            Might be the same bottle as another photo in this batch:{" "}
            <span className="font-medium">{dupOf.fields.name || "unnamed"}</span>
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={item.dupChoice === "same" ? "default" : "outline"}
              onClick={() => patchItem(item.id, { dupChoice: "same" })}
            >
              Same wine
            </Button>
            <Button
              size="sm"
              variant={item.dupChoice === "different" ? "default" : "outline"}
              onClick={() => patchItem(item.id, { dupChoice: "different" })}
            >
              Different wine
            </Button>
          </div>
        </div>
      )}

      {dupOf && (item.dupOfScore ?? 0) >= 0.85 && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info size={13} /> Same wine as another photo in this batch, they'll share one catalogue entry.
        </p>
      )}

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" value={f.name} onChange={(v) => patchFields(item.id, { name: v })} />
            <Field label="Producer" value={f.producer} onChange={(v) => patchFields(item.id, { producer: v })} />
            <Field label="Appellation" value={f.appellation} onChange={(v) => patchFields(item.id, { appellation: v })} />
            <Field label="Region" value={f.region} onChange={(v) => patchFields(item.id, { region: v })} />
            <Field label="Country" value={f.country} onChange={(v) => patchFields(item.id, { country: v })} />
            <Field label="Vintage" value={f.vintage} onChange={(v) => patchFields(item.id, { vintage: v })} />
            <div>
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select value={f.wine_type} onValueChange={(v) => patchFields(item.id, { wine_type: v })}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Pick one" /></SelectTrigger>
                <SelectContent>
                  {WINE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Field label="Alcohol %" value={f.alcohol_percent} onChange={(v) => patchFields(item.id, { alcohol_percent: v })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">
                Date {item.dateFromPhoto && <span className="text-primary">· from photo</span>}
              </Label>
              <Input
                type="date"
                className="mt-1"
                value={item.tastedOn}
                onChange={(e) => patchItem(item.id, { tastedOn: e.target.value, dateFromPhoto: false })}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">
                Place {item.placeFromPhoto && <span className="text-primary">· from photo</span>}
              </Label>
              <Input
                className="mt-1"
                value={item.place}
                onChange={(e) => patchItem(item.id, { place: e.target.value, placeFromPhoto: false })}
              />
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Note</Label>
            <Textarea
              className="mt-1"
              rows={2}
              value={item.notes}
              onChange={(e) => patchItem(item.id, { notes: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/50 p-1.5">
            {(["tasted", "interested"] as const).map((s) => (
              <button
                key={s}
                onClick={() => patchItem(item.id, { entryStatus: s })}
                className={cn(
                  "rounded-lg py-2 text-sm transition-colors",
                  item.entryStatus === s
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s === "tasted" ? "I tasted this" : "Haven't tried it yet"}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input className="mt-1" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
