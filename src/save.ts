import { World } from "./world";
import { BallType, BALL_ORDER } from "./economy";

export interface SaveData {
  version: 1;
  seed: number;
  changes: number[];
  currency: number;
  upgradePoints: number;
  upgrades: Record<string, number>;
  ballsOwned: Record<string, number>;
  stats: { pixelsMined: number; startedAt: number; won: boolean };
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
    const data = JSON.parse(raw) as SaveData;
    if (data.version !== 1) {
      console.warn("loadGame: save has unexpected version, discarding");
      return null;
    }
    return data;
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

  return {
    version: 1,
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
  };
}
