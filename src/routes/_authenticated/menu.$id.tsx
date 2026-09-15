import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/lib/auth-context";
import { loadMenuScan, rematchScan, type MenuItemRow, type MenuScanRow } from "@/lib/menu-match";
import { MenuResults } from "@/components/MenuResults";
import { ScanVenue } from "@/components/ScanVenue";
import { withTimeout } from "@/lib/with-timeout";
import { createStageTimer } from "@/lib/stage-timer";
import { SignedOutError } from "@/lib/session-guard";


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
  const { t } = useTranslation();
  const { user } = useAuth();
  const [scan, setScan] = useState<MenuScanRow | null>(null);
  const [items, setItems] = useState<MenuItemRow[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [matchFailed, setMatchFailed] = useState(false);


  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const mark = createStageTimer("menu-detail");
    mark("results component mounted", { id });
    (async () => {
      try {
        mark("loading stored scan");
        const res = await withTimeout(loadMenuScan(id), 20_000, t("menu.detail.loadTimeout"));
        if (!active) return;
        if (!res) {
          setMissing(true);
          return;
        }
        setScan(res.scan);
        setItems(res.items);
        mark("stored scan shown", { items: res.items.length });

        // The scan and every price are already persisted and now on screen.
        // Matching is enrichment: it can fail without touching the list.
        if (res.items.length > 0 && res.items.every((item) => item.match_score == null)) {
          setRematching(true);
          setMatchFailed(false);
          mark("matching started");
          void withTimeout(rematchScan(id), 15_000, "Matching took too long")
            .then((updated) => {
              mark("matching finished");
              if (active) setItems(updated);
            })
            .catch((err) => {
              mark("matching failed");
              console.error("Menu matching failed", err);
              if (active) setMatchFailed(true);
            })
            .finally(() => {
              if (active) setRematching(false);
            });
        }

      } catch (err) {
        if (!active) return;
        console.error("Could not load menu scan", err);
        setFailure(err instanceof Error ? err.message : t("menu.detail.loadFailed"));
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);


  async function onRematch() {
    setRematching(true);
    setMatchFailed(false);
    try {
      const updated = await withTimeout(rematchScan(id), 15_000, "Matching took too long");
      setItems(updated);
      toast.success(t("menu.detail.matchedAgainstDiary"));
    } catch (err) {
      console.error("Re-matching failed", err);
      setMatchFailed(true);
      if (err instanceof SignedOutError) toast.error(t("menu.detail.signInAgain"));
    } finally {
      setRematching(false);
    }
  }


  return (
    <div className="px-5 pt-6 pb-8">
      <Link to="/menus" className="flex items-center gap-1 text-sm text-muted-foreground mb-5">
        <ArrowLeft size={16} /> {t("menu.detail.pastScans")}
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
            {t("menu.detail.tryAgain")}
          </Button>
        </div>
      ) : missing ? (
        <p className="text-center text-sm text-muted-foreground py-16">
          {t("menu.detail.scanGone")}
        </p>
      ) : !scan || !items || !user ? (
        <p className="text-center text-sm text-muted-foreground py-16">
          {t("menu.detail.loading")}
        </p>
      ) : (
        <>
          <ScanVenue
            scan={scan}
            onChange={(patch) => setScan((s) => (s ? { ...s, ...patch } : s))}
          />

          <header className="mb-6">
            <h1 className="text-3xl font-serif text-primary">
              {scan.restaurant_name ?? t("menu.detail.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {formatDate(scan.scanned_at)} · {t("menu.detail.winesRead", { count: items.length })}
              {[scan.city, scan.country].filter(Boolean).length
                ? ` · ${[scan.city, scan.country].filter(Boolean).join(", ")}`
                : ""}
              {scan.venue_note ? ` · ${scan.venue_note}` : ""}
            </p>
            {scan.skipped_count > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                {scan.skipped_categories.length
                  ? t("menu.detail.skippedWithList", {
                      count: scan.skipped_count,
                      list: scan.skipped_categories.join(", "),
                    })
                  : t("menu.detail.skipped", { count: scan.skipped_count })}
              </p>
            )}
            {/* Inline only: matching never covers or delays the wine list. */}
            {rematching && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 size={12} className="animate-spin" /> {t("menu.detail.checkingDiary")}
              </p>
            )}
            {!rematching && matchFailed && (
              <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                {t("menu.detail.couldntCheckDiary")}
                <Button variant="outline" size="sm" onClick={onRematch}>
                  <RotateCcw size={12} /> {t("menu.detail.retry")}
                </Button>
              </p>
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
