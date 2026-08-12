import { mulberry32, valueNoise2D } from "./rng";
import { STAMPS } from "./stamps";
import { biomeAt, biomeHardnessShift } from "./biomes";

export const WORLD_W = 1280;
export const WORLD_H = 800;

export const CELL = {
  EMPTY: 0,
  SOFT: 1,
  MED: 2,
  HARD: 3,
  UPGRADE: 4,
  GOLD: 5,
  OBJECT: 6,
  TREASURE: 7,
  BOSS: 8,
} as const;

export const CELL_HP: number[] = [0, 1, 3, 8, 1, 1, 2, 2, 40];

const CAVITY_RADIUS = 22;
const SPAWN_REVEAL_RADIUS = 30;
const BOSS_BLOB_COUNT = 6;
const BOSS_WALK_STEPS = 40;
const BOSS_DX = [1, -1, 0, 0];
const BOSS_DY = [0, 0, 1, -1];

export class World {
  seed: number;
  cells: Uint8Array;
  baseline: Uint8Array;
  explored: Uint8Array;
  goldenIndex: number;
  bossMap: Map<number, number>;
  bossRemaining: number[];
  onCellChanged?: (x: number, y: number) => void;
  onCellDamaged?: (x: number, y: number) => void;
  private damage: Map<number, number>;

  private constructor(seed: number) {
    this.seed = seed;
    this.cells = new Uint8Array(WORLD_W * WORLD_H);
    this.baseline = new Uint8Array(WORLD_W * WORLD_H);
    this.explored = new Uint8Array(WORLD_W * WORLD_H);
    this.goldenIndex = -1;
    this.bossMap = new Map();
    this.bossRemaining = [];
    this.damage = new Map();
  }

  static generate(seed: number): World {
    const world = new World(seed);
    world.fillTerrain();
    world.stampObjects();
    world.placeUpgrades();
    world.carveSpawnCavity();
    world.placeGoldenPixel();
    world.placeTreasure();
    world.placeBosses();
    world.baseline = world.cells.slice();
    world.reveal(WORLD_W / 2, WORLD_H / 2, SPAWN_REVEAL_RADIUS);
    return world;
  }

  idx(x: number, y: number): number {
    return y * WORLD_W + x;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < WORLD_W && y >= 0 && y < WORLD_H;
  }

  get(x: number, y: number): number {
    if (!this.inBounds(x, y)) return -1;
    return this.cells[this.idx(x, y)];
  }

  isSolid(x: number, y: number): boolean {
    return this.get(x, y) !== CELL.EMPTY;
  }

  isExplored(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    return this.explored[this.idx(x, y)] === 1;
  }

