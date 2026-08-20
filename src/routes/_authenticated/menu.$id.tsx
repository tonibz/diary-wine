import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ArrowLeft, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { loadMenuScan, rematchScan, type MenuItemRow, type MenuScanRow } from "@/lib/menu-match";
import { MenuResults } from "@/components/MenuResults";
import { withTimeout } from "@/lib/with-timeout";
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
    (async () => {
      try {
        const res = await withTimeout(loadMenuScan(id));
        if (!res) {
          setMissing(true);
          return;
        }
        setScan(res.scan);
        setItems(res.items);
      } catch (err) {
        console.error("Could not load menu scan", err);
        setFailure(err instanceof Error ? err.message : "Could not load that scan");
      }
    })();
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
          <Button variant="outline" size="sm" className="mt-3" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      ) : missing ? (
        <p className="text-center text-sm text-muted-foreground py-16">That scan is no longer here.</p>
      ) : !scan || !items || !user ? (
        <p className="text-center text-sm text-muted-foreground py-16">Loading…</p>

      ) : (
        <>
          <header className="mb-6">
            <h1 className="text-3xl font-serif text-primary">
              {scan.restaurant_name ?? "Wine list"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {format(new Date(scan.scanned_at), "d MMM yyyy")} · {items.length}{" "}
              {items.length === 1 ? "wine" : "wines"} read
            </p>
            {scan.skipped_count > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                Skipped {scan.skipped_count} non-wine item
                {scan.skipped_count === 1 ? "" : "s"}
                {scan.skipped_categories.length
                  ? ` (${scan.skipped_categories.join(", ")})`
                  : ""}
              </p>
            )}
          </header>

          <MenuResults items={items} restaurantName={scan.restaurant_name} userId={user.id} />
        </>
      )}
    </div>
  );
}
