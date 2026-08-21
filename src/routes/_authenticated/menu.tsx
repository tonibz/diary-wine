import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { format } from "date-fns";
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
  Save,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/image-compress";
import { readMenuPage } from "@/lib/read-menu.functions";
import type { JsonValue } from "@/lib/read-menu.functions";
import type { MenuParsedItem } from "@/lib/menu-parse";
import {
  findDuplicateScan,
  listRecentRestaurants,
  matchStoredItems,
  saveMenuScan,
  type DuplicateScan,
} from "@/lib/menu-match";
import { readPhotoMeta, reverseGeocodeCity } from "@/lib/photo-meta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

/** What was read, held in memory until the user names the venue and saves. */
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
  const [pages, setPages] = useState<Page[]>([]);
  const [restaurant, setRestaurant] = useState("");
  const [restaurantUnknown, setRestaurantUnknown] = useState(false);
  const [restaurantFromMenu, setRestaurantFromMenu] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [venueNote, setVenueNote] = useState("");
  const [placeFromPhoto, setPlaceFromPhoto] = useState(false);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateScan | null>(null);

  useEffect(() => {
    listRecentRestaurants()
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const chosen = Array.from(files).slice(0, 8 - pages.length);
    setPages((p) => [...p, ...chosen.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
    if (chosen[0]) void prefillPlace(chosen[0]);
  }

  /** City/country from the photo's GPS, only when the user opted in. */
  async function prefillPlace(file: File) {
    if (city || country) return;
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
      if (!place.city && !place.country) return;
      setCity((c) => c || place.city || "");
      setCountry((c) => c || place.country || "");
      setPlaceFromPhoto(true);
    } catch {
      // A missing location is never a reason to block a scan.
    }
  }

  /** Read the photos. Nothing is saved yet: the venue is asked for afterwards. */
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

      // Prefill the venue from the name printed on the menu itself.
      if (!restaurant.trim() && readRestaurant) {
        setRestaurant(readRestaurant);
        setRestaurantFromMenu(true);
      }

      setDraft({
        paths,
        raws,
        items,
        currency,
        restaurantFromMenu: readRestaurant,
        skippedCount: skippedCount + rejectedCount,
        skippedCategories: [...skippedCategories],
      });
      setReading(false);
      setProgress(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not read that wine list";
      setFailure(message);
      toast.error(message);
      setReading(false);
      setProgress(null);
    }
  }

  /** Save, then check the diary — matching is enrichment and can never block. */
  async function persist(supersedeScanId: string | null) {
    if (!draft) return;
    setSaving(true);
    setDuplicate(null);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user!.id;

      setProgress("Saving the list");
      const { scan, items: stored } = await saveMenuScan({
        userId: uid,
        photoPath: draft.paths[0] ?? null,
        restaurantName: restaurantUnknown ? null : restaurant.trim() || null,
        restaurantUnknown,
        raw: { pages: draft.raws } as unknown,
        items: draft.items,
        currency: draft.currency,
        city: city.trim() || null,
        country: country.trim() || null,
        venueNote: venueNote.trim() || null,
        skippedCount: draft.skippedCount,
        skippedCategories: draft.skippedCategories,
        supersedeScanId,
      });

      setProgress(`Matching ${stored.length} wines to your diary`);
      try {
        await matchStoredItems(stored);
      } catch (err) {
        console.error("Menu matching failed", err);
        toast.error(
          "Couldn't match these against your diary. The list and its prices are saved — you can try matching again.",
        );
      }

      navigate({ to: "/menu/$id", params: { id: scan.id } });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not save that wine list";
      setFailure(message);
      toast.error(message);
      setSaving(false);
      setProgress(null);
    }
  }

  async function onSave() {
    if (!draft) return;
    if (!restaurant.trim() && !restaurantUnknown) {
      toast.error("Add the restaurant name, or choose “Not sure”.");
      return;
    }
    setFailure(null);
    setSaving(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user!.id;
      const dup = await withTimeout(
        findDuplicateScan({
          userId: uid,
          restaurantName: restaurantUnknown ? null : restaurant.trim() || null,
          names: draft.items.filter((i) => !i.rejected).map((i) => i.name ?? ""),
        }),
        15_000,
      ).catch(() => null);
      if (dup) {
        setDuplicate(dup);
        setSaving(false);
        return;
      }
    } catch {
      // A duplicate check that fails must never stop the list being saved.
    }
    setSaving(false);
    await persist(null);
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

  const wines = (draft?.items ?? []).filter((i) => !i.rejected);
  const unreadable = wines.filter((i) => i.truncated);
  const busy = reading || saving;

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
        <h1 className="text-3xl font-serif text-primary">
          {draft ? "Where was this list?" : "Scan a wine list"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {draft
            ? `I read ${wines.length} ${wines.length === 1 ? "wine" : "wines"}. A price only means something with a venue attached, so tell me where this was.`
            : "Photograph the list — every page if it's long — and I'll tell you which ones you already know."}
        </p>
      </header>

      {draft && (
        <div className="space-y-4 mb-5">
          <div className="space-y-2">
            <Label htmlFor="restaurant">Restaurant</Label>
            <Input
              id="restaurant"
              value={restaurant}
              onChange={(e) => {
                setRestaurant(e.target.value);
                setRestaurantUnknown(false);
                setRestaurantFromMenu(false);
              }}
              placeholder="Where were you?"
              className="bg-card"
              disabled={restaurantUnknown}
            />
            {restaurantFromMenu && restaurant.trim() && (
              <p className="text-xs text-muted-foreground">
                Read off the menu — edit it if that's not the name.
              </p>
            )}
            {recent.length > 0 && !restaurantUnknown && (
              <div className="flex flex-wrap gap-2 pt-1">
                {recent.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      setRestaurant(name);
                      setRestaurantFromMenu(false);
                    }}
                    className="rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground"
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setRestaurantUnknown((v) => !v);
                setRestaurantFromMenu(false);
              }}
              className="text-xs underline text-muted-foreground pt-1"
            >
              {restaurantUnknown
                ? "Actually, I know where this was"
                : "I'm not sure where this was"}
            </button>
            {restaurantUnknown && (
              <p className="text-xs text-muted-foreground">
                Recorded as “not sure”, so these prices are kept out of venue comparisons.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  setPlaceFromPhoto(false);
                }}
                placeholder="Optional"
                className="bg-card"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="country">Country</Label>
              <Input
                id="country"
                value={country}
                onChange={(e) => {
                  setCountry(e.target.value);
                  setPlaceFromPhoto(false);
                }}
                placeholder="Optional"
                className="bg-card"
              />
            </div>
          </div>
          {placeFromPhoto && (
            <p className="text-xs text-muted-foreground">
              From the photo's location — edit if wrong.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="venue-note">Kind of place</Label>
            <Input
              id="venue-note"
              value={venueNote}
              onChange={(e) => setVenueNote(e.target.value)}
              placeholder="Wine bar, fine dining, trattoria…"
              className="bg-card"
            />
          </div>

          <div className="rounded-2xl border border-border bg-parchment/60 p-4 text-sm text-muted-foreground space-y-1">
            <p>
              {wines.length} {wines.length === 1 ? "wine" : "wines"} ready to save.
            </p>
            {draft.skippedCount > 0 && (
              <p>
                Skipped {draft.skippedCount} non-wine item{draft.skippedCount === 1 ? "" : "s"}
                {draft.skippedCategories.length ? ` (${draft.skippedCategories.join(", ")})` : ""}.
              </p>
            )}
            {unreadable.length > 0 && (
              <p>
                {unreadable.length} line{unreadable.length === 1 ? "" : "s"} came out cut off — you
                can fix or discard {unreadable.length === 1 ? "it" : "them"} on the next screen.
              </p>
            )}
          </div>
        </div>
      )}

      {!draft && pages.length > 0 && (
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

      {!draft && (
        <>
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
        </>
      )}

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
            onClick={() => (draft ? onSave() : onRead())}
          >
            <RotateCcw size={14} /> Try again
          </Button>
        </div>
      )}

      {draft ? (
        <Button className="w-full mt-6" disabled={saving} onClick={onSave}>
          {saving ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              {progress ?? "Saving…"}
            </>
          ) : (
            <>
              <Save size={16} /> Save this list
            </>
          )}
        </Button>
      ) : (
        <Button className="w-full mt-6" disabled={!pages.length || busy} onClick={onRead}>
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
      )}

      <p className="text-xs text-muted-foreground mt-3 text-center">
        Nothing here goes into your diary until you say you ordered something.
      </p>

      <AlertDialog open={!!duplicate} onOpenChange={(o) => !o && setDuplicate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This looks like the same list</AlertDialogTitle>
            <AlertDialogDescription>
              This looks like the same list you scanned earlier today
              {duplicate?.scan.restaurant_name ? ` at ${duplicate.scan.restaurant_name}` : ""}
              {duplicate ? ` (${format(new Date(duplicate.scan.scanned_at), "HH:mm")}, ${duplicate.itemCount} wines` : ""}
              {duplicate && duplicate.reason === "items"
                ? `, ${Math.round(duplicate.overlap * 100)}% the same wines)`
                : duplicate
                  ? ")"
                  : ""}
              . Replace that scan, or save as a new one?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            <AlertDialogAction
              onClick={() => void persist(duplicate?.scan.id ?? null)}
              className="w-full"
            >
              Replace that scan
            </AlertDialogAction>
            <Button variant="outline" className="w-full" onClick={() => void persist(null)}>
              Save as a new scan
            </Button>
            <AlertDialogCancel className="w-full">Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
