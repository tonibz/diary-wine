import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  Camera,
  Images,
  Loader2,
  ScrollText,
  X,
  History,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/image-compress";
import { readMenuPage } from "@/lib/read-menu.functions";
import type { JsonValue } from "@/lib/read-menu.functions";
import type { MenuParsedItem } from "@/lib/menu-parse";
import { matchItemsToCatalogue, saveMenuScan } from "@/lib/menu-match";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";


export const Route = createFileRoute("/_authenticated/menu")({
  head: () => ({
    meta: [
      { title: "Scan a wine list — Wine Diary" },
      {
        name: "description",
        content: "Photograph a restaurant wine list and see which bottles you already know.",
      },
      { property: "og:title", content: "Scan a wine list" },
      { property: "og:description", content: "Know what to order from any wine list." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MenuScanPage,
});

type Page = { file: File; preview: string };

function MenuScanPage() {
  const navigate = useNavigate();
  const readPage = useServerFn(readMenuPage);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [restaurant, setRestaurant] = useState("");
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const next = Array.from(files)
      .slice(0, 8 - pages.length)
      .map((file) => ({ file, preview: URL.createObjectURL(file) }));
    setPages((p) => [...p, ...next]);
  }

  async function onRead() {
    if (!pages.length) return;
    setReading(true);
    setFailure(null);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user!.id;

      const paths: string[] = [];
      for (const [i, p] of pages.entries()) {
        setProgress(`Uploading page ${i + 1} of ${pages.length}`);
        const compressed = await compressImage(p.file);
        const path = `${uid}/${crypto.randomUUID()}.jpg`;
        const up = await supabase.storage
          .from("wine-photos")
          .upload(path, compressed, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
        paths.push(path);
      }

      // One call per page: a whole list in a single request is truncated and
      // can outrun the request timeout.
      const items: MenuParsedItem[] = [];
      const raws: JsonValue[] = [];
      const pageErrors: string[] = [];
      let restaurantFromMenu: string | null = null;
      let currency: string | null = null;
      let salvagedPages = 0;

      for (const [i, path] of paths.entries()) {
        setProgress(`Reading page ${i + 1} of ${paths.length}`);
        const res = await readMenuPageSafe(i + 1, path);
        if (!res.ok) {
          pageErrors.push(res.error);
          continue;
        }
        raws.push(res.raw);
        if (res.salvaged) salvagedPages++;
        restaurantFromMenu ??= res.restaurant_name;
        currency ??= res.currency;
        items.push(...res.items);
      }

      if (!items.length) {
        throw new Error(
          pageErrors[0] ??
            (paths.length > 1 ? "No wines found on those photos" : "No wines found on that photo"),
        );
      }

      setProgress(`Matching ${items.length} wines to your diary`);
      const matches = await matchItemsToCatalogue(items);
      const { scan } = await saveMenuScan({
        userId: uid,
        photoPath: paths[0] ?? null,
        restaurantName: restaurant.trim() || restaurantFromMenu,
        raw: { pages: raws } as unknown,
        items,
        currency,
        matches,
      });

      if (salvagedPages > 0) {
        toast.warning(
          `One page was very long — I saved the ${items.length} wines I could read. Photograph fewer pages at once for the rest.`,
        );
      }
      if (pageErrors.length) {
        toast.error(`${pageErrors.length} page(s) couldn't be read: ${pageErrors[0]}`);
      }
      navigate({ to: "/menu/$id", params: { id: scan.id } });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not read that wine list";
      setFailure(message);
      toast.error(message);
      setReading(false);
      setProgress(null);
    }
  }

  /** Never let a page failure escape as a swallowed exception. */
  async function readMenuPageSafe(pageNumber: number, path: string) {
    try {
      return await readPage({ data: { photoPath: path, pageNumber } });
    } catch (e) {
      return {
        ok: false as const,
        error:
          e instanceof Error && /abort|timeout|network|fetch/i.test(e.message)
            ? `Page ${pageNumber} timed out — try again with fewer pages at once`
            : e instanceof Error
              ? `Page ${pageNumber}: ${e.message}`
              : `Page ${pageNumber} could not be read`,
        raw: null as JsonValue,
      };
    }
  }


  return (
    <div className="px-5 pt-6 pb-8">
      <div className="flex items-center justify-between mb-5">
        <Link to="/diary" className="flex items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft size={16} /> Diary
        </Link>
        <Link to="/menus" className="flex items-center gap-1 text-sm text-muted-foreground">
          <History size={15} /> Past scans
        </Link>
      </div>

      <header className="mb-6">
        <h1 className="text-3xl font-serif text-primary">Scan a wine list</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Photograph the list — every page if it's long — and I'll tell you which ones you already
          know.
        </p>
      </header>

      <div className="space-y-2 mb-5">
        <Label htmlFor="restaurant">Restaurant (optional)</Label>
        <Input
          id="restaurant"
          value={restaurant}
          onChange={(e) => setRestaurant(e.target.value)}
          placeholder="Where are you?"
          className="bg-card"
        />
      </div>

      {pages.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 mb-5">
          {pages.map((p, i) => (
            <li key={p.preview} className="relative aspect-[3/4] rounded-xl overflow-hidden bg-parchment">
              <img src={p.preview} alt={`Menu page ${i + 1}`} className="h-full w-full object-cover" />
              {!reading && (
                <button
                  type="button"
                  onClick={() => setPages((ps) => ps.filter((_, k) => k !== i))}
                  aria-label={`Remove page ${i + 1}`}
                  className="absolute top-1 right-1 rounded-full bg-background/90 p-1 text-foreground"
                >
                  <X size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" disabled={reading} onClick={() => cameraRef.current?.click()}>
          <Camera size={16} /> Take a photo
        </Button>
        <Button variant="outline" disabled={reading} onClick={() => galleryRef.current?.click()}>
          <Images size={16} /> Choose photos
        </Button>
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />

      {failure && (
        <div className="mt-6 rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
          <p className="flex gap-2 text-sm text-foreground">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-destructive" />
            <span>{failure}</span>
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onRead}>
            <RotateCcw size={14} /> Try again
          </Button>
        </div>
      )}

      <Button className="w-full mt-6" disabled={!pages.length || reading} onClick={onRead}>
        {reading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            {progress ?? "Reading the list…"}
          </>
        ) : (
          <>
            <ScrollText size={16} /> {failure ? "Read this list again" : "Read this list"}
            {pages.length > 1 ? ` (${pages.length} pages)` : ""}
          </>
        )}
      </Button>

      <p className="text-xs text-muted-foreground mt-3 text-center">
        Nothing here goes into your diary until you say you ordered something.
      </p>
    </div>
  );
}