  reveal(x: number, y: number, radius: number): void {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const cx = x + dx, cy = y + dy;
        if (!this.inBounds(cx, cy)) continue;
        const i = this.idx(cx, cy);
        if (this.explored[i] === 1) continue;
        this.explored[i] = 1;
        this.onCellChanged?.(cx, cy);
      }
    }
  }

  damageAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return this.damage.get(this.idx(x, y)) ?? 0;
  }

  hit(x: number, y: number, dmg: number): number {
    if (this.get(x, y) <= 0) return 0;
    const i = this.idx(x, y);
    const cell = this.cells[i];
    const hp = CELL_HP[cell];
    const accum = (this.damage.get(i) ?? 0) + dmg;
    if (accum >= hp) {
      this.cells[i] = CELL.EMPTY;
      this.damage.delete(i);
      this.onCellChanged?.(x, y);
      return cell;
    }
    this.damage.set(i, accum);
    this.onCellDamaged?.(x, y);
    return 0;
  }

  registerBossCellMined(x: number, y: number): number {
    const i = this.idx(x, y);
    const id = this.bossMap.get(i);
    if (id === undefined) return -1;
    this.bossMap.delete(i);
    this.bossRemaining[id]--;
    return this.bossRemaining[id] === 0 ? id : -1;
  }

  private edgeAt(x: number, y: number): number {
    return Math.max(
      Math.abs(x - WORLD_W / 2) / (WORLD_W / 2),
      Math.abs(y - WORLD_H / 2) / (WORLD_H / 2)
    );
  }

  private fillTerrain(): void {
    for (let y = 0; y < WORLD_H; y++) {
      for (let x = 0; x < WORLD_W; x++) {
        const d = valueNoise2D(x, y, this.seed, 48);
        const i = this.idx(x, y);
        if (d < 0.12) {
          this.cells[i] = CELL.EMPTY;
          continue;
        }
        const h = valueNoise2D(x, y, this.seed + 1, 96);
        const edge = this.edgeAt(x, y);
        const hard = h * 0.5 + edge * 0.5;
        let tier: number = hard < 0.45 ? CELL.SOFT : hard < 0.72 ? CELL.MED : CELL.HARD;
        tier = Math.min(3, tier + biomeHardnessShift(biomeAt(x, y, this.seed)));
        this.cells[i] = tier;
      }
    }
  }

  private stampObjects(): void {
    const rng = mulberry32(this.seed + 2);
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    for (let n = 0; n < 40; n++) {
      let stamp = STAMPS[0];
      let ox = 0, oy = 0;
      for (let roll = 0; roll < 3; roll++) {
        stamp = STAMPS[Math.floor(rng() * STAMPS.length)];
        const sh = stamp.length, sw = stamp[0].length;
        ox = Math.floor(rng() * (WORLD_W - sw));
        oy = Math.floor(rng() * (WORLD_H - sh));
        if (roll === 2 || biomeAt(ox, oy, this.seed) === "ruins") break;
      }
      const sh = stamp.length, sw = stamp[0].length;
      let overlaps = false;
      outer: for (let yy = 0; yy < sh; yy++) {
        for (let xx = 0; xx < sw; xx++) {
          if (stamp[yy][xx] !== 1) continue;
          const wx = ox + xx, wy = oy + yy;
          const dx = wx - cx, dy = wy - cy;
          if (dx * dx + dy * dy <= CAVITY_RADIUS * CAVITY_RADIUS) {
            overlaps = true;
            break outer;
          }
        }
      }
      if (overlaps) continue;
      for (let yy = 0; yy < sh; yy++) {
        for (let xx = 0; xx < sw; xx++) {
          if (stamp[yy][xx] !== 1) continue;
          this.cells[this.idx(ox + xx, oy + yy)] = CELL.OBJECT;
        }
      }
    }
  }

  private placeUpgrades(): void {
    const rng2 = mulberry32(this.seed + 3);
    for (let n = 0; n < 400; n++) {
      let x = 0, y = 0;
      for (let roll = 0; roll < 3; roll++) {
        x = Math.floor(rng2() * WORLD_W);
        y = Math.floor(rng2() * WORLD_H);
        if (roll === 2 || biomeAt(x, y, this.seed) === "ruins") break;
      }
      const i = this.idx(x, y);
      const c = this.cells[i];
      const edge = this.edgeAt(x, y);
      if (c >= CELL.SOFT && c <= CELL.HARD && edge > 0.15) {
        this.cells[i] = CELL.UPGRADE;
      }
    }
  }

  private carveSpawnCavity(): void {
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    for (let y = cy - CAVITY_RADIUS; y <= cy + CAVITY_RADIUS; y++) {
      for (let x = cx - CAVITY_RADIUS; x <= cx + CAVITY_RADIUS; x++) {
        if (!this.inBounds(x, y)) continue;
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= CAVITY_RADIUS * CAVITY_RADIUS) {
          this.cells[this.idx(x, y)] = CELL.EMPTY;
        }
      }
    }
  }

  private placeGoldenPixel(): void {
    const rng3 = mulberry32(this.seed + 4);
    for (let attempts = 0; attempts < 1_000_000; attempts++) {
      const x = Math.floor(rng3() * WORLD_W);
      const y = Math.floor(rng3() * WORLD_H);
      const edge = this.edgeAt(x, y);
      const i = this.idx(x, y);
      const c = this.cells[i];
      if (edge > 0.8 && c >= CELL.SOFT && c <= CELL.HARD) {
        this.cells[i] = CELL.GOLD;
        this.goldenIndex = i;
        return;
      }
    }
  }

  private placeTreasure(): void {
    const rngT = mulberry32(this.seed + 6);
    for (let n = 0; n < 250; n++) {
      const x = Math.floor(rngT() * WORLD_W);
      const y = Math.floor(rngT() * WORLD_H);
      const i = this.idx(x, y);
      const c = this.cells[i];
      const edge = this.edgeAt(x, y);
      if (c >= CELL.SOFT && c <= CELL.HARD && edge > 0.15) {
        this.cells[i] = CELL.TREASURE;
      }
    }
  }

  private markBossCell(x: number, y: number, b: number): void {
    const i = this.idx(x, y);
    if (this.bossMap.has(i)) return;
    this.cells[i] = CELL.BOSS;
    this.bossMap.set(i, b);
    this.bossRemaining[b] = (this.bossRemaining[b] ?? 0) + 1;
  }

  private placeBosses(): void {
    const rngB = mulberry32(this.seed + 7);
    for (let b = 0; b < BOSS_BLOB_COUNT; b++) {
      let x = -1, y = -1;
      for (let attempts = 0; attempts < 1_000_000; attempts++) {
        const tx = Math.floor(rngB() * WORLD_W);
        const ty = Math.floor(rngB() * WORLD_H);
        const c = this.cells[this.idx(tx, ty)];
        if (c >= CELL.SOFT && c <= CELL.HARD && this.edgeAt(tx, ty) > 0.3) {
          x = tx; y = ty;
          break;
        }
      }
      if (x < 0) continue;
      this.markBossCell(x, y, b);
      for (let step = 0; step < BOSS_WALK_STEPS; step++) {
        const d = Math.floor(rngB() * 4);
        x += BOSS_DX[d];
        y += BOSS_DY[d];
        if (!this.inBounds(x, y)) continue;
        const c = this.cells[this.idx(x, y)];
        if (c < CELL.SOFT || c > CELL.HARD) continue;
        this.markBossCell(x, y, b);
      }
    }
  }
}
