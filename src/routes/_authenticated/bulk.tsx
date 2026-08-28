import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { recogniseLabel } from "@/lib/recognise.functions";
import { classifyLabelSides } from "@/lib/classify-label.functions";
import { compareLabels } from "@/lib/compare-labels.functions";
import {
  candidateLabelPath,
  compareLabelsVisually,
  type CompareFn,
} from "@/lib/label-compare";
import { getSignedPhotoUrls } from "@/lib/wine-photo";
import { findBestMatch } from "@/lib/wine-match";
import { recomputeTasteProfile } from "@/lib/taste-profile";
import {
  type BulkItem,
  type BulkFields,
  newItem,
  uploadPhoto,
  recogniseItem,
  pairFrontsAndBacks,
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
import { StarRating } from "@/components/StarRating";
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
  ArrowLeft, Images, X, Loader2, ChevronDown, ChevronRight, Trash2, Camera, Info, Link2, Unlink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { withTimeout } from "@/lib/with-timeout";
import { useTranslation } from "react-i18next";
import { i18next } from "@/i18n";

export const Route = createFileRoute("/_authenticated/bulk")({
  head: () => ({
    meta: [
      { title: i18next.t("bulk.meta.title") },
      { name: "description", content: i18next.t("bulk.meta.description") },
      { property: "og:title", content: i18next.t("bulk.meta.ogTitle") },
      { property: "og:description", content: i18next.t("bulk.meta.ogDescription") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BulkPage,
});

type Phase = "pick" | "uploading" | "processing" | "review" | "saving";

const WINE_TYPES = ["red", "white", "rose", "sparkling", "dessert", "fortified"] as const;

/** A back label that nobody paired: never becomes a wine on its own. */
function isLooseBack(i: BulkItem) {
  return i.side === "back" && !i.pairedIntoId;
}

function BulkPage() {
  const navigate = useNavigate();
  const recognise = useServerFn(recogniseLabel);
  const classify = useServerFn(classifyLabelSides);
  const compare = useServerFn(compareLabels) as unknown as CompareFn;
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<Map<string, File>>(new Map());

  const [phase, setPhase] = useState<Phase>("pick");
  const [items, setItems] = useState<BulkItem[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [currentThumb, setCurrentThumb] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busyRows, setBusyRows] = useState<Record<string, boolean>>({});
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
    if (phase !== "processing" && phase !== "saving" && phase !== "uploading") return;
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
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user!.id;
    const { data: profile } = await supabase
      .from("profiles")
      .select("gps_lookup_enabled")
      .eq("id", uid)
      .maybeSingle();
    const gpsEnabled = !!profile?.gps_lookup_enabled;

    /* ---- 1. upload every photo, reading EXIF first ---- */
    setPhase("uploading");
    let working = [...items];
    for (let i = 0; i < working.length; i++) {
      setCurrentIdx(i);
      setCurrentThumb(working[i].thumbUrl);
      const item = working[i];
      const file = filesRef.current.get(item.id);
      try {
        if (!file) throw new Error("Photo is no longer available");
        working[i] = { ...item, ...(await uploadPhoto(file, uid, gpsEnabled)) } as BulkItem;
      } catch (e) {
        working[i] = {
          ...item,
          status: "failed",
          error: e instanceof Error ? e.message : "Could not upload this photo",
        };
      }
      setItems([...working]);
    }

    /* ---- 2. one cheap call to tell front labels from back labels ---- */
    const uploaded = working.filter((i) => i.photoPath);
    for (let start = 0; start < uploaded.length; start += 12) {
      const chunk = uploaded.slice(start, start + 12);
      try {
        const res = await withTimeout(
          classify({ data: { paths: chunk.map((c) => c.photoPath!) } }),
          60_000,
          "Sorting front and back labels took too long",
        );
        if (res.ok) {
          chunk.forEach((c, k) => {
            const idx = working.findIndex((w) => w.id === c.id);
            if (idx >= 0) {
              working[idx] = { ...working[idx], side: res.sides[k].side, sideReason: res.sides[k].reason };
            }
          });
        }
      } catch { /* classification is best-effort; everything stays a front label */ }
    }

    /* ---- 3. pair backs with the front taken next to them ---- */
    const patches = pairFrontsAndBacks(working);
    working = working.map((w) => (patches.has(w.id) ? { ...w, ...patches.get(w.id)! } : w));
    setItems([...working]);

    /* ---- 4. read the labels, one bottle at a time ---- */
    setPhase("processing");
    const toRead = working.filter((w) => w.photoPath && !w.pairedIntoId && !isLooseBack(w));
    for (let n = 0; n < toRead.length; n++) {
      setCurrentIdx(n);
      const idx = working.findIndex((w) => w.id === toRead[n].id);
      setCurrentThumb(working[idx].thumbUrl);
      setItems((prev) => prev.map((p) => (p.id === working[idx].id ? { ...p, status: "processing" } : p)));
      let merged: BulkItem;
      try {
        merged = { ...working[idx], ...(await recogniseItem(working[idx], recognise)) } as BulkItem;
      } catch (e) {
        merged = {
          ...working[idx],
          status: "failed",
          error: e instanceof Error ? e.message : "Failed to read this photo",
        };
      }
      merged = await withMatches(merged, working);
      working[idx] = merged;
      setItems([...working]);
      saveProgress(working, "review");
    }
    setCurrentThumb(null);
    setPhase("review");
  }

  /** Catalogue match plus in-batch duplicate check for one row. */
  async function withMatches(merged: BulkItem, all: BulkItem[]): Promise<BulkItem> {
    if (merged.status !== "done" || !merged.fields.name.trim()) return merged;
    let out = merged;
    try {
      const cand = await findBestMatch(out.fields.name.trim(), out.fields.producer.trim() || null);
      if (cand && cand.score >= 0.6) {
        out = { ...out, candidate: cand, candidateScore: cand.score };
        // Ambiguous band only: try to settle it on the labels before asking.
        if (cand.score < 0.85) {
          const candPath = await candidateLabelPath(cand.id);
          const verdict = await compareLabelsVisually(compare, candPath, out.photoPath);
          const [candUrl] = await getSignedPhotoUrls([candPath]);
          out = {
            ...out,
            candidatePhotoUrl: candUrl,
            visual: verdict
              ? {
                  same_wine: verdict.comparison.same_wine,
                  confidence: verdict.comparison.confidence,
                  reason: verdict.comparison.reason,
                }
              : null,
            visualResolved: verdict?.outcome != null,
            mergeChoice: verdict?.outcome === "merge" ? "same" : "different",
          };
        }
      }
    } catch { /* matching is best-effort */ }

    for (const other of all) {
      if (other.id === out.id) continue;
      if (other.status !== "done" || !other.fields.name.trim() || other.dupOfId || other.pairedIntoId) continue;
      const s = batchScore(
        out.fields.name, out.fields.producer,
        other.fields.name, other.fields.producer,
      );
      if (s >= 0.6) {
        out = { ...out, dupOfId: other.id, dupOfScore: s, dupChoice: s >= 0.85 ? "same" : "different" };
        break;
      }
    }
    return out;
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

  /** Re-read a bottle after its pairing changed. */
  async function reread(id: string) {
    setBusyRows((b) => ({ ...b, [id]: true }));
    try {
      const current = items.find((i) => i.id === id);
      if (!current) return;
      const patch = await recogniseItem(current, recognise);
      setItems((prev) => {
        const next = prev.map((p) => (p.id === id ? ({ ...p, ...patch } as BulkItem) : p));
        saveProgress(next, "review");
        return next;
      });
    } catch {
      toast.error("Couldn't re-read that bottle.");
    } finally {
      setBusyRows((b) => ({ ...b, [id]: false }));
    }
  }

  /** Attach a back-label row to a front row and read them together. */
  async function pairRows(frontId: string, backId: string) {
    const back = items.find((i) => i.id === backId);
    if (!back) return;
    setItems((prev) => {
      const next = prev.map((p) => {
        if (p.id === frontId) {
          return { ...p, pairedBackId: backId, backPhotoPath: back.photoPath, backThumbUrl: back.thumbUrl };
        }
        if (p.id === backId) return { ...p, pairedIntoId: frontId, side: "back" as const };
        return p;
      });
      saveProgress(next, "review");
      return next;
    });
    // Read with both photos, exactly as the single-photo flow does.
    setBusyRows((b) => ({ ...b, [frontId]: true }));
    try {
      const front = items.find((i) => i.id === frontId);
      if (!front) return;
      const patch = await recogniseItem(
        { ...front, backPhotoPath: back.photoPath } as BulkItem,
        recognise,
      );
      setItems((prev) => {
        const next = prev.map((p) => (p.id === frontId ? ({ ...p, ...patch } as BulkItem) : p));
        saveProgress(next, "review");
        return next;
      });
    } catch {
      toast.error("Couldn't re-read that bottle.");
    } finally {
      setBusyRows((b) => ({ ...b, [frontId]: false }));
    }
  }

  function unpairRow(frontId: string) {
    const front = items.find((i) => i.id === frontId);
    const backId = front?.pairedBackId ?? null;
    setItems((prev) => {
      const next = prev.map((p) => {
        if (p.id === frontId) return { ...p, pairedBackId: null, backPhotoPath: null, backThumbUrl: null };
        if (backId && p.id === backId) return { ...p, pairedIntoId: null };
        return p;
      });
      saveProgress(next, "review");
      return next;
    });
    reread(frontId);
  }

  const visible = useMemo(() => items.filter((i) => !i.discarded && !i.pairedIntoId), [items]);
  const groups = useMemo(() => {
    const byConf = (a: BulkItem, b: BulkItem) => (a.confidence ?? -1) - (b.confidence ?? -1);
    const readable = visible.filter((i) => !isLooseBack(i));
    return {
      good: readable.filter((i) => i.status === "done" && (i.confidence ?? 0) >= 0.8).sort(byConf),
      check: readable
        .filter((i) => i.status === "done" && (i.confidence ?? 0) >= 0.6 && (i.confidence ?? 0) < 0.8)
        .sort(byConf),
      bad: visible
        .filter(
          (i) =>
            isLooseBack(i) || i.status === "failed" || (i.status === "done" && (i.confidence ?? 0) < 0.6),
        )
        .sort(byConf),
    };
  }, [visible]);

  const savable = visible.filter((i) => !isLooseBack(i) && i.fields.name.trim().length > 0);
  const frontRows = visible.filter((i) => !isLooseBack(i));

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

  if (phase === "uploading" || phase === "processing" || phase === "saving") {
    const total =
      phase === "saving"
        ? savable.length
        : phase === "uploading"
          ? items.length
          : items.filter((i) => i.photoPath && !i.pairedIntoId && !isLooseBack(i)).length;
    const done = phase === "saving" ? savedCount : currentIdx;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const heading =
      phase === "uploading" ? "Getting your photos ready" : phase === "processing" ? "Reading your labels" : "Saving";
    return (
      <div className="px-5 pt-10 pb-8">
        <h1 className="text-2xl font-serif text-primary mb-2">{heading}</h1>
        <p className="text-sm text-muted-foreground mb-5">
          {phase === "saving"
            ? `Saved ${done} of ${total}`
            : phase === "uploading"
              ? `Photo ${Math.min(done + 1, total)} of ${total}`
              : `Reading bottle ${Math.min(done + 1, total)} of ${total}`}
        </p>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden mb-5">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        {currentThumb && (
          <img
            src={currentThumb}
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
    const rowProps = {
      items,
      frontRows,
      busyRows,
      patchItem,
      patchFields,
      pairRows,
      unpairRow,
    };
    return (
      <div className="px-5 pt-6 pb-36">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => navigate({ to: "/diary" })} className="p-2 -ml-2 text-muted-foreground">
            <ArrowLeft size={22} />
          </button>
          <h1 className="text-2xl font-serif text-primary">Review</h1>
          <span className="w-8" />
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          Nothing is in your diary yet. Rate them here if you can — that's what builds your taste
          profile — then save.
        </p>

        <Section
          title="Looks good"
          count={groups.good.length}
          open={openGroups.good}
          onToggle={() => setOpenGroups((g) => ({ ...g, good: !g.good }))}
        >
          {groups.good.map((i) => (
            <Row key={i.id} item={i} expanded={!!expanded[i.id]}
              onExpand={() => setExpanded((e) => ({ ...e, [i.id]: !e[i.id] }))}
              {...rowProps} />
          ))}
        </Section>

        <Section
          title="Worth checking"
          count={groups.check.length}
          open={openGroups.check}
          onToggle={() => setOpenGroups((g) => ({ ...g, check: !g.check }))}
        >
          {groups.check.map((i) => (
            <Row key={i.id} item={i} expanded={!!expanded[i.id]}
              onExpand={() => setExpanded((e) => ({ ...e, [i.id]: !e[i.id] }))}
              {...rowProps} />
          ))}
        </Section>

        <Section
          title="Couldn't read these"
          count={groups.bad.length}
          open={openGroups.bad}
          onToggle={() => setOpenGroups((g) => ({ ...g, bad: !g.bad }))}
        >
          {groups.bad.map((i) => (
            <Row key={i.id} item={i} expanded={!isLooseBack(i)}
              onExpand={() => setExpanded((e) => ({ ...e, [i.id]: !e[i.id] }))}
              {...rowProps} />
          ))}
        </Section>

        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 backdrop-blur px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {!savable.length && (
            <p className="mb-2 text-center text-xs text-muted-foreground">
              Give at least one wine a name to save
            </p>
          )}
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
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" className="h-24 flex-col gap-2" onClick={() => cameraRef.current?.click()}>
            <Camera size={22} />
            <span className="text-sm">Take a photo</span>
          </Button>
          <Button variant="outline" className="h-24 flex-col gap-2" onClick={() => libraryRef.current?.click()}>
            <Images size={22} />
            <span className="text-sm">Choose from library</span>
          </Button>
        </div>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => { if (e.target.files?.length) onPick(e.target.files); e.target.value = ""; }}
        />
        <input
          ref={libraryRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files?.length) onPick(e.target.files); e.target.value = ""; }}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          Front and back of the same bottle? Photograph them one after the other and I'll pair them
          for you.
        </p>

        {items.length > 0 && (
          <>
            <p className="mt-4 mb-2 text-sm text-muted-foreground">
              {items.length} {items.length === 1 ? "photo" : "photos"} chosen
            </p>
            <div className="grid grid-cols-3 gap-2">
              {items.map((i) => (
                <div key={i.id} className="relative aspect-square">
                  {i.thumbUrl && (
                    <img src={i.thumbUrl} alt={t("bulk.pick.chosenLabelAlt")} className="h-full w-full rounded-lg object-cover" />
                  )}
                  <button
                    onClick={() => removePicked(i.id)}
                    aria-label={t("bulk.pick.removePhoto")}
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
        {t("bulk.pick.readButton", { count: items.length || 0 })}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("bulk.confirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("bulk.confirm.description", { count: items.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={startProcessing}>{t("bulk.confirm.start")}</AlertDialogAction>
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
  item, items, frontRows, busyRows, expanded, onExpand, patchItem, patchFields, pairRows, unpairRow,
}: {
  item: BulkItem;
  items: BulkItem[];
  frontRows: BulkItem[];
  busyRows: Record<string, boolean>;
  expanded: boolean;
  onExpand: () => void;
  patchItem: (id: string, patch: Partial<BulkItem>) => void;
  patchFields: (id: string, patch: Partial<BulkFields>) => void;
  pairRows: (frontId: string, backId: string) => void;
  unpairRow: (frontId: string) => void;
}) {
  const { t } = useTranslation();
  const f = item.fields;
  const busy = !!busyRows[item.id];
  const looseBack = isLooseBack(item);
  const dupOf = item.dupOfId ? items.find((i) => i.id === item.dupOfId) : null;
  const ambiguousCandidate =
    item.candidate &&
    (item.candidateScore ?? 0) >= 0.6 &&
    (item.candidateScore ?? 0) < 0.85 &&
    !item.visualResolved
      ? item.candidate
      : null;
  const looseBacks = items.filter((i) => !i.discarded && isLooseBack(i) && i.id !== item.id);

  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-notebook">
      <div className="flex gap-3">
        <div className="flex shrink-0 gap-1">
          {item.thumbUrl ? (
            <img src={item.thumbUrl} alt="label" className="h-16 w-16 rounded-lg object-cover" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Camera size={18} />
            </div>
          )}
          {item.backThumbUrl && (
            <img
              src={item.backThumbUrl}
              alt="back label"
              className="h-16 w-16 rounded-lg object-cover opacity-90"
            />
          )}
        </div>
        <button onClick={onExpand} className="min-w-0 flex-1 text-left">
          <p className="truncate font-medium">
            {looseBack ? t("bulk.row.backLabelTitle") : f.name || t("bulk.row.unreadName")}
          </p>
          <p className="truncate text-sm text-muted-foreground">
            {looseBack
              ? item.sideReason ?? t("bulk.row.defaultSideReason")
              : [f.producer, f.vintage].filter(Boolean).join(" · ") || "—"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {looseBack
              ? t("bulk.row.looseBackHint")
              : item.status === "failed"
                ? item.error ?? t("bulk.row.failedFallback")
                : t("bulk.row.confidence", { value: Math.round((item.confidence ?? 0) * 100) })}
            {!looseBack && item.dateFromPhoto && ` · ${item.tastedOn} ${t("bulk.row.fromPhoto")}`}
          </p>
        </button>
        <button
          onClick={() => patchItem(item.id, { discarded: true })}
          aria-label={t("bulk.row.discard")}
          className="self-start p-1 text-muted-foreground hover:text-destructive"
        >
          <Trash2 size={16} />
        </button>
      </div>

      {busy && (
        <p className="mt-2 flex items-center gap-2 text-xs text-primary">
          <Loader2 size={13} className="animate-spin" /> {t("bulk.row.rereading")}
        </p>
      )}

      {/* pairing */}
      {item.pairedBackId && !looseBack && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-muted/60 p-3 text-sm">
          <span className="flex items-center gap-1.5">
            <Link2 size={14} /> {t("bulk.row.pairedLabel")}
          </span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => unpairRow(item.id)}>
            <Unlink size={13} /> {t("bulk.row.separate")}
          </Button>
        </div>
      )}

      {!item.pairedBackId && !looseBack && looseBacks.length > 0 && (
        <div className="mt-3 rounded-xl bg-muted/60 p-3 text-sm">
          <p className="mb-2">{t("bulk.row.pairPrompt")}</p>
          <Select value="" onValueChange={(v) => pairRows(item.id, v)}>
            <SelectTrigger><SelectValue placeholder={t("bulk.row.pairPlaceholder")} /></SelectTrigger>
            <SelectContent>
              {looseBacks.map((b, k) => (
                <SelectItem key={b.id} value={b.id}>
                  {t("bulk.row.backLabelOption", { count: k + 1 })}
                  {b.takenAtMs ? ` · ${new Date(b.takenAtMs).toLocaleTimeString()}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {looseBack && (
        <div className="mt-3 space-y-2 rounded-xl bg-muted/60 p-3 text-sm">
          <p>{t("bulk.row.looseBackPrompt")}</p>
          <Select value="" onValueChange={(v) => pairRows(v, item.id)}>
            <SelectTrigger><SelectValue placeholder={t("bulk.row.choosePlaceholder")} /></SelectTrigger>
            <SelectContent>
              {frontRows
                .filter((r) => !r.pairedBackId)
                .map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.fields.name || t("bulk.row.unnamedBottle")}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            onClick={() => patchItem(item.id, { side: "front", sideReason: null })}
          >
            {t("bulk.row.actuallyFront")}
          </Button>
        </div>
      )}

      {ambiguousCandidate && (
        <div className="mt-3 rounded-xl bg-muted/60 p-3 text-sm">
          <p className="mb-2">
            {t("bulk.row.maybeSame", { name: "" })}<span className="font-medium">{ambiguousCandidate.name}</span>
            {ambiguousCandidate.producer ? ` — ${ambiguousCandidate.producer}` : ""}
            {ambiguousCandidate.region ? `, ${ambiguousCandidate.region}` : ""}
          </p>
          {(item.candidatePhotoUrl || item.thumbUrl) && (
            <div className="mb-2 grid grid-cols-2 gap-2">
              {[
                { label: t("bulk.row.inCatalogue"), url: item.candidatePhotoUrl },
                { label: t("bulk.row.thisBottle"), url: item.thumbUrl },
              ].map((p) => (
                <div key={p.label} className="space-y-1">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{p.label}</p>
                  {p.url ? (
                    <img
                      src={p.url}
                      alt={t("bulk.row.labelPhotoAlt", { label: p.label })}
                      className="h-44 w-full rounded-lg border border-border object-cover"
                    />
                  ) : (
                    <div className="flex h-44 w-full items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                      {t("bulk.row.noPhoto")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {item.visual?.reason && (
            <p className="mb-2 rounded-lg border border-primary/20 bg-primary/5 p-2 text-xs">
              {item.visual.reason}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={item.mergeChoice === "same" ? "default" : "outline"}
              onClick={() => patchItem(item.id, { mergeChoice: "same" })}
            >
              {t("bulk.row.sameWine")}
            </Button>
            <Button
              size="sm"
              variant={item.mergeChoice === "different" ? "default" : "outline"}
              onClick={() => patchItem(item.id, { mergeChoice: "different" })}
            >
              {t("bulk.row.differentWine")}
            </Button>
          </div>
        </div>
      )}

      {dupOf && (item.dupOfScore ?? 0) < 0.85 && (
        <div className="mt-3 rounded-xl bg-muted/60 p-3 text-sm">
          <p className="mb-2">
            {t("bulk.row.maybeDup")}{" "}
            <span className="font-medium">{dupOf.fields.name || t("bulk.row.unnamed")}</span>
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={item.dupChoice === "same" ? "default" : "outline"}
              onClick={() => patchItem(item.id, { dupChoice: "same" })}
            >
              {t("bulk.row.sameWine")}
            </Button>
            <Button
              size="sm"
              variant={item.dupChoice === "different" ? "default" : "outline"}
              onClick={() => patchItem(item.id, { dupChoice: "different" })}
            >
              {t("bulk.row.differentWine")}
            </Button>
          </div>
        </div>
      )}

      {dupOf && (item.dupOfScore ?? 0) >= 0.85 && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info size={13} /> {t("bulk.row.sharedEntry")}
        </p>
      )}

      {/* inline rating + status, no editor needed */}
      {!looseBack && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <StarRating
              value={item.rating}
              onChange={(v) => patchItem(item.id, { rating: v, entryStatus: v ? "tasted" : item.entryStatus })}
              size={22}
            />
            {item.entryStatus === "interested" && item.rating === 0 && (
              <span className="text-xs text-muted-foreground">{t("bulk.row.notTriedYet")}</span>
            )}
          </div>
          <div className="flex rounded-xl bg-muted/50 p-1">
            {(["tasted", "interested"] as const).map((s) => (
              <button
                key={s}
                onClick={() => patchItem(item.id, { entryStatus: s })}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs transition-colors",
                  item.entryStatus === s
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s === "tasted" ? t("bulk.row.tasted") : t("bulk.row.wantToTry")}
              </button>
            ))}
          </div>
        </div>
      )}

      {expanded && !looseBack && (
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
