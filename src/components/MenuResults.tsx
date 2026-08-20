import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { format } from "date-fns";
import { ChevronDown, Bookmark, Wine, Sparkles, GlassWater } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StarRating } from "@/components/StarRating";
import { cn } from "@/lib/utils";
import {
  enrichItems,
  loadLinkedWines,
  loadTasteContext,
  MIN_ENTRIES_FOR_SUGGESTIONS,
  type EnrichedItem,
  type MenuItemRow,
  type TasteContext,
} from "@/lib/menu-match";
import { addMenuItemAsTasted, addMenuItemToWishlist } from "@/lib/menu-actions";

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
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, "wishlist" | "tasted">>({});
  const [showOther, setShowOther] = useState(false);

  useEffect(() => {
    (async () => {
      const taste = await loadTasteContext(userId);
      const linked = await loadLinkedWines(
        items.map((i) => i.matched_wine_id).filter((x): x is string => !!x),
      );
      setCtx(taste);
      setEnriched(enrichItems(items, taste, linked));
    })();
  }, [items, userId]);

  const groups = useMemo(() => {
    const had = (enriched ?? []).filter((e) => e.group === "had");
    const similar = (enriched ?? []).filter((e) => e.group === "similar");
    const other = (enriched ?? []).filter((e) => e.group === "other");
    return { had, similar, other };
  }, [enriched]);

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

  if (!enriched || !ctx) {
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

      {ctx.entries.length < MIN_ENTRIES_FOR_SUGGESTIONS ? (
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

      {items.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-10">
          No wines could be read from those photos.
        </p>
      )}
    </div>
  );
}
