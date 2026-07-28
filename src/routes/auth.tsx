import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Wine } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Wine Diary" },
      { name: "description", content: "Sign in or create your Wine Diary account." },
      { property: "og:title", content: "Sign in — Wine Diary" },
      { property: "og:description", content: "Your personal wine log." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: displayName || email.split("@")[0] },
          },
        });
        if (error) throw error;
        toast.success("Welcome! You're signed in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/diary" });
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Something went wrong";
      const lower = raw.toLowerCase();
      let msg = raw;
      if (lower.includes("email not confirmed")) {
        msg = "Please confirm your email first — check your inbox for the link we sent you.";
      } else if (lower.includes("invalid login credentials")) {
        msg = "That email and password don't match. Try again, or create an account.";
      } else if (lower.includes("user already registered")) {
        msg = "An account with this email already exists. Try signing in instead.";
      }
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-10 bg-background">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            <Wine size={28} />
          </div>
          <h1 className="text-4xl font-serif text-primary">Wine Diary</h1>
          <p className="text-sm text-muted-foreground text-center">
            Keep a personal log of the wines you try.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-2xl bg-card p-6 shadow-notebook border border-border space-y-4"
        >
          {mode === "signup" && (
            <div className="space-y-1.5">
              <Label htmlFor="dn">Your name</Label>
              <Input
                id="dn"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How should we call you?"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw">Password</Label>
            <Input
              id="pw"
              type="password"
              required
              minLength={6}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
          </Button>
          <button
            type="button"
            className="w-full text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "New here? Create an account" : "Already have one? Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
