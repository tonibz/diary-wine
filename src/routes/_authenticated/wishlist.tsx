import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getSignedPhotoUrls } from "@/lib/wine-photo";
import { Button } from "@/components/ui/button";
import { Bookmark, Wine } from "lucide-react";

export const Route = createFileRoute("/_authenticated/wishlist")({
  head: () => ({
    meta: [
      { title: "Wishlist — Wine Diary" },
      { name: "description", content: "Bottles you have spotted and want to remember to try." },
      { property: "og:title", content: "My Wishlist" },
      { property: "og:description", content: "Bottles you want to try one day." },
    ],
  }),
  component: WishlistPage,
});

type Item = {
  id: string;
  photo_url: string | null;
  notes: string | null;
  vintage_row: {
    vintage: number | null;
    wine: {
      name: string;
      producer: string | null;
      region: string | null;
      country: string | null;
      label_image_url: string | null;
    } | null;
  } | null;
  display_photo: string | null;
};

function WishlistPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("entries")
        .select(
          "id, photo_url, notes, vintage_row:wine_vintages(vintage, wine:wines(name, producer, region, country, label_image_url))",
        )
        .eq("status", "interested")
        .order("created_at", { ascending: false });
      const rows = (data ?? []) as unknown as Item[];
      const signed = await getSignedPhotoUrls(rows.map((r) => r.photo_url ?? null));
      rows.forEach((r, i) => { r.display_photo = signed[i]; });
      setItems(rows);
    })();
  }, []);

  return (
    <div className="px-5 pt-8 pb-8">
      <header className="mb-6">
        <h1 className="text-4xl font-serif text-primary">Wishlist</h1>
        <p className="text-sm text-muted-foreground mt-1">Bottles you've spotted and fancy trying.</p>
      </header>

      {items === null ? (
        <p className="text-center text-muted-foreground py-16 text-sm">Loading…</p>
      ) : items.length === 0 ? (
        <div className="text-center py-16 px-4">
          <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4 text-primary">
            <Bookmark size={28} />
          </div>
          <h2 className="text-2xl font-serif text-foreground">Nothing on the list yet</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto">
            Saw something on a shelf or a friend's table? Add it with the + button and pick
            "Haven't tried it yet".
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => {
            const w = it.vintage_row?.wine;
            return (
              <li key={it.id} className="rounded-2xl bg-card p-4 shadow-notebook border border-border">
                <Link to="/entry/$id" params={{ id: it.id }} className="flex gap-3">
                  <div className="h-20 w-16 flex-shrink-0 rounded-lg bg-parchment overflow-hidden flex items-center justify-center">
                    {it.display_photo ? (
                      <img src={it.display_photo} alt={w?.name ?? "wine"} className="h-full w-full object-cover" />
                    ) : (
                      <Wine className="text-primary/40" size={24} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-serif text-lg leading-tight text-foreground truncate">
                      {w?.name ?? "Untitled"}{" "}
                      {it.vintage_row?.vintage && (
                        <span className="text-muted-foreground text-sm font-sans">· {it.vintage_row.vintage}</span>
                      )}
                    </h3>
                    {w?.producer && <p className="text-sm text-muted-foreground truncate">{w.producer}</p>}
                    {(w?.region || w?.country) && (
                      <p className="text-xs text-muted-foreground truncate">
                        {[w?.region, w?.country].filter(Boolean).join(", ")}
                      </p>
                    )}
                    {it.notes && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{it.notes}</p>}
                  </div>
                </Link>
                <Button
                  variant="secondary"
                  className="w-full mt-3"
                  onClick={() => navigate({ to: "/entry/$id", params: { id: it.id } })}
                >
                  I've tried this now
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
