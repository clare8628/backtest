import pkg from "../package.json";

/** YYYYMMDD.HHmm (UTC), e.g. "20261005.1430" — sortable and compact. */
function formatBuildStamp(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}.${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

export const APP_VERSION: string = pkg.version;
export const BUILD_TIME_ISO: string = process.env.NEXT_PUBLIC_BUILD_TIME ?? "";
export const BUILD_STAMP: string = formatBuildStamp(BUILD_TIME_ISO);

/** Semver build-metadata form, e.g. "0.2.0+20261005.1430". */
export const DISPLAY_VERSION: string = BUILD_STAMP
  ? `${APP_VERSION}+${BUILD_STAMP}`
  : APP_VERSION;
