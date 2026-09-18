import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncData } from "@/lib/use-async-data";
import { ErrorState } from "@/components/ErrorState";
import { formatDate } from "@/lib/format";
import { i18next } from "@/i18n";
import { ArrowLeft, ScrollText, ChevronRight, Download, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  downloadCsv,
  exportMenuItemsCsv,
  listMenuScans,
  updateMenuScanContext,
  type MenuScanRow,
} from "@/lib/menu-match";

export const Route = createFileRoute("/_authenticated/menus")({
  head: () => ({
    meta: [
      { title: `${i18next.t("menus.title")} — Wine Diary` },
      {
        name: "description",
        content: i18next.t("menus.subtitle"),
      },
      { property: "og:title", content: i18next.t("menus.title") },
      { property: "og:description", content: i18next.t("menus.subtitle") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MenuHistoryPage,
});

function MenuHistoryPage() {
  const { t } = useTranslation();
  const {
    data: scans,
    error,
    loading,
    reload,
    setData: setScans,
  } = useAsyncData<Array<MenuScanRow & { item_count: number }>>("/menus", () => listMenuScans());
  const [exporting, setExporting] = useState(false);

  /** Own data only: RLS scopes the export to this user's scans. */
  async function onExport() {
    setExporting(true);
    try {
      const csv = await exportMenuItemsCsv();
      downloadCsv(`wine-diary-menu-prices-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    } catch (err) {
      console.error("Export failed", err);
      toast.error(t("menus.exportFailed"));
    } finally {
      setExporting(false);
    }
  }


  return (
    <div className="px-5 pt-6 pb-8">
      <Link to="/diary" className="flex items-center gap-1 text-sm text-muted-foreground mb-5">
        <ArrowLeft size={16} /> {t("menus.back")}
      </Link>

      <header className="mb-6">
        <h1 className="text-3xl font-serif text-primary">{t("menus.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("menus.subtitle")}
        </p>
        {!!scans?.length && (
          <Button variant="outline" size="sm" className="mt-4" disabled={exporting} onClick={onExport}>
            <Download size={14} /> {exporting ? t("menus.exportPreparing") : t("menus.export")}
          </Button>
        )}
      </header>

      {loading ? (
        <p className="text-center text-sm text-muted-foreground py-16">{t("common.loading")}</p>
      ) : error || scans === null ? (
        // A failed read must not read as "no lists yet".
        <ErrorState onRetry={reload} />
      ) : scans.length === 0 ? (
        <div className="text-center py-16">
          <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4 text-primary">
            <ScrollText size={28} />
          </div>
          <h2 className="text-2xl font-serif text-foreground">{t("menus.emptyTitle")}</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto">
            {t("menus.emptyHint")}
          </p>
          <Button asChild className="mt-5">
            <Link to="/menu">{t("menus.scanCta")}</Link>
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {scans.map((s) => (
            <li key={s.id} className="rounded-2xl bg-card shadow-notebook border border-border">
              <Link
                to="/menu/$id"
                params={{ id: s.id }}
                className="flex items-center justify-between p-4 transition-colors hover:border-primary/30"
              >
                <div className="min-w-0">
                  <h3 className="font-serif text-lg text-foreground truncate">
                    {s.restaurant_name ?? t("menus.unnamed")}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatDate(s.scanned_at, { day: "numeric", month: "short", year: "numeric" })} ·{" "}
                    {t("menus.captured", { count: s.item_count })}
                    {s.city ? ` · ${s.city}` : ""}
                  </p>
                </div>
                <ChevronRight size={18} className="text-muted-foreground flex-shrink-0" />
              </Link>
              {!s.restaurant_name?.trim() && (
                <AddPlace
                  scanId={s.id}
                  onSaved={(name) =>
                    setScans(
                      (list) =>
                        list?.map((x) => (x.id === s.id ? { ...x, restaurant_name: name } : x)) ??
                        list,
                    )
                  }
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A quiet chip: the place can be added straight from the list, inline. */
function AddPlace({ scanId, onSaved }: { scanId: string; onSaved: (name: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await updateMenuScanContext(scanId, { restaurant_name: name.trim() });
      onSaved(name.trim());
    } catch (err) {
      toast.error(t("menus.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="px-4 pb-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-parchment/60 px-3 py-1 text-xs text-muted-foreground"
        >
          <MapPin size={11} /> {t("menus.addPlace")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-2 px-4 pb-4">
      <Input
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        placeholder={t("menus.placePlaceholder")}
        className="bg-background h-9"
      />
      <Button size="sm" disabled={saving || !name.trim()} onClick={() => void save()}>
        {t("common.save")}
      </Button>
    </div>
  );
}
