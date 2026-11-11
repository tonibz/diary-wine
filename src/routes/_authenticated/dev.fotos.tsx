import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportPhotoManifest } from "@/lib/photo-export.functions";
import { toError } from "@/lib/to-error";

export const Route = createFileRoute("/_authenticated/dev/fotos")({
  head: () => ({ meta: [
    { title: "Exportar fotos | Wine Diary" },
    { name: "description", content: "Exportar fotos" },
    { property: "og:title", content: "Exportar fotos | Wine Diary" },
    { property: "og:description", content: "Exportar fotos" },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: PhotoExportPage,
});

function PhotoExportPage() {
  const exportManifest = useServerFn(exportPhotoManifest);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ photos: number; failed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const manifest = await exportManifest();
      const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "manifiesto_fotos.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setResult({ photos: manifest.items.length, failed: manifest.failed });
    } catch (thrown) {
      setError(toError(thrown).message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="px-4 py-8 space-y-6">
    <h1 className="font-serif text-2xl">Exportar fotos</h1>
    <Button disabled={busy || error === "No autorizado"} onClick={generate}>
      {busy ? <Loader2 className="animate-spin" /> : <Download />}
      Generar manifiesto
    </Button>
    {result && <p role="status">Fotos: {result.photos}. Fallos: {result.failed}. Los enlaces caducan en 2 horas.</p>}
    {error && <p role="alert" className="text-destructive break-words">{error}</p>}
  </main>;
}