import { World } from "./world";
import { BallType, BALL_ORDER } from "./economy";

export interface SaveData {
  version: 2;
  seed: number;
  changes: number[];
  currency: number;
  upgradePoints: number;
  upgrades: Record<string, number>;
  ballsOwned: Record<string, number>;
  stats: { pixelsMined: number; startedAt: number; won: boolean };
  exploredRuns: number[];
}

const STORAGE_KEY = "tmp-save";

export function diffWorld(world: World): number[] {
  const baseline = world.baseline;
  const changes: number[] = [];
  let prevIdx = 0;
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i] !== baseline[i]) {
      changes.push(i - prevIdx, world.cells[i]);
      prevIdx = i;
    }
  }
  return changes;
}

export function applyDiff(world: World, changes: number[]): void {
  let idx = 0;
  for (let i = 0; i < changes.length; i += 2) {
    idx += changes[i];
    world.cells[idx] = changes[i + 1];
  }
}

export function encodeExplored(explored: Uint8Array): number[] {
  const runs: number[] = [];
  let i = 0;
  while (i < explored.length) {
    if (explored[i] !== 1) {
      i++;
      continue;
    }
    const start = i;
    while (i < explored.length && explored[i] === 1) i++;
    runs.push(start, i - start);
  }
  return runs;
}

export function decodeExplored(runs: number[], out: Uint8Array): void {
  out.fill(0);
  for (let i = 0; i < runs.length; i += 2) {
    const start = runs[i];
    const length = runs[i + 1];
    out.fill(1, start, start + length);
  }
}

export function migrateV1(old: { seed: number; changes: number[]; [k: string]: unknown }): SaveData {
  const rawBalls = (old.ballsOwned ?? {}) as Record<string, unknown>;
  const ballsOwned = {} as Record<BallType, number>;
  for (const t of BALL_ORDER) {
    const v = rawBalls[t];
    ballsOwned[t] = typeof v === "number" && Number.isFinite(v) ? v : 0;
  }

  const rawUpgrades = (old.upgrades ?? {}) as Record<string, unknown>;
  const upgrades: Record<string, number> = {};
  for (const key of Object.keys(rawUpgrades)) {
    const v = rawUpgrades[key];
    if (typeof v === "number" && Number.isFinite(v)) upgrades[key] = v;
  }

  const rawStats = (old.stats ?? {}) as Partial<SaveData["stats"]>;

  return {
    version: 2,
    seed: typeof old.seed === "number" && Number.isFinite(old.seed) ? old.seed : 0,
    changes: Array.isArray(old.changes) ? old.changes : [],
    currency: typeof old.currency === "number" && Number.isFinite(old.currency as number) ? (old.currency as number) : 0,
    upgradePoints: typeof old.upgradePoints === "number" && Number.isFinite(old.upgradePoints as number) ? (old.upgradePoints as number) : 0,
    upgrades,
    ballsOwned,
    stats: {
      pixelsMined: typeof rawStats.pixelsMined === "number" && Number.isFinite(rawStats.pixelsMined) ? rawStats.pixelsMined : 0,
      startedAt: typeof rawStats.startedAt === "number" && Number.isFinite(rawStats.startedAt) ? rawStats.startedAt : Date.now(),
      won: typeof rawStats.won === "boolean" ? rawStats.won : false,
    },
    exploredRuns: [],
  };
}

export function saveGame(data: SaveData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.error("saveGame failed:", err);
  }
}

export function loadGame(): SaveData | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  try {
    const data = JSON.parse(raw) as { version: number; [k: string]: unknown };
    if (data.version === 1) {
      return migrateV1(data as unknown as { seed: number; changes: number[]; [k: string]: unknown });
    }
    if (data.version !== 2) {
      console.warn("loadGame: save has unexpected version, discarding");
      return null;
    }
    return data as unknown as SaveData;
  } catch (err) {
    console.warn("loadGame: corrupt save data, discarding", err);
    return null;
  }
}

export function clearSave(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function normalizeSave(data: SaveData): SaveData {
  const rawBalls = (data.ballsOwned ?? {}) as Record<string, unknown>;
  const ballsOwned = {} as Record<BallType, number>;
  for (const t of BALL_ORDER) {
    const v = rawBalls[t];
    ballsOwned[t] = typeof v === "number" && Number.isFinite(v) ? v : 0;
  }

  const rawUpgrades = (data.upgrades ?? {}) as Record<string, unknown>;
  const upgrades: Record<string, number> = {};
  for (const key of Object.keys(rawUpgrades)) {
    const v = rawUpgrades[key];
    if (typeof v === "number" && Number.isFinite(v)) upgrades[key] = v;
  }

  const rawStats = (data.stats ?? {}) as Partial<SaveData["stats"]>;

  const rawExploredRuns = data.exploredRuns;
  const exploredRuns =
    Array.isArray(rawExploredRuns) && rawExploredRuns.every((v) => typeof v === "number" && Number.isFinite(v))
      ? rawExploredRuns
      : [];

  return {
    version: 2,
    seed: typeof data.seed === "number" && Number.isFinite(data.seed) ? data.seed : 0,
    changes: Array.isArray(data.changes) ? data.changes : [],
    currency: typeof data.currency === "number" && Number.isFinite(data.currency) ? data.currency : 0,
    upgradePoints: typeof data.upgradePoints === "number" && Number.isFinite(data.upgradePoints) ? data.upgradePoints : 0,
    upgrades,
    ballsOwned,
    stats: {
      pixelsMined: typeof rawStats.pixelsMined === "number" && Number.isFinite(rawStats.pixelsMined) ? rawStats.pixelsMined : 0,
      startedAt: typeof rawStats.startedAt === "number" && Number.isFinite(rawStats.startedAt) ? rawStats.startedAt : Date.now(),
      won: typeof rawStats.won === "boolean" ? rawStats.won : false,
    },
    exploredRuns,
  };
}
