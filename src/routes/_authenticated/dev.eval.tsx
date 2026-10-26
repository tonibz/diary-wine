import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, Square, RefreshCw } from "lucide-react";
import { getEvalOverview, runEvalJudgement, runEvalRecognition } from "@/lib/eval.functions";
import { ANNOTATED_PREFIXES, EVAL_CONDITIONS, type EvalCondition } from "@/lib/eval-utils";
import { toError } from "@/lib/to-error";

export const Route = createFileRoute("/_authenticated/dev/eval")({
  head: () => ({ meta: [
    { title: "Recognition evaluation | Wine Diary" },
    { name: "description", content: "Private developer recognition evaluation workspace." },
    { property: "og:title", content: "Recognition evaluation | Wine Diary" },
    { property: "og:description", content: "Private developer recognition evaluation workspace." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: EvalPage,
});

type Column = EvalCondition | "Judge";
const labels: Record<Column, string> = { A_current_front_back: "A · Current front + back", B_current_front: "B · Current front", C_strict_front: "C · Strict front", Judge: "Judge · Blind label audit" };

function EvalPage() {
  const overview = useServerFn(getEvalOverview);
  const recognise = useServerFn(runEvalRecognition);
  const judge = useServerFn(runEvalJudgement);
  const query = useQuery({ queryKey: ["dev-eval"], queryFn: () => overview(), retry: false });
  const [running, setRunning] = useState<Column | null>(null);
  const stop = useRef(false);
  const busy = useRef(false);
  const [stopping, setStopping] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, input: 0, output: 0 });
  const [errors, setErrors] = useState<string[]>([]);
  const data = query.data;
  const columns: Column[] = [...EVAL_CONDITIONS, "Judge"];
  const eligible = (column: Column) => (data?.recognitions ?? []).filter((r) => column !== "A_current_front_back" || r.hasBack);
  const completed = (column: Column) => new Set(column === "Judge" ? data?.judgements.map((j) => j.recognition_id) : data?.runs.filter((r) => r.condition === column).map((r) => r.recognition_id));

  async function run(column: Column, annotatedOnly = false) {
    if (busy.current || !data) return;
    busy.current = true;
    stop.current = false;
    setStopping(false);
    setRunning(column);
    setErrors([]);
    const done = completed(column);
    const remaining = eligible(column).filter((r) => !done.has(r.id) && (!annotatedOnly || ANNOTATED_PREFIXES.has(r.id.slice(0, 8))));
    setProgress({ done: 0, total: remaining.length, input: 0, output: 0 });
    try {
      for (const item of remaining) {
        if (stop.current) break;
        try {
          const result = column === "Judge" ? await judge({ data: { recognitionId: item.id } }) : await recognise({ data: { recognitionId: item.id, condition: column } });
          setProgress((p) => ({ ...p, done: p.done + 1, input: p.input + (result.input_tokens ?? 0), output: p.output + (result.output_tokens ?? 0) }));
          if (result.error) setErrors((e) => [...e, `${item.id.slice(0, 8)}: ${result.error}`]);
          if (result.halt) break;
        } catch (error) {
          setErrors((e) => [...e, `${item.id.slice(0, 8)}: ${toError(error).message}`]);
          // Never replay an ambiguous failed RPC: it may already have incurred a model charge.
          break;
        }
      }
    } finally {
      await query.refetch();
      setRunning(null);
      setStopping(false);
      busy.current = false;
    }
  }

  return <main className="px-4 py-8 space-y-6">
    <header className="space-y-2">
      <h1 className="font-serif text-2xl">Recognition evaluation</h1>
      {data && <p className="text-sm text-muted-foreground">{data.recognitions.length} eligible recognitions · {data.recognitions.filter((r) => r.hasBack).length} with back photos</p>}
    </header>
    {query.isPending && <p role="status">Loading evaluation records…</p>}
    {query.isError && <div role="alert" className="text-destructive space-y-2"><p>{toError(query.error).message}</p><Button variant="outline" onClick={() => query.refetch()}><RefreshCw />Retry</Button></div>}
    {data && <>
      <Button variant="outline" disabled={running !== null || eligible("Judge").filter((r) => ANNOTATED_PREFIXES.has(r.id.slice(0, 8)) && !completed("Judge").has(r.id)).length === 0} onClick={() => run("Judge", true)}><Play />Judge annotated only</Button>
      <div className="divide-y divide-border">
        {columns.map((column) => {
          const items = eligible(column);
          const done = items.filter((r) => completed(column).has(r.id)).length;
          const records = column === "Judge" ? data.judgements : data.runs.filter((r) => r.condition === column);
          return <section key={column} className="py-4 space-y-3">
            <div className="flex items-center justify-between gap-3"><div><h2 className="font-medium text-sm">{labels[column]}</h2><p className="text-sm text-muted-foreground">{done} / {items.length} done</p></div><Button size="sm" disabled={running !== null || done === items.length} onClick={() => run(column)}><Play />Run</Button></div>
            <p className="text-xs text-muted-foreground">Saved tokens: {records.reduce((n, r) => n + (r.input_tokens ?? 0), 0).toLocaleString()} input · {records.reduce((n, r) => n + (r.output_tokens ?? 0), 0).toLocaleString()} output</p>
            {records.filter((r) => r.error).map((r) => <p key={r.recognition_id} className="text-xs text-destructive break-words">{r.recognition_id.slice(0, 8)}: {r.error}</p>)}
          </section>;
        })}
      </div>
      <details className="border-t border-border pt-4">
        <summary className="cursor-pointer text-sm font-medium">Eligible recognitions ({data.recognitions.length})</summary>
        <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
          {data.recognitions.map((r) => <li key={r.id} className="break-all font-mono">{r.id} · {r.hasBack ? "front + back" : "front only"}</li>)}
        </ul>
      </details>
    </>}
    {(running || progress.total > 0) && <section className="space-y-3 border-t border-border pt-4" aria-live="polite">
      <h2 className="font-medium">{running ? labels[running] : "Run finished"}</h2>
      <p className="text-sm">{progress.done} / {progress.total} processed</p>
      <progress className="w-full" value={progress.done} max={progress.total || 1} />
      <p className="text-sm">{progress.input.toLocaleString()} input tokens · {progress.output.toLocaleString()} output tokens</p>
      {running && <Button variant="outline" disabled={stopping} onClick={() => { stop.current = true; setStopping(true); }}><Square />{stopping ? "Stopping after current item…" : "Stop"}</Button>}
    </section>}
    {errors.length > 0 && <div role="alert" className="text-sm text-destructive space-y-2">{errors.map((error, i) => <p className="break-words" key={i}>{error}</p>)}</div>}
  </main>;
}