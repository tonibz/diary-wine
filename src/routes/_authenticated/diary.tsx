import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { getSignedPhotoUrls } from "@/lib/wine-photo";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StarRating } from "@/components/StarRating";
import { Wine, Search, ScrollText, ChevronRight } from "lucide-react";
import { formatDateShort } from "@/lib/format";
import { wineTypeLabel } from "@/lib/wine-type";
import { i18next } from "@/i18n";

type Entry = {
  id: string;
  photo_url: string | null;
  rating: number | null;
  tasted_on: string;
  place: string | null;
  company: string | null;
  vintage_row: {
    id: string;
    vintage: number | null;
    wine: {
      id: string;
      name: string;
      producer: string | null;
      wine_type: string | null;
      label_image_url: string | null;
    } | null;
  } | null;
  display_photo: string | null;
};


export const Route = createFileRoute("/_authenticated/diary")({
  head: () => ({
    meta: [
      { title: i18next.t("diary.metaTitle") },
      { name: "description", content: i18next.t("diary.metaDescription") },
      { property: "og:title", content: i18next.t("diary.metaOgTitle") },
      { property: "og:description", content: i18next.t("diary.metaOgDescription") },
    ],
  }),
  component: DiaryPage,
});

function DiaryPage() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [minRating, setMinRating] = useState<string>("0");

  useEffect(() => {
    (async () => {
      // Wishlist items (status 'interested') never appear in the diary.
      const { data } = await supabase
        .from("entries")
        .select(
          "id, photo_url, rating, tasted_on, place, company, vintage_row:wine_vintages(id, vintage, wine:wines(id, name, producer, wine_type, label_image_url))",
        )
        .eq("status", "tasted")
        .order("created_at", { ascending: false });
      const rows = (data ?? []) as unknown as Entry[];
      const refs = rows.map((e) => e.photo_url ?? e.vintage_row?.wine?.label_image_url ?? null);
      const signed = await getSignedPhotoUrls(refs);
      rows.forEach((e, i) => { e.display_photo = signed[i]; });
      setEntries(rows);
    })();
  }, []);


  const filtered = useMemo(() => {
    if (!entries) return null;
    const ql = q.trim().toLowerCase();
    return entries.filter((e) => {
      if (typeFilter !== "all" && e.vintage_row?.wine?.wine_type !== typeFilter) return false;
      if (Number(minRating) > 0 && (e.rating ?? 0) < Number(minRating)) return false;
      if (ql) {
        const hay = `${e.vintage_row?.wine?.name ?? ""} ${e.vintage_row?.wine?.producer ?? ""} ${e.place ?? ""}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  }, [entries, q, typeFilter, minRating]);

  return (
    <div className="px-5 pt-8 pb-8">
      <header className="mb-6">
        <h1 className="text-4xl font-serif text-primary">{t("diary.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("diary.subtitle")}</p>
      </header>

      <Link
        to="/menu"
        className="mb-5 flex items-center gap-3 rounded-2xl border border-primary/30 bg-card px-4 py-3 shadow-notebook hover:border-primary/60"
      >
        <ScrollText size={20} className="text-primary shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{t("diary.scanMenu")}</span>
          <span className="block text-xs text-muted-foreground">
            {t("diary.scanMenuHint")}
          </span>
        </span>
        <ChevronRight size={16} className="text-muted-foreground shrink-0" />
      </Link>

      <div className="space-y-2 mb-5">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("diary.searchPlaceholder")}
            className="pl-9 bg-card"
          />
        </div>
        <div className="flex gap-2">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="bg-card"><SelectValue placeholder={t("diary.allTypes")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("diary.allTypes")}</SelectItem>
              <SelectItem value="red">{wineTypeLabel("red")}</SelectItem>
              <SelectItem value="white">{wineTypeLabel("white")}</SelectItem>
              <SelectItem value="rose">{wineTypeLabel("rose")}</SelectItem>
              <SelectItem value="sparkling">{wineTypeLabel("sparkling")}</SelectItem>
              <SelectItem value="dessert">{wineTypeLabel("dessert")}</SelectItem>
              <SelectItem value="fortified">{wineTypeLabel("fortified")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={minRating} onValueChange={setMinRating}>
            <SelectTrigger className="bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{t("diary.anyRating")}</SelectItem>
              <SelectItem value="3">{t("diary.ratingAtLeast", { count: 3 })}</SelectItem>
              <SelectItem value="4">{t("diary.ratingAtLeast", { count: 4 })}</SelectItem>
              <SelectItem value="5">{t("diary.ratingOnly", { count: 5 })}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {filtered === null ? (
        <p className="text-center text-muted-foreground py-16 text-sm">{t("diary.loading")}</p>
      ) : filtered.length === 0 ? (
        <EmptyDiary hasEntries={(entries?.length ?? 0) > 0} />
      ) : (
        <ul className="space-y-3">
          {filtered.map((e) => (
            <li key={e.id}>
              <Link
                to="/entry/$id"
                params={{ id: e.id }}
                className="block rounded-2xl bg-card p-4 shadow-notebook border border-border hover:border-primary/30 transition-colors"
              >
                <div className="flex gap-3">
                  <div className="h-20 w-16 flex-shrink-0 rounded-lg bg-parchment overflow-hidden flex items-center justify-center">
                    {e.display_photo ? (
                      <img
                        src={e.display_photo}
                        alt={e.vintage_row?.wine?.name ?? t("diary.wineAltFallback")}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Wine className="text-primary/40" size={24} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-serif text-lg leading-tight text-foreground truncate">
                      {e.vintage_row?.wine?.name ?? t("diary.untitled")}{" "}
                      {e.vintage_row?.vintage && (
                        <span className="text-muted-foreground text-sm font-sans">· {e.vintage_row.vintage}</span>
                      )}

                    </h3>
                    {e.vintage_row?.wine?.producer && (
                      <p className="text-sm text-muted-foreground truncate">{e.vintage_row.wine.producer}</p>
                    )}
                    <div className="mt-1.5">
                      <StarRating value={e.rating ?? 0} size={14} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {[e.place, formatDateShort(e.tasted_on)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyDiary({ hasEntries }: { hasEntries: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="text-center py-16 px-4">
      <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4 text-primary">
        <Wine size={30} />
      </div>
      <h2 className="text-2xl font-serif text-foreground">
        {hasEntries ? t("diary.emptyFiltered") : t("diary.emptyTitle")}
      </h2>
      <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto">
        {hasEntries
          ? t("diary.emptyFilteredHint")
          : t("diary.emptyHint")}
      </p>
    </div>
  );
}
