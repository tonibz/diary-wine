import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { AuthLoading } from "@/components/AuthLoading";

/**
 * OAuth and magic links land here, so this route must never redirect before
 * the session in the URL has been read. It waits, then routes.
 */
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Wine Diary — Your personal wine log" },
      { name: "description", content: "Keep a personal log of the wines you try, learn what you like, and decide what to order next." },
      { property: "og:title", content: "Wine Diary" },
      { property: "og:description", content: "A warm, personal notebook for the wines you taste." },
    ],
  }),
  component: () => (
    <AuthProvider>
      <Landing />
    </AuthProvider>
  ),
});

function Landing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    navigate({ to: user ? "/diary" : "/auth", replace: true });
  }, [loading, user, navigate]);

  return <AuthLoading label="One moment…" />;
}
