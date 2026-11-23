import { LEVEL_RANK, warningTiming } from "../insights";
import type { WarningItem } from "../payload";
import type { WarningLevel } from "../types";

/**
 * Decides which MetService warnings deserve a notification, remembering what
 * has already been announced so each warning is told once, an upgrade is told
 * again, and a lift is told only when MetService withdraws it early.
 * Pure: storage and the notification API are injected by the caller.
 */

export interface RememberedWarning {
  id: string;
  /** What the warning is about ("heavy rain"), so a re-issued warning with a new id is the same hazard. */
  hazard: string;
  headline: string;
  level: WarningLevel;
  /** UTC seconds, or null if open-ended. */
  expires: number | null;
  locationID: string;
  lifted: boolean;
}

export interface WarningNotice { id: string; title: string; body: string; }

export const WARNING_MEMORY_KEY = "weatherTempo.warningMemory";
export const LEGACY_WARNING_KEY = "weatherTempo.notifiedWarnings";
export const WARNING_ID_PREFIX = "weathertempo.warning.";
export const MEMORY_LIMIT = 100;
/** A warning that vanishes within this long of its planned end just ended naturally. */
export const NATURAL_END_MARGIN = 30 * 60;
/** A same-hazard warning issued again within this long of the old one's expiry is a re-issue. */
export const REISSUE_GRACE = 60 * 60;
const KEEP_AFTER_EXPIRY = 7 * 24 * 3600;

const LEVEL_NAME: Record<WarningLevel, string> = { yellow: "Yellow", orange: "Orange", red: "Red" };

/** "Heavy Rain Warning - Orange" → "Heavy Rain Warning". */
export function shortHeadline(h: string): string {
  return h.replace(/\s+[-–—]\s+(yellow|orange|red)\s*$/i, "").trim();
}

export function hazardOf(w: WarningItem): string {
  const e = w.event?.trim();
  return (e ? e : shortHeadline(w.headline)).toLowerCase();
}

/** First sentence of the details text. */
export function summaryOf(w: WarningItem): string {
  const d = (w.details ?? "").replace(/\s+/g, " ").trim();
  if (!d) return "";
  const m = d.match(/^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : d).trim();
}

export interface DecideInput {
  /** Current warnings for the location. */
  warnings: WarningItem[];
  /** True only when the feed was read in full (a partial read can't prove a warning was lifted). */
  complete: boolean;
  memory: RememberedWarning[];
  locationID: string;
  place: string;
  nowSec: number;
  tz: string;
  liftedEnabled: boolean;
}

export interface DecideResult { notices: WarningNotice[]; memory: RememberedWarning[]; }

const joinSentences = (...parts: string[]) => parts.filter(Boolean).map((p) => (/[.!?]$/.test(p) ? p : p + ".")).join(" ");

export function decide(i: DecideInput): DecideResult {
  const notices: WarningNotice[] = [];
  const memory = i.memory.map((m) => ({ ...m }));
  const here = (m: RememberedWarning) => m.locationID === i.locationID;

  // Most severe first, so of two new warnings only the worse one notifies.
  const ordered = [...i.warnings].sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
  const announcedHazards = new Set<string>();

  for (const w of ordered) {
    const hazard = hazardOf(w);
    const known = memory.find((m) => here(m) && m.id === w.id);
    if (known) {                                   // seen this exact warning already
      known.level = w.level; known.expires = w.expires ?? null; known.lifted = false;
      continue;
    }
    // Same hazard still remembered (re-issued under a new id)?
    const prior = memory
      .filter((m) => here(m) && m.hazard === hazard && !m.lifted
        && (m.expires == null || m.expires + REISSUE_GRACE >= i.nowSec))
      .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level])[0];
    const upgraded = !!prior && LEVEL_RANK[w.level] > LEVEL_RANK[prior.level];
    const quiet = (!!prior && !upgraded) || announcedHazards.has(hazard);

    memory.push({
      id: w.id, hazard, headline: shortHeadline(w.headline), level: w.level,
      expires: w.expires ?? null, locationID: i.locationID, lifted: false,
    });
    if (quiet) continue;
    announcedHazards.add(hazard);

    const timing = warningTiming(w, i.nowSec, i.tz);
    const summary = summaryOf(w);
    const lead = upgraded ? `Upgraded from ${LEVEL_NAME[prior!.level].toLowerCase()}.` : "";
    notices.push({
      id: `${WARNING_ID_PREFIX}${w.id}`,
      title: `${w.headline} – ${i.place}`,
      body: joinSentences(lead, timing, summary),
    });
  }

  // Lifted: remembered here, gone from a complete feed, still well before its planned end.
  if (i.complete && i.liftedEnabled) {
    const current = new Set(i.warnings.map((w) => w.id));
    const currentHazards = new Set(i.warnings.map(hazardOf));
    for (const m of memory) {
      if (!here(m) || m.lifted || current.has(m.id)) continue;
      m.lifted = true;
      if (currentHazards.has(m.hazard)) continue;               // replaced, not lifted
      if (m.expires != null && m.expires - i.nowSec <= NATURAL_END_MARGIN) continue;
      notices.push({
        id: `${WARNING_ID_PREFIX}lifted.${m.id}`,
        title: `${m.headline} lifted – ${i.place}`,
        body: `MetService no longer has the ${m.headline} in force for ${i.place}.`,
      });
    }
  } else if (i.complete) {
    const current = new Set(i.warnings.map((w) => w.id));
    for (const m of memory) if (here(m) && !current.has(m.id)) m.lifted = true;
  }

  return { notices, memory: prune(memory, i.nowSec) };
}

/** Drops long-expired entries and caps the list, newest kept. */
export function prune(memory: RememberedWarning[], nowSec: number): RememberedWarning[] {
  const live = memory.filter((m) => m.expires == null || m.expires + KEEP_AFTER_EXPIRY > nowSec);
  return live.slice(Math.max(0, live.length - MEMORY_LIMIT));
}

/** Old builds stored only the ids they had notified; keep those quiet but tracked. */
export function fromLegacy(ids: string[], locationID: string): RememberedWarning[] {
  return ids.map((id) => ({
    id, hazard: id, headline: "Warning", level: "yellow" as WarningLevel, expires: null, locationID, lifted: true,
  }));
}

export function parseMemory(json: string | null | undefined): RememberedWarning[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    return raw.filter((m) => m && typeof m.id === "string" && typeof m.hazard === "string" && m.level in LEVEL_RANK);
  } catch { return []; }
}
