import { ComparisonGroup } from "./types";

const STORAGE_KEY = "etf-backtest-groups-v1";
let cachedGroups: ComparisonGroup[] | null = null;

/**
 * Whether the server is actually storing anything, learned from the first
 * response of the session. `null` means we have not asked yet.
 *
 * When it is false — no D1 binding (`next dev`), or D1 erroring — this module
 * treats localStorage as the system of record rather than as an error path.
 * The old code only reached localStorage when `fetch` itself rejected, which
 * happens on a dropped connection and essentially nothing else: an HTTP 500
 * resolves normally, and a 200 that stored nothing resolves normally too. So
 * the fallback almost never ran and edits were silently discarded.
 */
let remotePersists: boolean | null = null;

function readLocal(): ComparisonGroup[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocal(groups: ComparisonGroup[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  } catch {
    // Private browsing or a full quota. Nothing further to try.
  }
}

/** True only if the response came back OK *and* did not disclaim persistence. */
async function persistedOk(response: Response): Promise<boolean> {
  if (!response.ok) return false;
  try {
    const body = await response.json();
    return body?.persisted !== false;
  } catch {
    return false;
  }
}

export async function loadGroups(): Promise<ComparisonGroup[]> {
  if (cachedGroups !== null) return cachedGroups;

  try {
    const response = await fetch("/api/portfolios");
    if (!response.ok) throw new Error(`API ${response.status}`);
    const data = await response.json();
    remotePersists = data?.persisted !== false;

    if (remotePersists) {
      const groups: ComparisonGroup[] = Array.isArray(data.groups) ? data.groups : [];
      cachedGroups = groups;
      return groups;
    }
  } catch {
    remotePersists = false;
  }

  // Local mode: whatever this browser last wrote is the truth.
  cachedGroups = readLocal();
  return cachedGroups;
}

/**
 * Writes one group. Every caller already holds the full list, so the local
 * snapshot is written from that rather than reconstructed here.
 *
 * Only the changed group is sent. The previous version re-POSTed every group
 * on every keystroke-triggered save, which meant a failure partway through
 * left some rows updated and some not, and then overwrote localStorage with
 * the whole list anyway — the two stores could disagree about different groups
 * in the same save.
 */
async function pushGroup(group: ComparisonGroup): Promise<boolean> {
  if (remotePersists === false) return false;
  try {
    const response = await fetch("/api/portfolios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(group),
    });
    const ok = await persistedOk(response);
    if (!ok) remotePersists = false;
    return ok;
  } catch {
    remotePersists = false;
    return false;
  }
}

export async function upsertGroup(group: ComparisonGroup): Promise<ComparisonGroup[]> {
  const groups = await loadGroups();
  const idx = groups.findIndex((g) => g.id === group.id);
  const next = idx >= 0 ? groups.map((g) => (g.id === group.id ? group : g)) : [...groups, group];
  cachedGroups = next;

  if (!(await pushGroup(group))) writeLocal(next);
  return next;
}

export async function deleteGroup(id: string): Promise<ComparisonGroup[]> {
  const groups = await loadGroups();
  const filtered = groups.filter((g) => g.id !== id);
  cachedGroups = filtered;

  let removed = false;
  if (remotePersists !== false) {
    try {
      const response = await fetch(`/api/portfolios?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      removed = await persistedOk(response);
      if (!removed) remotePersists = false;
    } catch {
      remotePersists = false;
    }
  }

  if (!removed) writeLocal(filtered);
  return filtered;
}

export function newGroupId(): string {
  return `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
