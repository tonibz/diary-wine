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
  enrichItems,
  loadLinkedWines,
  loadTasteContext,
  MIN_ENTRIES_FOR_SUGGESTIONS,
  updateMenuItem,
  type EnrichedItem,
  type MenuItemRow,
  type TasteContext,
} from "@/lib/menu-match";
import { addMenuItemAsTasted, addMenuItemToWishlist } from "@/lib/menu-actions";
import { withTimeout } from "@/lib/with-timeout";


export function MenuResults({
  items,
  restaurantName,
  userId,
}: {
  items: MenuItemRow[];
  restaurantName: string | null;
  userId: string;
}) {
  const navigate = useNavigate();
  const [ctx, setCtx] = useState<TasteContext | null>(null);
  const [enriched, setEnriched] = useState<EnrichedItem[] | null>(null);
  const [matchingFailed, setMatchingFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, "wishlist" | "tasted">>({});
  const [showOther, setShowOther] = useState(false);
  // Lines the photo cut off: fixed here, or discarded, before they count as wines.
  const [fixes, setFixes] = useState<Record<string, { name: string; producer: string }>>({});
  const [discarded, setDiscarded] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { name: string; producer: string }>>({});

  const visible = useMemo(
    () =>
      items
        .filter((i) => !discarded.includes(i.id))
        .map((i) => {
          const fix = fixes[i.id];
          return fix
            ? { ...i, parsed_name: fix.name, parsed_producer: fix.producer || null, truncated: false }
            : i;
        }),
    [items, fixes, discarded],
  );

  // A truncated line is a fragment, never a wine: it is never matched and never
  // mixed in with the readable wines.
  const unreadable = useMemo(() => visible.filter((i) => i.truncated), [visible]);
  const readable = useMemo(() => visible.filter((i) => !i.truncated), [visible]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setMatchingFailed(false);
      setEnriched(null);
      try {
        const taste = await withTimeout(loadTasteContext(userId));
        const linked = await withTimeout(
          loadLinkedWines(readable.map((i) => i.matched_wine_id).filter((x): x is string => !!x)),
        );
        if (cancelled) return;
        setCtx(taste);
        setEnriched(enrichItems(readable, taste, linked));
      } catch (err) {
        console.error("Menu matching against diary failed", err);
        if (cancelled) return;
        // The wines were read fine — show them all rather than nothing.
        setCtx(null);
        setMatchingFailed(true);
        setEnriched(
          readable.map((item) => ({ item, group: "other" as const, diary: null, reason: null })),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readable, userId, reloadKey]);


  const groups = useMemo(() => {
    const had = (enriched ?? []).filter((e) => e.group === "had");
    const similar = (enriched ?? []).filter((e) => e.group === "similar");
    const other = (enriched ?? []).filter((e) => e.group === "other");
    return { had, similar, other };
  }, [enriched]);

  async function onFix(item: MenuItemRow) {
    const draft = drafts[item.id] ?? { name: item.parsed_name ?? "", producer: item.parsed_producer ?? "" };
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
      setFixes((f) => ({ ...f, [item.id]: { name: draft.name.trim(), producer: draft.producer.trim() } }));
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


  async function onWishlist(e: EnrichedItem) {
    try {
      setBusy(e.item.id);
      await addMenuItemToWishlist(e.item, userId);
      setDone((d) => ({ ...d, [e.item.id]: "wishlist" }));
      toast.success("Added to your wishlist");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add that");
    } finally {
      setBusy(null);
    }
  }

  async function onOrdered(e: EnrichedItem) {
    try {
      setBusy(e.item.id);
      const entryId = await addMenuItemAsTasted(e.item, userId, restaurantName);
      toast.success("Logged — add your rating");
      navigate({ to: "/entry/$id", params: { id: entryId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not log that");
      setBusy(null);
    }
  }

  if (!enriched) {
    return <p className="text-center text-sm text-muted-foreground py-10">Reading the list…</p>;
  }

  const row = (e: EnrichedItem, tone: "had" | "similar" | "other") => (
    <li
      key={e.item.id}
      className={cn(
        "rounded-2xl border p-4",
        tone === "had"
          ? "bg-card border-primary/40 shadow-notebook"
          : "bg-card border-border shadow-notebook",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-serif text-lg leading-tight text-foreground">
            {e.item.parsed_name ?? e.item.raw_text ?? "Unnamed wine"}
            {e.item.parsed_vintage && (
              <span className="text-sm font-sans text-muted-foreground"> · {e.item.parsed_vintage}</span>
            )}
          </h3>
          {e.item.parsed_producer && (
            <p className="text-sm text-muted-foreground">{e.item.parsed_producer}</p>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            {e.item.wine_type && <span className="capitalize">{e.item.wine_type}</span>}
            {e.item.section_heading && <span>· {e.item.section_heading}</span>}
            {e.item.grapes?.length ? <span>· {e.item.grapes.join(", ")}</span> : null}
            {e.item.truncated && (
              <span className="text-destructive">· text was cut off, please check</span>
            )}
          </p>
        </div>
        {(e.item.price != null || e.item.glass_price != null) && (
          <div className="text-right flex-shrink-0">
            <p className="text-sm font-medium text-foreground">
              {e.item.currency ? `${e.item.currency} ` : ""}
              {e.item.price ?? e.item.glass_price}
            </p>
            {e.item.glass_price != null && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1 justify-end">
                <GlassWater size={11} /> {e.item.currency ? `${e.item.currency} ` : ""}
                {e.item.glass_price} by the glass
              </p>
            )}
            {e.item.glass_price == null && e.item.by_the_glass && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1 justify-end">
                <GlassWater size={11} /> by the glass
              </p>
            )}
          </div>
        )}
      </div>


      {e.diary && (
        <div className="mt-3 rounded-xl bg-parchment/70 p-3">
          <div className="flex items-center gap-2">
            <StarRating value={e.diary.rating ?? 0} size={14} />
            <span className="text-xs text-muted-foreground">
              {format(new Date(e.diary.tasted_on), "d MMM yyyy")}
            </span>
          </div>
          {e.diary.notes && (
            <p className="mt-2 text-sm text-foreground/90 italic font-serif">“{e.diary.notes}”</p>
          )}
        </div>
      )}

      {e.reason && (
        <p className="mt-2 text-sm text-primary/90 flex gap-1.5">
          <Sparkles size={14} className="mt-0.5 flex-shrink-0" />
          <span>{e.reason}</span>
        </p>
      )}

      <div className="mt-3 flex gap-2">
        {done[e.item.id] ? (
          <p className="text-xs text-muted-foreground py-2">
            {done[e.item.id] === "wishlist" ? "On your wishlist" : "Logged"}
          </p>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy === e.item.id}
              onClick={() => onWishlist(e)}
            >
              <Bookmark size={14} /> Add to wishlist
            </Button>
            <Button size="sm" disabled={busy === e.item.id} onClick={() => onOrdered(e)}>
              <Wine size={14} /> I ordered this
            </Button>
          </>
        )}
      </div>
    </li>
  );

  return (
    <div className="space-y-8">
      {matchingFailed && (
        <section className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm text-foreground">
            Couldn't match these against your diary. The wines were read fine — the full list is
            below.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            Retry matching
          </Button>
        </section>
      )}

      {groups.had.length > 0 && (
        <section>
          <h2 className="font-serif text-2xl text-primary mb-1">You've had this</h2>
          <p className="text-sm text-muted-foreground mb-3">
            {groups.had.length === 1 ? "One wine" : `${groups.had.length} wines`} on this list are
            already in your diary.
          </p>
          <ul className="space-y-3">{groups.had.map((e) => row(e, "had"))}</ul>
        </section>
      )}

      {ctx && ctx.entries.length < MIN_ENTRIES_FOR_SUGGESTIONS ? (

        <section className="rounded-2xl border border-border bg-parchment/60 p-4">
          <h2 className="font-serif text-xl text-foreground">No suggestions yet</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Log a few more wines and I'll be able to suggest things from lists like this.
          </p>
        </section>
      ) : (
        groups.similar.length > 0 && (
          <section>
            <h2 className="font-serif text-2xl text-primary mb-3">Similar to wines you like</h2>
            <ul className="space-y-3">{groups.similar.map((e) => row(e, "similar"))}</ul>
          </section>
        )
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
              <span className="text-sm font-sans text-muted-foreground">({groups.other.length})</span>
            </span>
            <ChevronDown
              size={18}
              className={cn("transition-transform text-muted-foreground", showOther && "rotate-180")}
            />
          </button>
          {showOther && <ul className="space-y-3 mt-3">{groups.other.map((e) => row(e, "other"))}</ul>}
        </section>
      )}

      {unreadable.length > 0 && (
        <section>
          <h2 className="font-serif text-2xl text-foreground mb-1 flex items-center gap-2">
            <ScanLine size={18} className="text-muted-foreground" /> Couldn't read these properly
          </h2>
          <p className="text-sm text-muted-foreground mb-3">
            The photo cut these off, so they aren't saved as wines yet. Fix the name or discard them.
          </p>
          <ul className="space-y-3">
            {unreadable.map((item) => {
              const draft =
                drafts[item.id] ?? {
                  name: item.parsed_name ?? "",
                  producer: item.parsed_producer ?? "",
                };
              return (
                <li key={item.id} className="rounded-2xl border border-dashed border-border bg-card p-4">
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
                        setDrafts((d) => ({ ...d, [item.id]: { ...draft, producer: e.target.value } }))
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
