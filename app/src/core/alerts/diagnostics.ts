/** Rolling log of what the app fetched, scheduled and sent, for the Diagnostics screen. */
export type DiagSource = "app" | "widget" | "background";
export type DiagKind = "forecast" | "warnings" | "notification" | "schedule";

export interface DiagEvent {
  /** Latest occurrence, UTC seconds. */
  date: number;
  firstDate: number;
  count: number;
  source: DiagSource;
  kind: DiagKind;
  ok: boolean;
  detail: string;
}

export const DIAGNOSTICS_KEY = "weatherTempo.diagnostics";
export const DIAGNOSTICS_CAPACITY = 80;

/** Newest first. An identical repeat of the newest same-source/kind event bumps it instead of adding a row. */
export function record(
  log: DiagEvent[], e: Omit<DiagEvent, "firstDate" | "count">,
): DiagEvent[] {
  const head = log.find((x) => x.source === e.source && x.kind === e.kind);
  if (head && head.ok === e.ok && head.detail === e.detail) {
    const bumped = { ...head, date: e.date, count: head.count + 1 };
    return [bumped, ...log.filter((x) => x !== head)].slice(0, DIAGNOSTICS_CAPACITY);
  }
  return [{ ...e, firstDate: e.date, count: 1 }, ...log].slice(0, DIAGNOSTICS_CAPACITY);
}

export const describeError = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function describeWarnings(titles: string[], complete: boolean): string {
  const base = titles.length ? `${titles.length} in force: ${titles.join("; ")}` : "None in force";
  return complete ? base : `${base} (some alerts didn't load)`;
}

export function parseLog(json: string | null | undefined): DiagEvent[] {
  if (!json) return [];
  try { const r = JSON.parse(json); return Array.isArray(r) ? r.slice(0, DIAGNOSTICS_CAPACITY) : []; } catch { return []; }
}
