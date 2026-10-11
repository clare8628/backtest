import pkg from "../package.json";

const pad = (n: number) => String(n).padStart(2, "0");

/** Default timezone is Taipei / Taiwan local time (UTC+8). */
export const DEFAULT_TIMEZONE = "Asia/Taipei";

interface DateTimeParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

/**
 * Extracts 2-digit padded date/time parts for an ISO timestamp string in a given timezone.
 */
export function getTimeParts(
  iso: string | undefined,
  timeZone: string = DEFAULT_TIMEZONE
): DateTimeParts | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const parts = formatter.formatToParts(d).reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
    return {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: parts.hour,
      minute: parts.minute,
    };
  } catch {
    return {
      year: String(d.getFullYear()),
      month: pad(d.getMonth() + 1),
      day: pad(d.getDate()),
      hour: pad(d.getHours()),
      minute: pad(d.getMinutes()),
    };
  }
}

/** YYYYMMDD.HHmm (Local timezone, default Asia/Taipei), e.g. "20261011.1740" — sortable and compact. */
export function formatBuildStamp(iso: string | undefined, timeZone: string = DEFAULT_TIMEZONE): string {
  const parts = getTimeParts(iso, timeZone);
  if (!parts) return "";
  return `${parts.year}${parts.month}${parts.day}.${parts.hour}${parts.minute}`;
}

/** Formats ISO timestamp to human-readable local date & time, e.g. "2026-10-11 17:40" */
export function formatBuildTime(iso: string | undefined, timeZone: string = DEFAULT_TIMEZONE): string {
  const parts = getTimeParts(iso, timeZone);
  if (!parts) return "";
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export const APP_VERSION: string = pkg.version;
export const BUILD_TIME_ISO: string = process.env.NEXT_PUBLIC_BUILD_TIME ?? "";
export const BUILD_STAMP: string = formatBuildStamp(BUILD_TIME_ISO);

/** Semver build-metadata form, e.g. "0.2.0+20261011.1740". */
export const DISPLAY_VERSION: string = BUILD_STAMP
  ? `${APP_VERSION}+${BUILD_STAMP}`
  : APP_VERSION;

