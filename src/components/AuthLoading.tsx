import { Wine } from "lucide-react";

export function AuthLoading({ label = "Signing you in…" }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6">
      <div className="flex h-14 w-14 animate-pulse items-center justify-center rounded-full bg-primary/10 text-primary">
        <Wine size={28} />
      </div>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
