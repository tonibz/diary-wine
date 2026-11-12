import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { loadOpenCv, scoreLabelBlobs, type LabelSimilarity } from "@/lib/label-similarity";
import { useAsyncData } from "@/lib/use-async-data";
import { toError } from "@/lib/to-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const TITLE = "Modelo de similitud (modo sombra)";
export const Route = createFileRoute("/_authenticated/dev/similitud")({
  head: () => ({ meta: [
    { title: `${TITLE} | Wine Diary` },
    { name: "description", content: TITLE },
    { property: "og:title", content: `${TITLE} | Wine Diary` },
    { property: "og:description", content: TITLE },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: SimilarityPage,
});

async function readDecisions(): Promise<Tables<"match_decisions">[]> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!auth.user) throw new Error("No autorizado");
  const rows: Tables<"match_decisions">[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("match_decisions").select("*")
      .eq("user_id", auth.user.id).not("sim_model_prob", "is", null)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + 999).abortSignal(AbortSignal.timeout(15_000));
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
const number = (n: number | null | undefined, digits = 3) => n == null ? "" : n.toLocaleString("es-ES", { maximumFractionDigits: digits });
function SimilarityPage() {
  const { data: rows, error: readError } = useAsyncData("/dev/similitud", readDecisions);
  const [files, setFiles] = useState<(File | null)[]>([null, null]);
  const [names, setNames] = useState(["", ""]);
  const [producers, setProducers] = useState(["", ""]);
  const [busy, setBusy] = useState(false);
  const [loadingCv, setLoadingCv] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LabelSimilarity | null>(null);
  const judged = (rows ?? []).filter((r) => r.visual_same_wine != null);
  const agree = judged.filter((r) => r.sim_model_prob != null && (r.sim_model_prob >= 0.5) === r.visual_same_wine).length;

  async function compare() {
    const [a, b] = files;
    if (!a || !b || busy) return;
    setBusy(true); setLoadingCv(true); setError(null); setResult(null);
    try {
      // scoreLabelBlobs owns the single 30-second deadline, including loading.
      void loadOpenCv().then(() => setLoadingCv(false), () => setLoadingCv(false));
      const value = await scoreLabelBlobs({ newBlob: a, candidateBlob: b,
        newName: names[0], newProducer: producers[0], candName: names[1], candProducer: producers[1] });
      if (!value) throw new Error("OpenCV / ORB");
      setResult(value);
    } catch (e) { setError(toError(e).message); }
    finally { setBusy(false); setLoadingCv(false); }
  }

  return <main className="px-4 py-8 space-y-8">
    <h1 className="font-serif text-2xl text-primary">{TITLE}</h1>
    <section className="space-y-4">
      <h2 className="font-serif text-xl">Decisiones registradas</h2>
      <p>Comparaciones: {judged.length}. Coinciden modelo (≥ 0,5) y Claude: {agree}.</p>
      {readError && <p role="alert" className="text-destructive break-words">{readError.message}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead><tr>{["Fecha", "Vino nuevo", "Similitud texto", "Claude: mismo vino", "Confianza Claude", "Modelo: probabilidad", "Inliers ORB", "Decisión final"].map((title) => <th key={title} className="border-b border-border p-2 whitespace-nowrap">{title}</th>)}</tr></thead>
          <tbody>{(rows ?? []).map((row) => <tr key={row.id}>
            <td className="border-b border-border p-2 whitespace-nowrap">{new Date(row.created_at).toLocaleString("es-ES")}</td>
            <td className="border-b border-border p-2">{row.new_name}</td>
            <td className="border-b border-border p-2">{number(row.similarity_score)}</td>
            <td className="border-b border-border p-2">{row.visual_same_wine == null ? "" : String(row.visual_same_wine)}</td>
            <td className="border-b border-border p-2">{number(row.visual_confidence)}</td>
            <td className="border-b border-border p-2">{number(row.sim_model_prob)}</td>
            <td className="border-b border-border p-2">{row.sim_orb_inliers}</td>
            <td className="border-b border-border p-2">{row.decision}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <section className="space-y-4">
      <h2 className="font-serif text-xl">Probar dos etiquetas</h2>
      <div className="grid gap-5 sm:grid-cols-2">
        {[0, 1].map((i) => <div key={i} className="space-y-3">
          <Label htmlFor={`photo-${i}`}>Etiqueta {i === 0 ? "A" : "B"}</Label>
          <Input id={`photo-${i}`} type="file" accept="image/*" disabled={busy} onChange={(e) => setFiles((prev) => prev.map((f, k) => k === i ? e.target.files?.[0] ?? null : f))} />
          <Label htmlFor={`name-${i}`}>Nombre</Label>
          <Input id={`name-${i}`} value={names[i]} onChange={(e) => setNames((prev) => prev.map((n, k) => k === i ? e.target.value : n))} />
          <Label htmlFor={`producer-${i}`}>Bodega</Label>
          <Input id={`producer-${i}`} value={producers[i]} onChange={(e) => setProducers((prev) => prev.map((n, k) => k === i ? e.target.value : n))} />
        </div>)}
      </div>
      <Button onClick={compare} disabled={busy || !files[0] || !files[1]}>Comparar</Button>
      {loadingCv && <p role="status">Cargando OpenCV…</p>}
      {error && <p role="alert" className="text-destructive break-words">{error}</p>}
      {result && <div role="status" className="space-y-1">
        <p>Probabilidad de que sean el mismo vino: {number(result.prob * 100, 1)} %</p>
        <p>Inliers ORB: {result.inliers}</p>
        <p>Similitud nombre: {number(result.textName)}</p>
        <p>Similitud bodega: {number(result.textProducer)}</p>
        <p>Tiempo: {result.ms} ms</p>
      </div>}
    </section>
  </main>;
}