/**
 * Stage timing for the menu scan flow. Every stage logs the milliseconds since
 * the flow started, so a stage that never completes is visible by its missing
 * line rather than by guesswork.
 */
export function createStageTimer(label: string) {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  return (stage: string, extra?: Record<string, unknown>) => {
    const elapsed = Math.round(now() - started);
    console.info(`[${label}] ${stage} +${elapsed}ms`, extra ?? "");
  };
}
