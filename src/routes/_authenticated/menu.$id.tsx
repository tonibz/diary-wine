import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { loadMenuScan, type MenuItemRow, type MenuScanRow } from "@/lib/menu-match";
import { MenuResults } from "@/components/MenuResults";

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

  useEffect(() => {
    (async () => {
      const res = await loadMenuScan(id);
      if (!res) {
        setMissing(true);
        return;
      }
      setScan(res.scan);
      setItems(res.items);
    })();
  }, [id]);

  return (
    <div className="px-5 pt-6 pb-8">
      <Link to="/menus" className="flex items-center gap-1 text-sm text-muted-foreground mb-5">
        <ArrowLeft size={16} /> Past scans
      </Link>

      {missing ? (
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
          </header>
          <MenuResults items={items} restaurantName={scan.restaurant_name} userId={user.id} />
        </>
      )}
    </div>
  );
}
