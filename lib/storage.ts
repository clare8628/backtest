import { ComparisonGroup } from "./types";

const STORAGE_KEY = "etf-backtest-groups-v1";
let cachedGroups: ComparisonGroup[] | null = null;

// Fetch groups from D1 API
export async function loadGroups(): Promise<ComparisonGroup[]> {
  // Return cached if available
  if (cachedGroups !== null) return cachedGroups;

  try {
    const response = await fetch("/api/portfolios");
    if (!response.ok) throw new Error("API error");
    const data = await response.json();
    const groups = Array.isArray(data.groups) ? data.groups : [];
    cachedGroups = groups;
    return groups;
  } catch {
    // Fallback to localStorage on error
    if (typeof window === "undefined") {
      cachedGroups = [];
      return cachedGroups;
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        cachedGroups = [];
        return cachedGroups;
      }
      const parsed = JSON.parse(raw);
      cachedGroups = Array.isArray(parsed) ? parsed : [];
      return cachedGroups;
    } catch {
      cachedGroups = [];
      return cachedGroups;
    }
  }
}

// Save groups to D1 API
export async function saveGroups(groups: ComparisonGroup[]): Promise<void> {
  cachedGroups = groups;
  try {
    for (const group of groups) {
      await fetch("/api/portfolios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(group),
      });
    }
  } catch {
    // Fallback to localStorage
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
    }
  }
}

export async function upsertGroup(group: ComparisonGroup): Promise<ComparisonGroup[]> {
  const groups = await loadGroups();
  const idx = groups.findIndex((g) => g.id === group.id);
  if (idx >= 0) {
    groups[idx] = group;
  } else {
    groups.push(group);
  }
  await saveGroups(groups);
  return groups;
}

export async function deleteGroup(id: string): Promise<ComparisonGroup[]> {
  const groups = await loadGroups();
  const filtered = groups.filter((g) => g.id !== id);

  try {
    await fetch(`/api/portfolios?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    // Fallback to localStorage
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    }
  }

  cachedGroups = filtered;
  return filtered;
}

export function newGroupId(): string {
  return `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
