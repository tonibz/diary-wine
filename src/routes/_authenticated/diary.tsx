import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StarRating } from "@/components/StarRating";
import { Wine, Search } from "lucide-react";
import { format } from "date-fns";

type Entry = {
  id: string;
  photo_url: string | null;
  rating: number | null;
  tasted_on: string;
  place: string | null;
  company: string | null;
  wine: {
    id: string;
    name: string;
    producer: string | null;
    vintage: number | null;
    wine_type: string | null;
    label_image_url: string | null;
  } | null;
};

export const Route = createFileRoute("/_authenticated/diary")({
  head: () => ({
    meta: [
      { title: "My Diary — Wine Diary" },
      { name: "description", content: "Every wine you have logged, most recent first." },
      { property: "og:title", content: "My Diary" },
      { property: "og:description", content: "Every wine you have logged." },
    ],
  }),
  component: DiaryPage,
});

function DiaryPage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [minRating, setMinRating] = useState<string>("0");

  useEffect(() => {
    supabase
      .from("entries")
      .select("id, photo_url, rating, tasted_on, place, company, wine:wines(id, name, producer, vintage, wine_type, label_image_url)")
      .order("created_at", { ascending: false })
      .then(({ data }) => setEntries((data ?? []) as unknown as Entry[]));
  }, []);

  const filtered = useMemo(() => {
    if (!entries) return null;
    const ql = q.trim().toLowerCase();
    return entries.filter((e) => {
      if (typeFilter !== "all" && e.wine?.wine_type !== typeFilter) return false;
      if (Number(minRating) > 0 && (e.rating ?? 0) < Number(minRating)) return false;
      if (ql) {
        const hay = `${e.wine?.name ?? ""} ${e.wine?.producer ?? ""} ${e.place ?? ""}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  }, [entries, q, typeFilter, minRating]);

  return (
    <div className="px-5 pt-8 pb-8">
      <header className="mb-6">
        <h1 className="text-4xl font-serif text-primary">My Diary</h1>
        <p className="text-sm text-muted-foreground mt-1">Every bottle, in your own words.</p>
      </header>

      <div className="space-y-2 mb-5">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, producer, place…"
            className="pl-9 bg-card"
          />
        </div>
        <div className="flex gap-2">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="bg-card"><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="red">Red</SelectItem>
              <SelectItem value="white">White</SelectItem>
              <SelectItem value="rose">Rosé</SelectItem>
              <SelectItem value="sparkling">Sparkling</SelectItem>
              <SelectItem value="dessert">Dessert</SelectItem>
              <SelectItem value="fortified">Fortified</SelectItem>
            </SelectContent>
          </Select>
          <Select value={minRating} onValueChange={setMinRating}>
            <SelectTrigger className="bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Any rating</SelectItem>
              <SelectItem value="3">3★ +</SelectItem>
              <SelectItem value="4">4★ +</SelectItem>
              <SelectItem value="5">5★ only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {filtered === null ? (
        <p className="text-center text-muted-foreground py-16 text-sm">Loading…</p>
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
                    {e.photo_url || e.wine?.label_image_url ? (
                      <img
                        src={e.photo_url ?? e.wine?.label_image_url ?? ""}
                        alt={e.wine?.name ?? "wine"}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Wine className="text-primary/40" size={24} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-serif text-lg leading-tight text-foreground truncate">
                      {e.wine?.name ?? "Untitled"}{" "}
                      {e.wine?.vintage && (
                        <span className="text-muted-foreground text-sm font-sans">· {e.wine.vintage}</span>
                      )}
                    </h3>
                    {e.wine?.producer && (
                      <p className="text-sm text-muted-foreground truncate">{e.wine.producer}</p>
                    )}
                    <div className="mt-1.5">
                      <StarRating value={e.rating ?? 0} size={14} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {[e.place, format(new Date(e.tasted_on), "d MMM yyyy")].filter(Boolean).join(" · ")}
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
  return (
    <div className="text-center py-16 px-4">
      <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4 text-primary">
        <Wine size={30} />
      </div>
      <h2 className="text-2xl font-serif text-foreground">
        {hasEntries ? "Nothing matches that." : "Your first bottle awaits"}
      </h2>
      <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto">
        {hasEntries
          ? "Try clearing your filters."
          : "Tap the + button to log the first wine you'd like to remember."}
      </p>
    </div>
  );
}
