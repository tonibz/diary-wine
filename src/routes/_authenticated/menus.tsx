import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ArrowLeft, ScrollText, ChevronRight, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { downloadCsv, exportMenuItemsCsv, listMenuScans, type MenuScanRow } from "@/lib/menu-match";

export const Route = createFileRoute("/_authenticated/menus")({
  head: () => ({
    meta: [
      { title: "Wine lists you've scanned — Wine Diary" },
      {
        name: "description",
        content: "Every restaurant wine list you have scanned, newest first.",
      },
      { property: "og:title", content: "Wine lists you've scanned" },
      { property: "og:description", content: "Reopen a restaurant's wine list any time." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MenuHistoryPage,
});

function MenuHistoryPage() {
  const [scans, setScans] = useState<Array<MenuScanRow & { item_count: number }> | null>(null);
  const [exporting, setExporting] = useState(false);

  /** Own data only: RLS scopes the export to this user's scans. */
  async function onExport() {
    setExporting(true);
    try {
      const csv = await exportMenuItemsCsv();
      downloadCsv(`wine-diary-menu-prices-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    } catch (err) {
      console.error("Export failed", err);
      toast.error("Couldn't build that export. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    listMenuScans().then(setScans).catch(() => setScans([]));
  }, []);

  return (
    <div className="px-5 pt-6 pb-8">
      <Link to="/diary" className="flex items-center gap-1 text-sm text-muted-foreground mb-5">
        <ArrowLeft size={16} /> Diary
      </Link>

      <header className="mb-6">
        <h1 className="text-3xl font-serif text-primary">Wine lists</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Places you've scanned, newest first.
        </p>
        {!!scans?.length && (
          <Button variant="outline" size="sm" className="mt-4" disabled={exporting} onClick={onExport}>
            <Download size={14} /> {exporting ? "Preparing…" : "Export prices (CSV)"}
          </Button>
        )}
      </header>

      {scans === null ? (
        <p className="text-center text-sm text-muted-foreground py-16">Loading…</p>
      ) : scans.length === 0 ? (
        <div className="text-center py-16">
          <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4 text-primary">
            <ScrollText size={28} />
          </div>
          <h2 className="text-2xl font-serif text-foreground">No lists yet</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto">
            Next time you're handed a wine list, photograph it and I'll tell you what to order.
          </p>
          <Button asChild className="mt-5">
            <Link to="/menu">Scan a menu</Link>
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {scans.map((s) => (
            <li key={s.id}>
              <Link
                to="/menu/$id"
                params={{ id: s.id }}
                className="flex items-center justify-between rounded-2xl bg-card p-4 shadow-notebook border border-border hover:border-primary/30 transition-colors"
              >
                <div className="min-w-0">
                  <h3 className="font-serif text-lg text-foreground truncate">
                    {s.restaurant_name ?? "Unnamed list"}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {format(new Date(s.scanned_at), "d MMM yyyy")} · {s.item_count}{" "}
                    {s.item_count === 1 ? "wine" : "wines"} captured
                    {s.city ? ` · ${s.city}` : ""}
                  </p>
                </div>
                <ChevronRight size={18} className="text-muted-foreground flex-shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
