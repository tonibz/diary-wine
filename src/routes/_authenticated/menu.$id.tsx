import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ArrowLeft, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { loadMenuScan, rematchScan, type MenuItemRow, type MenuScanRow } from "@/lib/menu-match";
import { MenuResults } from "@/components/MenuResults";
import { ScanVenue } from "@/components/ScanVenue";
import { withTimeout } from "@/lib/with-timeout";
import { createStageTimer } from "@/lib/stage-timer";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/menu/$id")({
  head: () => ({
    meta: [
      { title: "Wine list — Wine Diary" },
      { name: "description", content: "What to order from this restaurant's wine list." },
      { property: "og:title", content: "Wine list" },
      { property: "og:description", content: "What to order from this wine list." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MenuScanDetail,
});

function MenuScanDetail() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const [scan, setScan] = useState<MenuScanRow | null>(null);
  const [items, setItems] = useState<MenuItemRow[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [rematching, setRematching] = useState(false);

  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const mark = createStageTimer("menu-detail");
    (async () => {
      try {
        mark("loading stored scan");
        const res = await withTimeout(loadMenuScan(id), 20_000, "Loading that scan took too long");
        if (!active) return;
        if (!res) {
          setMissing(true);
          return;
        }
        setScan(res.scan);
        setItems(res.items);
        mark("stored scan shown", { items: res.items.length });

        // The scan and every price are already persisted. Enrichment starts only
        // after the stored results are visible and can never affect that save.
        if (res.items.length > 0 && res.items.every((item) => item.match_score == null)) {
          setRematching(true);
          mark("matching started");
          void withTimeout(rematchScan(id), 20_000, "Matching took too long")
            .then((updated) => {
              mark("matching finished");
              if (active) setItems(updated);
            })
            .catch((err) => {
              mark("matching failed");
              console.error("Menu matching failed", err);
              if (active) toast.error("Couldn't match these. The list and its prices are safe.");
            })
            .finally(() => {
              if (active) setRematching(false);
            });
        }
      } catch (err) {
        if (!active) return;
        console.error("Could not load menu scan", err);
        setFailure(err instanceof Error ? err.message : "Could not load that scan");
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);


  // Nothing matched at all: the list is stored, matching simply never landed.
  const neverMatched = !!items && items.length > 0 && items.every((i) => i.match_score == null);

  async function onRematch() {
    setRematching(true);
    try {
      const updated = await rematchScan(id);
      setItems(updated);
      toast.success("Matched against your diary.");
    } catch (err) {
      console.error("Re-matching failed", err);
      toast.error("Still couldn't match these. The list and its prices are safe.");
    } finally {
      setRematching(false);
    }
  }

  return (
    <div className="px-5 pt-6 pb-8">
      <Link to="/menus" className="flex items-center gap-1 text-sm text-muted-foreground mb-5">
        <ArrowLeft size={16} /> Past scans
      </Link>

      {failure ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm text-foreground">{failure}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => window.location.reload()}
          >
            Try again
          </Button>
        </div>
      ) : missing ? (
        <p className="text-center text-sm text-muted-foreground py-16">
          That scan is no longer here.
        </p>
      ) : !scan || !items || !user ? (
        <p className="text-center text-sm text-muted-foreground py-16">Loading…</p>
      ) : (
        <>
          <ScanVenue
            scan={scan}
            onChange={(patch) => setScan((s) => (s ? { ...s, ...patch } : s))}
          />

          <header className="mb-6">
            <h1 className="text-3xl font-serif text-primary">
              {scan.restaurant_name ?? "Wine list"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {format(new Date(scan.scanned_at), "d MMM yyyy")} · {items.length}{" "}
              {items.length === 1 ? "wine" : "wines"} read
              {[scan.city, scan.country].filter(Boolean).length
                ? ` · ${[scan.city, scan.country].filter(Boolean).join(", ")}`
                : ""}
              {scan.venue_note ? ` · ${scan.venue_note}` : ""}
            </p>
            {scan.skipped_count > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                Skipped {scan.skipped_count} non-wine item
                {scan.skipped_count === 1 ? "" : "s"}
                {scan.skipped_categories.length ? ` (${scan.skipped_categories.join(", ")})` : ""}
              </p>
            )}
            {neverMatched && (
              <div className="mt-3 rounded-2xl border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">
                  Matching against your diary wasn't available — the list and its prices are saved.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  disabled={rematching}
                  onClick={onRematch}
                >
                  {rematching ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Matching…
                    </>
                  ) : (
                    <>
                      <RotateCcw size={14} /> Try matching again
                    </>
                  )}
                </Button>
              </div>
            )}
          </header>

          <MenuResults
            items={items}
            restaurantName={scan.restaurant_name}
            userId={user.id}
            scanId={scan.id}
          />
        </>
      )}
    </div>
  );
}
