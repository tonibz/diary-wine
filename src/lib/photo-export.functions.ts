import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { storagePhotoPath } from "./eval-utils";

export const exportPhotoManifest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (context.userId !== "776825b4-a6aa-4280-bcc4-09ee5cc82d79") {
      throw new Error("No autorizado");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    type Photo = {
      entry_id: string;
      user: string;
      wine_id: string | null;
      wine_vintage_id: string | null;
      vintage: number | null;
      producer: string | null;
      name: string | null;
      side: "frontal" | "dorso";
      created_at: string;
      path: string;
    };
    const photos: Photo[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabaseAdmin.from("entries")
        .select("id, user_id, created_at, photo_url, back_photo_url, wine_vintage_id, wine_vintages(vintage, wine_id, wines(name, producer))")
        .order("id")
        .range(offset, offset + 999);
      if (error) throw new Error(error.message);
      for (const entry of data ?? []) {
        const vintage = entry.wine_vintages;
        const wine = vintage?.wines;
        const sides = [
          { side: "frontal" as const, value: entry.photo_url },
          { side: "dorso" as const, value: entry.back_photo_url },
        ];
        for (const { side, value } of sides) {
          const path = storagePhotoPath(value);
          if (!path) continue;
          photos.push({
            entry_id: entry.id,
            user: entry.user_id.slice(0, 8),
            wine_id: vintage?.wine_id ?? null,
            wine_vintage_id: entry.wine_vintage_id,
            vintage: vintage?.vintage ?? null,
            producer: wine?.producer ?? null,
            name: wine?.name ?? null,
            side,
            created_at: entry.created_at,
            path,
          });
        }
      }
      if ((data?.length ?? 0) < 1000) break;
    }
    const items: (Photo & { url: string })[] = [];
    let failed = 0;
    for (let offset = 0; offset < photos.length; offset += 100) {
      const batch = photos.slice(offset, offset + 100);
      try {
        const { data, error } = await supabaseAdmin.storage.from("wine-photos")
          .createSignedUrls(batch.map((photo) => photo.path), 7200);
        for (const [index, photo] of batch.entries()) {
          const signed = data?.[index];
          if (error || signed?.error || !signed?.signedUrl) {
            failed += 1;
            continue;
          }
          items.push({ ...photo, url: signed.signedUrl });
        }
      } catch {
        failed += batch.length;
      }
    }
    return { generated_at: new Date().toISOString(), expires_in_seconds: 7200, items, failed };
  });