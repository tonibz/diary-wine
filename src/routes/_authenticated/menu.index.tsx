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
import { saveMenuScan, appendMenuItems, updateMenuScanContext } from "@/lib/menu-match";
import { readPhotoMeta, reverseGeocodeCity } from "@/lib/photo-meta";
import { Button } from "@/components/ui/button";
import { withTimeout } from "@/lib/with-timeout";
import { createStageTimer } from "@/lib/stage-timer";
import { i18next } from "@/i18n";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/menu/")({
  head: () => ({
    meta: [
      { title: i18next.t("menu.scan.metaTitle") },
      {
        name: "description",
        content: i18next.t("menu.scan.metaDescription"),
      },
      { property: "og:title", content: i18next.t("menu.scan.metaOgTitle") },
      { property: "og:description", content: i18next.t("menu.scan.metaOgDescription") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MenuScanPage,
});

type Page = { file: File; preview: string };

/** A page that could not be read, kept so only those pages are retried. */
type FailedPage = { pageNumber: number; path: string; error: string };

/** A single page is never allowed to hold a whole list hostage. */
const PAGE_TIMEOUT_MS = 90_000;
/** A long list is allowed to take minutes, but not forever. */
const SCAN_BUDGET_MS = 600_000;
/** Above this, the wait is long enough that the user is warned first. */
const LONG_SCAN_PAGES = 4;

function MenuScanPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const readPage = useServerFn(readMenuPage);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  // Resolved once: re-reading the session after the long read can stall on the
  // auth refresh lock, which is what used to freeze the save step.
  const uidRef = useRef<string | null>(null);

  // Read from the photo's GPS in the background: never asked for, never blocking.
  const placeRef = useRef<{ city: string | null; country: string | null }>({
    city: null,
    country: null,
  });
  const [pages, setPages] = useState<Page[]>([]);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [warned, setWarned] = useState(false);
  const [scanId, setScanId] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [failedPages, setFailedPages] = useState<FailedPage[]>([]);
  const [pagesRead, setPagesRead] = useState<{ read: number; total: number } | null>(null);

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

  /**
   * Upload, create the scan row, then read one page at a time and save that
   * page's wines immediately. Giving up half way through, or a page that will
   * not read, never costs the pages already read.
   */
  async function onRead() {
    if (!pages.length || reading) return;
    if (pages.length > LONG_SCAN_PAGES && !warned) {
      setWarned(true);
      return;
    }
    const mark = createStageTimer("menu-scan");
    setReading(true);
    setFailure(null);
    setFailedPages([]);
    setPagesRead(null);
    try {
      const { data: userRes } = await withTimeout(
        supabase.auth.getUser(),
        20_000,
        t("menu.scan.errors.confirmSignIn"),
      );
      const uid = userRes.user!.id;
      uidRef.current = uid;
      mark("user resolved");

      const paths: string[] = [];
      for (const [i, p] of pages.entries()) {
        setProgress(t("menu.scan.progress.uploading", { current: i + 1, total: pages.length }));
        const compressed = await compressImage(p.file);
        const path = `${uid}/${crypto.randomUUID()}.jpg`;
        const up = await supabase.storage
          .from("wine-photos")
          .upload(path, compressed, { contentType: "image/jpeg" });
        if (up.error) throw up.error;
        paths.push(path);
      }
      mark("uploads complete", { pages: paths.length });

      // The scan row exists before the first page is read, so every page can be
      // stored the moment it comes back.
      setProgress(t("menu.scan.progress.preparing"));
      const { scan } = await withTimeout(
        saveMenuScan({
          userId: uid,
          photoPath: paths[0] ?? null,
          restaurantName: null,
          raw: { pages: [] } as unknown,
          items: [],
          currency: null,
          city: placeRef.current.city,
          country: placeRef.current.country,
          onStage: mark,
        }),
        20_000,
        t("menu.scan.errors.couldNotStart"),
      );
      setScanId(scan.id);

      await readPages(
        scan.id,
        paths.map((path, i) => ({ pageNumber: i + 1, path })),
        paths.length,
        0,
        mark,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : t("menu.scan.errors.couldNotReadList");
      setFailure(message);
      toast.error(message);
      setReading(false);
      setProgress(null);
    }
  }

  /**
   * Read the given pages one at a time, saving each page's wines as it lands.
   * Used both for the first run and for retrying only the pages that failed.
   */
  async function readPages(
    id: string,
    queue: Array<{ pageNumber: number; path: string }>,
    total: number,
    alreadyStored: number,
    mark: (stage: string, extra?: Record<string, unknown>) => void,
  ) {
    setReading(true);
    const deadline = Date.now() + SCAN_BUDGET_MS;
    const raws: JsonValue[] = [];
    const failures: FailedPage[] = [];
    const skippedCategories = new Set<string>();
    let stored = alreadyStored;
    let readOk = 0;
    let restaurant: string | null = null;
    let currency: string | null = null;
    let skippedCount = 0;
    let salvagedPages = 0;

    for (const page of queue) {
      if (Date.now() > deadline) {
        failures.push({
          ...page,
          error: t("menu.scan.errors.pageTimeout", { number: page.pageNumber }),
        });
        continue;
      }
      setProgress(t("menu.scan.progress.reading", { current: page.pageNumber, total }));
      const res = await readMenuPageSafe(page.pageNumber, page.path);
      if (!res.ok) {
        failures.push({ ...page, error: res.error });
        continue;
      }
      readOk++;
      raws.push(res.raw);
      if (res.salvaged) salvagedPages++;
      skippedCount += res.skipped_count;
      for (const c of res.skipped_categories) skippedCategories.add(c);
      restaurant ??= res.restaurant_name;
      currency ??= res.currency;

      // Saved page by page: this is the whole point of the loop.
      try {
        setProgress(t("menu.scan.progress.savingPage", { current: page.pageNumber, total }));
        stored += await appendMenuItems({
          scanId: id,
          items: res.items,
          currency,
          positionOffset: stored,
        });
        setSavedCount(stored);
        mark("page saved", { page: page.pageNumber, stored });
      } catch (err) {
        failures.push({
          ...page,
          error: err instanceof Error ? err.message : t("menu.scan.errors.couldNotSaveList"),
        });
      }
    }

    // Context is bookkeeping: it must never stop the user reaching the results.
    void updateMenuScanContext(id, {
      restaurant_name: restaurant?.trim() || undefined,
      currency: currency ?? undefined,
      raw_response: { pages: raws },
      skipped_count: skippedCount,
      skipped_categories: [...skippedCategories],
    }).catch(() => {});

    if (salvagedPages > 0) toast.warning(t("menu.scan.toasts.salvagedPage", { count: stored }));

    setFailedPages(failures);
    setPagesRead({ read: readOk, total });
    setReading(false);
    setProgress(null);

    if (!stored && failures.length) {
      setFailure(failures[0]!.error);
      return;
    }
    if (!failures.length) goToResults(id, mark);
  }

  /** Re-read only the pages that failed, into the same scan. */
  async function retryFailedPages() {
    if (!scanId || !failedPages.length) return;
    const mark = createStageTimer("menu-scan-retry");
    const queue = failedPages;
    setFailure(null);
    await readPages(scanId, queue, pages.length || queue.length, savedCount, mark);
  }

  /**
   * The protected-route gate re-checks the session before the results screen
   * renders. If that check stalls the router never moves, so a hard navigation
   * takes over rather than leaving the user watching a spinner.
   */
  function goToResults(id: string, mark: (stage: string) => void) {
    const path = `/menu/${id}`;
    // Cleared unconditionally: a spinner left true would cover whatever renders next.
    setReading(false);
    setProgress(null);
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
        PAGE_TIMEOUT_MS,
        t("menu.scan.errors.pageTimeout", { number: pageNumber }),
      );
    } catch (e) {
      return {
        ok: false as const,
        error:
          e instanceof Error && /abort|timeout|network|fetch/i.test(e.message)
            ? t("menu.scan.errors.pageTimeout", { number: pageNumber })
            : e instanceof Error
              ? t("menu.scan.errors.pageError", { number: pageNumber, message: e.message })
              : t("menu.scan.errors.pageUnreadable", { number: pageNumber }),
        raw: null as JsonValue,
      };
    }
  }

  const busy = reading;

  return (
    <div className="px-5 pt-6 pb-8">
      <div className="flex items-center justify-between mb-5">
        <Link to="/diary" className="flex items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft size={16} /> {t("nav.diary")}
        </Link>
        <Link to="/menus" className="flex items-center gap-1 text-sm text-muted-foreground">
          <History size={15} /> {t("menu.scan.pastScans")}
        </Link>
      </div>

      <header className="mb-6">
        <h1 className="text-3xl font-serif text-primary">{t("menu.scan.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("menu.scan.subtitle")}</p>
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
                alt={t("menu.scan.pageAlt", { number: i + 1 })}
                className="h-full w-full object-cover"
              />
              {!busy && (
                <button
                  type="button"
                  onClick={() => setPages((ps) => ps.filter((_, k) => k !== i))}
                  aria-label={t("menu.scan.removePage", { number: i + 1 })}
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
          <Camera size={16} /> {t("menu.scan.takePhoto")}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => galleryRef.current?.click()}>
          <Images size={16} /> {t("menu.scan.choosePhotos")}
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

      {/* Long lists take minutes; the user is told before, not during. */}
      {warned && !busy && pages.length > LONG_SCAN_PAGES && !pagesRead && (
        <div className="mt-6 rounded-2xl border border-border bg-parchment/60 p-4">
          <p className="text-sm text-foreground">
            {t("menu.scan.longScanWarning", { count: pages.length })}
          </p>
          <p className="text-xs text-muted-foreground mt-1">{t("menu.scan.longScanHint")}</p>
        </div>
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
            onClick={() => (failedPages.length ? void retryFailedPages() : void onRead())}
          >
            <RotateCcw size={14} /> {t("common.retry")}
          </Button>
        </div>
      )}

      {/* Some pages read, some did not: keep what we have, retry only the rest. */}
      {!busy && pagesRead && failedPages.length > 0 && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-4 shadow-notebook">
          <p className="text-sm text-foreground">
            {t("menu.scan.partial.summary", { read: pagesRead.read, total: pagesRead.total })}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {t("menu.scan.partial.hint", { count: failedPages.length })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void retryFailedPages()}>
              <RotateCcw size={14} /> {t("menu.scan.partial.retryFailed", { count: failedPages.length })}
            </Button>
            {scanId && savedCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => goToResults(scanId, createStageTimer("menu-scan"))}
              >
                {t("menu.scan.partial.seeWhatWasRead", { count: savedCount })}
              </Button>
            )}
          </div>
        </div>
      )}

      <Button className="w-full mt-6" disabled={!pages.length || busy} onClick={onRead}>
        {reading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            {progress ?? t("menu.scan.progress.readingList")}
          </>
        ) : (
          <>
            <ScrollText size={16} />{" "}
            {warned && pages.length > LONG_SCAN_PAGES && !pagesRead
              ? t("menu.scan.startAnyway", { count: pages.length })
              : pages.length > 1
                ? t("menu.scan.readListPages", { count: pages.length })
                : t("menu.scan.readList")}
          </>
        )}
      </Button>

      {reading && pages.length > 1 && (
        <p className="text-xs text-muted-foreground mt-3 text-center">
          {t("menu.scan.keepOpen")}
        </p>
      )}

      <p className="text-xs text-muted-foreground mt-3 text-center">{t("menu.scan.footnote")}</p>
    </div>
  );
}
