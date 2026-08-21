import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Wine } from "lucide-react";

export const Route = createFileRoute("/auth")({
  // Preserve where the user was heading (e.g. an OAuth consent screen) so they
  // land back there after signing in.
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" && s.next.startsWith("/") && !s.next.startsWith("//")
      ? s.next
      : undefined,
  }),
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

function humanizeAuthError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("email not confirmed")) {
    return "Please confirm your email first — check your inbox for the link we sent you.";
  }
  if (lower.includes("invalid login credentials")) {
    return "That email and password don't match. Try again, or create an account.";
  }
  if (lower.includes("user already registered")) {
    return "An account with this email already exists. Try signing in instead.";
  }
  return raw;
}

function AuthPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState<null | "google" | "apple" | "password" | "magic">(null);
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  // Computed lazily: this route is server-rendered, so `window` is absent at render.
  const returnTo = () => (next ? `${window.location.origin}${next}` : window.location.origin);

  function goAfterAuth() {
    if (next) {
      window.location.href = returnTo();
      return;
    }
    navigate({ to: "/diary" });
  }

  async function withProvider(provider: "google" | "apple") {
    setBusy(provider);
    try {
      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: returnTo(),
      });
      if (result.error) throw result.error instanceof Error ? result.error : new Error(String(result.error));
      if (result.redirected) return;
      goAfterAuth();
    } catch (err) {
      toast.error(humanizeAuthError(err instanceof Error ? err.message : "Sign-in failed"));
    } finally {
      setBusy(null);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy("password");
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: returnTo(),
            data: { display_name: displayName || email.split("@")[0] },
          },
        });
        if (error) throw error;
        toast.success("Welcome! You're signed in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      goAfterAuth();
    } catch (err) {
      toast.error(humanizeAuthError(err instanceof Error ? err.message : "Something went wrong"));
    } finally {
      setBusy(null);
    }
  }

  async function sendMagicLink() {
    if (!email) {
      toast.error("Enter your email first.");
      return;
    }
    setBusy("magic");
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: returnTo() },
      });
      if (error) throw error;
      toast.success("Check your inbox for a sign-in link.");
    } catch (err) {
      toast.error(humanizeAuthError(err instanceof Error ? err.message : "Could not send link"));
    } finally {
      setBusy(null);
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

        <div className="rounded-2xl bg-card p-6 shadow-notebook border border-border space-y-3">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={busy !== null}
            onClick={() => withProvider("google")}
          >
            {busy === "google" ? "…" : "Continue with Google"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={busy !== null}
            onClick={() => withProvider("apple")}
          >
            {busy === "apple" ? "…" : "Continue with Apple"}
          </Button>

          <div className="flex items-center gap-3 py-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground font-serif">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
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
            <Button type="submit" disabled={busy !== null} className="w-full">
              {busy === "password" ? "…" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
            <button
              type="button"
              onClick={sendMagicLink}
              disabled={busy !== null}
              className="w-full text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
            >
              {busy === "magic" ? "Sending link…" : "Email me a magic link instead"}
            </button>
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
    </div>
  );
}
