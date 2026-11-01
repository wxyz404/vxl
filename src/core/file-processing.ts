/** Effort is bounded work, not a quality score. Live capture never uses this policy. */
export function processingPolicy(effort: number) {
  const passes = Math.max(0, Math.min(4, Math.round(Number.isFinite(effort) ? effort : 0)));
  return { passes, waitMs: [0, 250, 750, 1500, 3000][passes] };
}

/** Poll enabled workers for the held frame; never queue another input while waiting. */
export async function settleFrame(step: () => boolean, budgetMs: number, signal: AbortSignal) {
  const start = performance.now();
  while (!signal.aborted) {
    if (step()) return { cancelled: false, expired: false };
    if (performance.now() - start >= budgetMs) return { cancelled: false, expired: true };
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, Math.min(16, Math.max(1, budgetMs - (performance.now() - start))));
      signal.addEventListener('abort', done, { once: true });
    });
  }
  return { cancelled: true, expired: false };
}
