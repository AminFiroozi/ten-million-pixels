import { mulberry32, valueNoise2D } from "./rng";
import { STAMPS } from "./stamps";

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
} as const;

export const CELL_HP: number[] = [0, 1, 3, 8, 1, 1, 2];

const CAVITY_RADIUS = 22;

export class World {
  seed: number;
  cells: Uint8Array;
  baseline: Uint8Array;
  goldenIndex: number;
  onCellChanged?: (x: number, y: number) => void;
  private damage: Map<number, number>;

  private constructor(seed: number) {
    this.seed = seed;
    this.cells = new Uint8Array(WORLD_W * WORLD_H);
    this.baseline = new Uint8Array(WORLD_W * WORLD_H);
    this.goldenIndex = -1;
    this.damage = new Map();
  }

  static generate(seed: number): World {
    const world = new World(seed);
    world.fillTerrain();
    world.stampObjects();
    world.placeUpgrades();
    world.carveSpawnCavity();
    world.placeGoldenPixel();
    world.baseline = world.cells.slice();
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
    return 0;
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
        if (hard < 0.45) this.cells[i] = CELL.SOFT;
        else if (hard < 0.72) this.cells[i] = CELL.MED;
        else this.cells[i] = CELL.HARD;
      }
    }
  }

  private stampObjects(): void {
    const rng = mulberry32(this.seed + 2);
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    for (let n = 0; n < 40; n++) {
      const stamp = STAMPS[Math.floor(rng() * STAMPS.length)];
      const sh = stamp.length, sw = stamp[0].length;
      const ox = Math.floor(rng() * (WORLD_W - sw));
      const oy = Math.floor(rng() * (WORLD_H - sh));
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
      const x = Math.floor(rng2() * WORLD_W);
      const y = Math.floor(rng2() * WORLD_H);
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
}
