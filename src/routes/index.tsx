import { createFileRoute, redirect } from "@tanstack/react-router";

// Landing simply forwards into the diary; the _authenticated layout handles
// redirect to /auth when there's no session.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/diary" });
  },
  component: () => null,
});
