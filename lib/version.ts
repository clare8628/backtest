import pkg from "../package.json";

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYYMMDD.HHmm (Local time), e.g. "20261011.1740" — sortable and compact. */
export function formatBuildStamp(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** Formats ISO timestamp to human-readable local date & time, e.g. "2026-10-11 17:40" */
export function formatBuildTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const APP_VERSION: string = pkg.version;
export const BUILD_TIME_ISO: string = process.env.NEXT_PUBLIC_BUILD_TIME ?? "";
export const BUILD_STAMP: string = formatBuildStamp(BUILD_TIME_ISO);

/** Semver build-metadata form, e.g. "0.2.0+20261011.1740". */
export const DISPLAY_VERSION: string = BUILD_STAMP
  ? `${APP_VERSION}+${BUILD_STAMP}`
  : APP_VERSION;

