import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { format } from "date-fns";
import { ChevronDown, Bookmark, Wine, Sparkles, GlassWater, ScanLine, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StarRating } from "@/components/StarRating";
import { cn } from "@/lib/utils";
import {
  deleteMenuItem,
  loadTasteContext,
  servingLabel,
  setScanServingBasis,
  updateMenuItem,
  type MenuItemRow,
} from "@/lib/menu-match";
import {
  attachDiary,
  buildTasteProfile,
  logRecommendations,
  recommendMenu,
  MIN_RATED_FOR_SUGGESTIONS,
  type ScoredItem,
} from "@/lib/menu-recommend";
import { addMenuItemAsTasted, addMenuItemToWishlist } from "@/lib/menu-actions";
import { withTimeout } from "@/lib/with-timeout";

const MIN_RECOMMEND_SCORE = 0.15;
const MAX_RECOMMENDATIONS = 5;

export function MenuResults({
  items,
  restaurantName,
  userId,
  scanId,
}: {
  items: MenuItemRow[];
  restaurantName: string | null;
  userId: string;
  scanId: string;
}) {
  const navigate = useNavigate();
  const [scored, setScored] = useState<ScoredItem[] | null>(null);
  const [ratedCount, setRatedCount] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, "wishlist" | "tasted">>({});
  const [showOther, setShowOther] = useState(false);
  // Lines the photo cut off: fixed here, or discarded, before they count as wines.
  const [fixes, setFixes] = useState<Record<string, { name: string; producer: string }>>({});
  const [discarded, setDiscarded] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { name: string; producer: string }>>({});
  // A whole page corrected in one tap, e.g. glass prices read as bottle prices.
  const [servingFix, setServingFix] = useState<Record<string, MenuItemRow>>({});
  const [servingBusy, setServingBusy] = useState(false);

  const visible = useMemo(
    () =>
      items
        .filter((i) => !discarded.includes(i.id))
        .map((i) => {
          const base = servingFix[i.id] ?? i;
          const fix = fixes[i.id];
          return fix
            ? {
                ...base,
                parsed_name: fix.name,
                parsed_producer: fix.producer || null,
                truncated: false,
              }
            : base;
        }),
    [items, fixes, discarded, servingFix],
  );


  // A truncated line is a fragment, never a wine: it is never matched and never
  // mixed in with the readable wines.
  const unreadable = useMemo(() => visible.filter((i) => i.truncated), [visible]);
  const readable = useMemo(() => visible.filter((i) => !i.truncated), [visible]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFailed(false);
      setScored(null);
      try {
        const taste = await withTimeout(loadTasteContext(userId));
        const profile = buildTasteProfile(taste.entries);
        // Scoring is against the profile only — no lookup in the wines table.
        const result = await recommendMenu(readable, profile);
        if (cancelled) return;
        const withDiary = attachDiary(result, taste.entries);
        setRatedCount(profile.ratedCount);
        setScored(withDiary);
        if (profile.ratedCount >= MIN_RATED_FOR_SUGGESTIONS) {
          // Every scored item is logged, not only the ones shown.
          void logRecommendations({
            userId,
            scanId,
            scored: withDiary,
            ratedCount: profile.ratedCount,
          });
        }
      } catch (err) {
        console.error("Scoring this list against your taste failed", err);
        if (cancelled) return;
        // The wines were read fine — show them all rather than nothing.
        setFailed(true);
        setRatedCount(null);
        setScored(
          readable.map((item) => ({
            item,
            grapes: item.grapes ?? [],
            wine_type: item.wine_type,
            region: null,
            country: null,
            filled: null,
            score: 0,
            reason: null,
            diary: null,
          })),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readable, userId, scanId, reloadKey]);

  const enoughData = ratedCount != null && ratedCount >= MIN_RATED_FOR_SUGGESTIONS;

  const groups = useMemo(() => {
    const all = scored ?? [];
    const had = all.filter((s) => s.diary);
    const rest = all.filter((s) => !s.diary);
    if (!enoughData) {
      // Menu order, no weak suggestions.
      return { had, recommended: [] as ScoredItem[], other: rest };
    }
    const ranked = [...rest].sort((a, b) => b.score - a.score);
    const recommended = ranked
      .filter((s) => s.reason && s.score >= MIN_RECOMMEND_SCORE)
      .slice(0, MAX_RECOMMENDATIONS);
    const chosen = new Set(recommended.map((s) => s.item.id));
    return { had, recommended, other: ranked.filter((s) => !chosen.has(s.item.id)) };
  }, [scored, enoughData]);

  async function onFix(item: MenuItemRow) {
    const draft = drafts[item.id] ?? {
      name: item.parsed_name ?? "",
      producer: item.parsed_producer ?? "",
    };
    if (draft.name.trim().length < 3) {
      toast.error("Give it at least three characters");
      return;
    }
    try {
      setBusy(item.id);
      await updateMenuItem(item.id, {
        parsed_name: draft.name.trim(),
        parsed_producer: draft.producer.trim() || null,
        truncated: false,
      });
      setFixes((f) => ({
        ...f,
        [item.id]: { name: draft.name.trim(), producer: draft.producer.trim() },
      }));
      toast.success("Fixed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that");
    } finally {
      setBusy(null);
    }
  }

  async function onDiscard(item: MenuItemRow) {
    try {
      setBusy(item.id);
      await deleteMenuItem(item.id);
      setDiscarded((d) => [...d, item.id]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not discard that");
    } finally {
      setBusy(null);
    }
  }

  async function onWishlist(s: ScoredItem) {
    try {
      setBusy(s.item.id);
      await addMenuItemToWishlist(s.item, userId);
      setDone((d) => ({ ...d, [s.item.id]: "wishlist" }));
      toast.success("Added to your wishlist");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add that");
    } finally {
      setBusy(null);
    }
  }

  async function onOrdered(s: ScoredItem) {
    try {
      setBusy(s.item.id);
      const entryId = await addMenuItemAsTasted(s.item, userId, restaurantName);
      toast.success("Logged — add your rating");
      navigate({ to: "/entry/$id", params: { id: entryId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not log that");
      setBusy(null);
    }
  }

  if (!scored) {
    return <p className="text-center text-sm text-muted-foreground py-10">Reading the list…</p>;
  }

  const price = (item: MenuItemRow) =>
    (item.price != null || item.glass_price != null) && (
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-medium text-foreground">
          {item.currency ? `${item.currency} ` : ""}
          {item.price ?? item.glass_price}
        </p>
        {item.glass_price != null && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1 justify-end">
            <GlassWater size={11} /> {item.currency ? `${item.currency} ` : ""}
            {item.glass_price} by the glass
          </p>
        )}
        {item.glass_price == null && item.by_the_glass && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1 justify-end">
            <GlassWater size={11} /> by the glass
          </p>
        )}
      </div>
    );

  const row = (s: ScoredItem, tone: "had" | "recommended" | "other") => (
    <li
      key={s.item.id}
      className={cn(
        "rounded-2xl border p-4 bg-card shadow-notebook",
        tone === "recommended"
          ? "border-primary"
          : tone === "had"
            ? "border-primary/40"
            : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-serif text-lg leading-tight text-foreground">
            {s.item.parsed_name ?? s.item.raw_text ?? "Unnamed wine"}
            {s.item.parsed_vintage && (
              <span className="text-sm font-sans text-muted-foreground">
                {" "}
                · {s.item.parsed_vintage}
              </span>
            )}
          </h3>
          {s.item.parsed_producer && (
            <p className="text-sm text-muted-foreground">{s.item.parsed_producer}</p>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            {s.wine_type && <span className="capitalize">{s.wine_type}</span>}
            {s.item.section_heading && <span>· {s.item.section_heading}</span>}
            {s.grapes.length ? <span>· {s.grapes.join(", ")}</span> : null}
            {s.item.truncated && (
              <span className="text-destructive">· text was cut off, please check</span>
            )}
          </p>
          {s.filled && (
            <p className="mt-1 text-[11px] italic text-muted-foreground">
              {s.filled.grapes && s.filled.wine_type
                ? "Grapes and colour"
                : s.filled.grapes
                  ? "Grapes"
                  : "Colour"}{" "}
              taken from {s.filled.appellation}, not printed on the list
            </p>
          )}
        </div>
        {price(s.item)}
      </div>

      {s.diary && (
        <div className="mt-3 rounded-xl bg-parchment/70 p-3">
          <div className="flex items-center gap-2">
            <StarRating value={s.diary.rating ?? 0} size={14} />
            <span className="text-xs text-muted-foreground">
              {format(new Date(s.diary.tasted_on), "d MMM yyyy")}
            </span>
          </div>
          {s.diary.notes && (
            <p className="mt-2 text-sm text-foreground/90 italic font-serif">“{s.diary.notes}”</p>
          )}
        </div>
      )}

      {tone === "recommended" && s.reason && (
        <p className="mt-2 text-sm text-primary/90 flex gap-1.5">
          <Sparkles size={14} className="mt-0.5 flex-shrink-0" />
          <span>{s.reason}</span>
        </p>
      )}

      <div className="mt-3 flex gap-2">
        {done[s.item.id] ? (
          <p className="text-xs text-muted-foreground py-2">
            {done[s.item.id] === "wishlist" ? "On your wishlist" : "Logged"}
          </p>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy === s.item.id}
              onClick={() => onWishlist(s)}
            >
              <Bookmark size={14} /> Add to wishlist
            </Button>
            <Button size="sm" disabled={busy === s.item.id} onClick={() => onOrdered(s)}>
              <Wine size={14} /> I ordered this
            </Button>
          </>
        )}
      </div>
    </li>
  );

  return (
    <div className="space-y-8">
      {failed && (
        <section className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm text-foreground">
            Couldn't work out what you'd like from this list. The wines were read fine — the full
            list is below.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            Try again
          </Button>
        </section>
      )}

      {!failed && ratedCount != null && !enoughData && (
        <section className="rounded-2xl border border-border bg-parchment/60 p-4">
          <h2 className="font-serif text-xl text-foreground">Not enough to go on yet</h2>
          <p className="text-sm text-muted-foreground mt-1">
            I need a few more rated wines before I can suggest things. Rate the wines in your diary
            and I'll get better at this.
          </p>
        </section>
      )}

      {groups.recommended.length > 0 && (
        <section>
          <h2 className="font-serif text-2xl text-primary mb-1">You'd probably like these</h2>
          <p className="text-sm text-muted-foreground mb-3">
            Based on the {ratedCount} wines you've rated.
          </p>
          <ul className="space-y-3">{groups.recommended.map((s) => row(s, "recommended"))}</ul>
        </section>
      )}

      {groups.had.length > 0 && (
        <section>
          <h2 className="font-serif text-2xl text-foreground mb-1">You've had this</h2>
          <p className="text-sm text-muted-foreground mb-3">
            {groups.had.length === 1 ? "One wine" : `${groups.had.length} wines`} on this list are
            already in your diary.
          </p>
          <ul className="space-y-3">{groups.had.map((s) => row(s, "had"))}</ul>
        </section>
      )}

      {groups.other.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setShowOther((v) => !v)}
            className="flex w-full items-center justify-between rounded-2xl border border-border bg-card px-4 py-3 text-left shadow-notebook"
          >
            <span className="font-serif text-xl text-foreground">
              Everything else{" "}
              <span className="text-sm font-sans text-muted-foreground">
                ({groups.other.length})
              </span>
            </span>
            <ChevronDown
              size={18}
              className={cn(
                "transition-transform text-muted-foreground",
                showOther && "rotate-180",
              )}
            />
          </button>
          {showOther && (
            <ul className="space-y-3 mt-3">{groups.other.map((s) => row(s, "other"))}</ul>
          )}
        </section>
      )}

      {unreadable.length > 0 && (
        <section>
          <h2 className="font-serif text-2xl text-foreground mb-1 flex items-center gap-2">
            <ScanLine size={18} className="text-muted-foreground" /> Couldn't read these properly
          </h2>
          <p className="text-sm text-muted-foreground mb-3">
            The photo cut these off, so they aren't saved as wines yet. Fix the name or discard
            them.
          </p>
          <ul className="space-y-3">
            {unreadable.map((item) => {
              const draft = drafts[item.id] ?? {
                name: item.parsed_name ?? "",
                producer: item.parsed_producer ?? "",
              };
              return (
                <li
                  key={item.id}
                  className="rounded-2xl border border-dashed border-border bg-card p-4"
                >
                  <p className="text-xs text-muted-foreground mb-2">
                    Read as “{item.parsed_name ?? item.raw_text ?? "—"}”
                    {item.price != null ? ` · ${item.currency ?? ""} ${item.price}` : ""}
                  </p>
                  <div className="space-y-2">
                    <Input
                      value={draft.name}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [item.id]: { ...draft, name: e.target.value } }))
                      }
                      placeholder="Wine name"
                      className="bg-background"
                    />
                    <Input
                      value={draft.producer}
                      onChange={(e) =>
                        setDrafts((d) => ({
                          ...d,
                          [item.id]: { ...draft, producer: e.target.value },
                        }))
                      }
                      placeholder="Producer (optional)"
                      className="bg-background"
                    />
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" disabled={busy === item.id} onClick={() => onFix(item)}>
                      Save this name
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === item.id}
                      onClick={() => onDiscard(item)}
                    >
                      <Trash2 size={14} /> Discard
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {items.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-10">
          No wines could be read from those photos.
        </p>
      )}
    </div>
  );
}
