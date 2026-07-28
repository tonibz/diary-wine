import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { LogOut } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — Wine Diary" }, { name: "description", content: "Your account and preferences." }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setEmail(data.user.email ?? "");
      const { data: p } = await supabase.from("profiles").select("display_name").eq("id", data.user.id).maybeSingle();
      setDisplayName(p?.display_name ?? "");
    });
  }, []);

  async function save() {
    setSaving(true);
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    const { error } = await supabase.from("profiles").upsert({ id: data.user.id, display_name: displayName || null });
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Saved");
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  return (
    <div className="px-5 pt-8 pb-8">
      <h1 className="text-4xl font-serif text-primary mb-6">Settings</h1>

      <section className="rounded-2xl bg-card p-5 border border-border shadow-notebook space-y-4">
        <div className="space-y-1.5">
          <Label>Display name</Label>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input value={email} disabled />
        </div>
        <Button onClick={save} disabled={saving}>{saving ? "…" : "Save"}</Button>
      </section>

      <button
        onClick={signOut}
        className="mt-6 w-full flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3 text-muted-foreground hover:text-destructive"
      >
        <LogOut size={18} /> Sign out
      </button>

      <p className="text-center text-xs text-muted-foreground mt-8 font-serif">Wine Diary — kept just for you.</p>
    </div>
  );
}
