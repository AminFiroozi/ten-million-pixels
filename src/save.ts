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
  return { ...old, version: 2, exploredRuns: [] } as unknown as SaveData;
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
  const corrected: string[] = [];

  const rawBalls = (data.ballsOwned ?? {}) as Record<string, unknown>;
  const ballsOwned = {} as Record<BallType, number>;
  for (const t of BALL_ORDER) {
    const v = rawBalls[t];
    if (v === undefined) {
      ballsOwned[t] = 0;
    } else if (typeof v === "number" && Number.isFinite(v)) {
      ballsOwned[t] = v;
    } else {
      ballsOwned[t] = 0;
      corrected.push(`ballsOwned.${t}`);
    }
  }

  const rawUpgrades = (data.upgrades ?? {}) as Record<string, unknown>;
  const upgrades: Record<string, number> = {};
  for (const key of Object.keys(rawUpgrades)) {
    const v = rawUpgrades[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      upgrades[key] = v;
    } else {
      corrected.push(`upgrades.${key}`);
    }
  }

  const rawStats = (data.stats ?? {}) as Partial<SaveData["stats"]>;

  const rawExploredRuns = data.exploredRuns;
  const exploredRunsValid =
    Array.isArray(rawExploredRuns) && rawExploredRuns.every((v) => typeof v === "number" && Number.isFinite(v));
  if (!exploredRunsValid) corrected.push("exploredRuns");
  const exploredRuns = exploredRunsValid ? rawExploredRuns : [];

  const seedValid = typeof data.seed === "number" && Number.isFinite(data.seed);
  if (!seedValid) corrected.push("seed");

  const changesValid = Array.isArray(data.changes);
  if (!changesValid) corrected.push("changes");

  const currencyValid = typeof data.currency === "number" && Number.isFinite(data.currency);
  if (!currencyValid) corrected.push("currency");

  const upgradePointsValid = typeof data.upgradePoints === "number" && Number.isFinite(data.upgradePoints);
  if (!upgradePointsValid) corrected.push("upgradePoints");

  const pixelsMinedValid = typeof rawStats.pixelsMined === "number" && Number.isFinite(rawStats.pixelsMined);
  if (!pixelsMinedValid) corrected.push("stats.pixelsMined");

  const startedAtValid = typeof rawStats.startedAt === "number" && Number.isFinite(rawStats.startedAt);
  if (!startedAtValid) corrected.push("stats.startedAt");

  const wonValid = typeof rawStats.won === "boolean";
  if (!wonValid) corrected.push("stats.won");

  if (corrected.length > 0) {
    console.warn("normalizeSave: corrected corrupt/missing fields to defaults:", corrected.join(", "));
  }

  return {
    version: 2,
    seed: seedValid ? data.seed : 0,
    changes: changesValid ? data.changes : [],
    currency: currencyValid ? data.currency : 0,
    upgradePoints: upgradePointsValid ? data.upgradePoints : 0,
    upgrades,
    ballsOwned,
    stats: {
      pixelsMined: pixelsMinedValid ? (rawStats.pixelsMined as number) : 0,
      startedAt: startedAtValid ? (rawStats.startedAt as number) : Date.now(),
      won: wonValid ? (rawStats.won as boolean) : false,
    },
    exploredRuns,
  };
}
