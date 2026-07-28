import { supabase } from "@/integrations/supabase/client";

const cache = new Map<string, { url: string; expires: number }>();
const TTL_SECONDS = 60 * 60; // 1 hour

/**
 * A photo reference may be:
 *  - null / empty
 *  - a storage path (new format, e.g. "<uid>/<uuid>.jpg")
 *  - a full URL (legacy signed URL, still supported for old rows)
 */
export function isStoragePath(ref: string | null | undefined): ref is string {
  return !!ref && !/^https?:\/\//i.test(ref);
}

export async function getSignedPhotoUrl(ref: string | null | undefined): Promise<string | null> {
  if (!ref) return null;
  if (!isStoragePath(ref)) return ref; // legacy full URL
  const now = Date.now();
  const hit = cache.get(ref);
  if (hit && hit.expires > now + 60_000) return hit.url;
  const { data } = await supabase.storage.from("wine-photos").createSignedUrl(ref, TTL_SECONDS);
  const url = data?.signedUrl ?? null;
  if (url) cache.set(ref, { url, expires: now + TTL_SECONDS * 1000 });
  return url;
}

export async function getSignedPhotoUrls(
  refs: Array<string | null | undefined>,
): Promise<Array<string | null>> {
  const now = Date.now();
  const out: Array<string | null> = new Array(refs.length).fill(null);
  const toSign: Array<{ idx: number; path: string }> = [];

  refs.forEach((ref, i) => {
    if (!ref) return;
    if (!isStoragePath(ref)) {
      out[i] = ref;
      return;
    }
    const hit = cache.get(ref);
    if (hit && hit.expires > now + 60_000) {
      out[i] = hit.url;
    } else {
      toSign.push({ idx: i, path: ref });
    }
  });

  if (toSign.length) {
    const paths = Array.from(new Set(toSign.map((t) => t.path)));
    const { data } = await supabase.storage.from("wine-photos").createSignedUrls(paths, TTL_SECONDS);
    const byPath = new Map<string, string>();
    (data ?? []).forEach((row, k) => {
      const p = paths[k];
      if (row?.signedUrl) {
        byPath.set(p, row.signedUrl);
        cache.set(p, { url: row.signedUrl, expires: now + TTL_SECONDS * 1000 });
      }
    });
    for (const t of toSign) {
      const u = byPath.get(t.path);
      if (u) out[t.idx] = u;
    }
  }
  return out;
}
