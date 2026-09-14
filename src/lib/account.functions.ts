import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DeleteAccountResult = { ok: true } | { ok: false; error: string };

/**
 * Irreversible account deletion (Apple App Store rule 5.1.1(v) and GDPR art. 17).
 *
 * Removed: the member's entries, menu scans and their items, recognitions and
 * reference checks, taste profile, match decisions, recommendations, profile row
 * and login. Kept: wines they contributed to the shared catalogue — other people
 * have tastings linked to them — but detached (created_by set to null).
 *
 * Photos: every file of theirs goes, including files serving as a catalogue label
 * photo. Those wines lose the photo (label_image_url set to null); erasure wins
 * over catalogue completeness, and the photo may show their home or friends.
 */
export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DeleteAccountResult> => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    try {
      // ---- 1. Collect every storage object belonging to this user ----
      const paths = new Set<string>();
      const folders = [userId];
      while (folders.length) {
        const prefix = folders.pop()!;
        const { data: listed, error } = await supabaseAdmin.storage
          .from("wine-photos")
          .list(prefix, { limit: 1000 });
        if (error) throw error;
        for (const item of listed ?? []) {
          const full = `${prefix}/${item.name}`;
          if (item.id === null) folders.push(full);
          else paths.add(full);
        }
      }

      // Anything referenced by their rows, in case it lives outside their folder.
      const { data: entryRows } = await supabaseAdmin
        .from("entries")
        .select("photo_url, back_photo_url")
        .eq("user_id", userId);
      for (const r of entryRows ?? []) {
        for (const p of [r.photo_url, r.back_photo_url]) {
          if (p && !/^https?:\/\//i.test(p)) paths.add(p);
        }
      }
      const { data: recRows } = await supabaseAdmin
        .from("recognitions")
        .select("id, photo_path")
        .eq("user_id", userId);
      for (const r of recRows ?? []) {
        if (r.photo_path && !/^https?:\/\//i.test(r.photo_path)) paths.add(r.photo_path);
      }
      const { data: scanRows } = await supabaseAdmin
        .from("menu_scans")
        .select("id, photo_path")
        .eq("user_id", userId);
      for (const r of scanRows ?? []) {
        if (r.photo_path && !/^https?:\/\//i.test(r.photo_path)) paths.add(r.photo_path);
      }

      const allPaths = Array.from(paths);

      // ---- 2. Catalogue wines lose any label photo that is one of these files ----
      if (allPaths.length) {
        const { error } = await supabaseAdmin
          .from("wines")
          .update({ label_image_url: null })
          .in("label_image_url", allPaths);
        if (error) throw error;
      }

      // ---- 3. Detach contributions instead of deleting them ----
      const detachWines = await supabaseAdmin
        .from("wines")
        .update({ created_by: null })
        .eq("created_by", userId);
      if (detachWines.error) throw detachWines.error;
      const detachAliases = await supabaseAdmin
        .from("wine_aliases")
        .update({ created_by: null })
        .eq("created_by", userId);
      if (detachAliases.error) throw detachAliases.error;

      // ---- 4. Delete their own rows, children first ----
      const recIds = (recRows ?? []).map((r) => r.id);
      if (recIds.length) {
        const del = await supabaseAdmin.from("inference_checks").delete().in("recognition_id", recIds);
        if (del.error) throw del.error;
      }
      const scanIds = (scanRows ?? []).map((r) => r.id);

      const steps: Array<{ table: string; run: () => Promise<{ error: unknown }> }> = [
        { table: "recommendations", run: async () => supabaseAdmin.from("recommendations").delete().eq("user_id", userId) },
        { table: "recognitions", run: async () => supabaseAdmin.from("recognitions").delete().eq("user_id", userId) },
        { table: "entries", run: async () => supabaseAdmin.from("entries").delete().eq("user_id", userId) },
        { table: "match_decisions", run: async () => supabaseAdmin.from("match_decisions").delete().eq("user_id", userId) },
        { table: "taste_profiles", run: async () => supabaseAdmin.from("taste_profiles").delete().eq("user_id", userId) },
      ];
      if (scanIds.length) {
        steps.unshift({
          table: "menu_items",
          run: async () => supabaseAdmin.from("menu_items").delete().in("menu_scan_id", scanIds),
        });
      }
      steps.push({
        table: "menu_scans",
        run: async () => supabaseAdmin.from("menu_scans").delete().eq("user_id", userId),
      });
      steps.push({
        table: "profiles",
        run: async () => supabaseAdmin.from("profiles").delete().eq("id", userId),
      });

      for (const step of steps) {
        const { error } = await step.run();
        if (error) throw error;
      }

      // ---- 5. Remove the files ----
      for (let i = 0; i < allPaths.length; i += 100) {
        const { error } = await supabaseAdmin.storage
          .from("wine-photos")
          .remove(allPaths.slice(i, i + 100));
        if (error) throw error;
      }

      // ---- 6. Finally the login itself ----
      const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (authErr) throw authErr;

      return { ok: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Account deletion failed";
      console.error("[deleteAccount]", message);
      return { ok: false, error: message };
    }
  });
