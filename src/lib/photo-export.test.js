import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { storagePhotoPath } from "./eval-utils";

const source = readFileSync(new URL("./photo-export.functions.ts", import.meta.url), "utf8");
const body = source.slice(source.indexOf("if (context.userId"), source.lastIndexOf("  });"))
  .replace('await import("@/integrations/supabase/client.server")', "await loadAdmin()")
  .replace(/    type Photo = \{[\s\S]*?    \};\n/, "")
  .replace("const photos: Photo[]", "const photos")
  .replaceAll(" as const", "")
  .replace("const items: (Photo & { url: string })[]", "const items");
const run = new (Object.getPrototypeOf(async function () {}).constructor)("context", "loadAdmin", "storagePhotoPath", body);

test("only the specified authenticated owner can load the privileged client", async () => {
  let loaded = false;
  await expect(run({ userId: "another-user" }, async () => { loaded = true; }, storagePhotoPath)).rejects.toThrow("No autorizado");
  expect(loaded).toBe(false);
});

test("all entry pages export both sides with 7200-second URLs in batches of 100", async () => {
  const ranges = [];
  const batches = [];
  const entry = {
    id: "entry", user_id: "12345678-rest", created_at: "2026-11-11",
    photo_url: "owner/front.jpg", back_photo_url: "owner/back.jpg",
    wine_vintage_id: "vintage", wine_vintages: { vintage: 2022, wine_id: "wine", wines: { name: "Wine", producer: "Producer" } },
  };
  const supabaseAdmin = {
    from: () => ({ select: () => ({ order: () => ({ range: async (start, end) => {
      ranges.push([start, end]);
      return { data: start === 0 ? Array.from({ length: 1000 }, () => entry) : [entry], error: null };
    } }) }) }),
    storage: { from: () => ({ createSignedUrls: async (paths, seconds) => {
      batches.push({ count: paths.length, seconds });
      return { data: paths.map((path) => path.endsWith("back.jpg") ? { error: "missing" } : { signedUrl: "https://example.test/photo" }), error: null };
    } }) },
  };
  const result = await run({ userId: "776825b4-a6aa-4280-bcc4-09ee5cc82d79" }, async () => ({ supabaseAdmin }), storagePhotoPath);
  expect(ranges).toEqual([[0, 999], [1000, 1999]]);
  expect(batches.every((batch) => batch.count <= 100 && batch.seconds === 7200)).toBe(true);
  expect(result.expires_in_seconds).toBe(7200);
  expect(result.items.length).toBe(1001);
  expect(result.failed).toBe(1001);
  expect(result.items[0]).toMatchObject({ user: "12345678", side: "frontal", vintage: 2022, wine_id: "wine" });
});