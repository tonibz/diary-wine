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
import { saveMenuScan } from "@/lib/menu-match";
import { readPhotoMeta, reverseGeocodeCity } from "@/lib/photo-meta";
import { Button } from "@/components/ui/button";
import { withTimeout } from "@/lib/with-timeout";

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

/** Everything read off the photos, held only long enough to save it. */
type Draft = {
  paths: string[];
  raws: JsonValue[];
  items: MenuParsedItem[];
  currency: string | null;
  restaurantFromMenu: string | null;
  skippedCount: number;
  skippedCategories: string[];
};

function MenuScanPage() {
  const navigate = useNavigate();
  const readPage = useServerFn(readMenuPage);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  // Read from the photo's GPS in the background: never asked for, never blocking.
  const placeRef = useRef<{ city: string | null; country: string | null }>({
    city: null,
    country: null,
  });
  const [pages, setPages] = useState<Page[]>([]);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState<Draft | null>(null);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const chosen = Array.from(files).slice(0, 8 - pages.length);
    setPages((p) => [
      ...p,
      ...chosen.map((file) => ({ file, preview: URL.createObjectURL(file) })),
    ]);
    if (chosen[0]) void prefillPlace(chosen[0]);
  }

  /** City/country from the photo's GPS, only when the user opted in. */
  async function prefillPlace(file: File) {
    if (placeRef.current.city || placeRef.current.country) return;
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("gps_lookup_enabled")
        .eq("id", uid)
        .maybeSingle();
      if (!profile?.gps_lookup_enabled) return;
      const meta = await readPhotoMeta(file);
      if (!meta.gps) return;
      const place = await reverseGeocodeCity(meta.gps.lat, meta.gps.lon);
      placeRef.current = { city: place.city ?? null, country: place.country ?? null };
    } catch {
      // A missing location is never a reason to block a scan.
    }
  }

  /** Read the photos, then save straight away — the venue is asked for later. */
  async function onRead() {
    if (!pages.length) return;
    const mark = createStageTimer("menu-scan");
    setReading(true);
    setFailure(null);
    try {
      const { data: userRes } = await withTimeout(
        supabase.auth.getUser(),
        20_000,
        "Could not confirm your sign-in — please try again",
      );
      const uid = userRes.user!.id;
      uidRef.current = uid;
      mark("user resolved");

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
      mark("uploads complete", { pages: paths.length });

      // One call per page: a whole list in a single request is truncated and
      // can outrun the request timeout.
      const items: MenuParsedItem[] = [];
      const raws: JsonValue[] = [];
      const pageErrors: string[] = [];
      let readRestaurant: string | null = null;
      let currency: string | null = null;
      let salvagedPages = 0;
      let skippedCount = 0;
      const skippedCategories = new Set<string>();

      for (const [i, path] of paths.entries()) {
        setProgress(`Reading page ${i + 1} of ${paths.length}`);
        const res = await readMenuPageSafe(i + 1, path);
        if (!res.ok) {
          pageErrors.push(res.error);
          continue;
        }
        raws.push(res.raw);
        if (res.salvaged) salvagedPages++;
        skippedCount += res.skipped_count;
        for (const c of res.skipped_categories) skippedCategories.add(c);
        readRestaurant ??= res.restaurant_name;
        currency ??= res.currency;
        items.push(...res.items);
      }
      mark("read complete", { items: items.length, failedPages: pageErrors.length });

      const rejectedCount = items.filter((it) => it.rejected).length;
      const wines = items.filter((it) => !it.rejected);

      if (!wines.length) {
        throw new Error(
          pageErrors[0] ??
            (paths.length > 1 ? "No wines found on those photos" : "No wines found on that photo"),
        );
      }

      if (salvagedPages > 0) {
        toast.warning(
          `One page was very long — I read the ${wines.length} wines I could. Photograph fewer pages at once for the rest.`,
        );
      }
      if (pageErrors.length) {
        toast.error(`${pageErrors.length} page(s) couldn't be read: ${pageErrors[0]}`);
      }

      const draft: Draft = {
        paths,
        raws,
        items,
        currency,
        restaurantFromMenu: readRestaurant,
        skippedCount: skippedCount + rejectedCount,
        skippedCategories: [...skippedCategories],
      };

      await persist(draft, mark);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not read that wine list";
      setFailure(message);
      toast.error(message);
      setReading(false);
      setProgress(null);
    }
  }

  /**
   * Two inserts and nothing else, then leave. Matching, appellation lookups,
   * recommendations and every other enrichment happen on the results screen,
   * so none of them can hold the user on a spinner.
   */
  async function persist(draft: Draft, mark = createStageTimer("menu-scan")) {
    setPending(null);
    setReading(true);
    try {
      const uid = uidRef.current ?? (await supabase.auth.getUser()).data.user!.id;
      uidRef.current = uid;

      setProgress("Saving the list");
      const { scan } = await withTimeout(
        saveMenuScan({
          userId: uid,
          photoPath: draft.paths[0] ?? null,
          restaurantName: draft.restaurantFromMenu,
          raw: { pages: draft.raws } as unknown,
          items: draft.items,
          currency: draft.currency,
          city: placeRef.current.city,
          country: placeRef.current.country,
          skippedCount: draft.skippedCount,
          skippedCategories: draft.skippedCategories,
          onStage: mark,
        }),
        20_000,
        "Saving took too long",
      );
      mark("save complete", { scanId: scan.id });

      goToResults(scan.id, mark);
    } catch (e) {
      // The rows are usually already written by the time a save times out, so
      // land on the newest scan rather than on an endless spinner.
      const lastId = await newestScanId(uidRef.current).catch(() => null);
      if (lastId) {
        mark("save timed out — opening newest scan", { scanId: lastId });
        goToResults(lastId, mark);
        return;
      }
      const message = e instanceof Error ? e.message : "Could not save that wine list";
      setFailure(message);
      toast.error(message);
      setPending(draft);
      setReading(false);
      setProgress(null);
    }
  }

  /**
   * The protected-route gate re-checks the session before the results screen
   * renders. If that check stalls the router never moves, so a hard navigation
   * takes over rather than leaving the user watching a spinner.
   */
  function goToResults(id: string, mark: (stage: string) => void) {
    const path = `/menu/${id}`;
    void navigate({ to: "/menu/$id", params: { id } });
    mark("navigate requested");
    setTimeout(() => {
      if (!window.location.pathname.endsWith(path)) {
        mark("router stalled — hard navigation");
        window.location.assign(path);
      } else {
        mark("navigated");
      }
    }, 1500);
  }


  /** Never let a page failure escape as a swallowed exception. */
  async function readMenuPageSafe(pageNumber: number, path: string) {
    try {
      return await withTimeout(
        readPage({ data: { photoPath: path, pageNumber } }),
        120_000,
        `Page ${pageNumber} took too long — try again with fewer pages at once`,
      );
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

  const busy = reading;

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

      {pages.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 mb-5">
          {pages.map((p, i) => (
            <li
              key={p.preview}
              className="relative aspect-[3/4] rounded-xl overflow-hidden bg-parchment"
            >
              <img
                src={p.preview}
                alt={`Menu page ${i + 1}`}
                className="h-full w-full object-cover"
              />
              {!busy && (
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
        <Button variant="outline" disabled={busy} onClick={() => cameraRef.current?.click()}>
          <Camera size={16} /> Take a photo
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => galleryRef.current?.click()}>
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
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => (pending ? void persist(pending, null) : void onRead())}
          >
            <RotateCcw size={14} /> Try again
          </Button>
        </div>
      )}

      <Button className="w-full mt-6" disabled={!pages.length || busy} onClick={onRead}>
        {reading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            {progress ?? "Reading the list…"}
          </>
        ) : (
          <>
            <ScrollText size={16} /> Read this list
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
