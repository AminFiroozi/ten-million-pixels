import { World, WORLD_W, WORLD_H, CELL } from "./world";
import { hashCoords } from "./rng";
import { Ball } from "./physics";
import { BallType } from "./economy";

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const CHUNK = 64;

export const BALL_COLORS: Record<BallType, string> = {
  white: "#fff",
  blue: "#4af",
  red: "#f44",
  green: "#5f5",
  orange: "#fa4",
  yellow: "#ff5",
  purple: "#b4f",
};

const BG_COLOR = "#050a06";
const SPRITE_SIZE = 16;
const BALL_RADIUS = 3;
const GLOW_BLUR = 8;
const MAX_PARTICLES = 500;
const MAX_DIRTY_CELLS = 1024;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

interface PulseCell {
  x: number;
  y: number;
  cell: number;
}

export function worldToScreen(cam: Camera, w: number, h: number, x: number, y: number): [number, number] {
  const sx = (x - cam.x) * cam.zoom + w / 2;
  const sy = (y - cam.y) * cam.zoom + h / 2;
  return [sx, sy];
}

export function screenToWorld(cam: Camera, w: number, h: number, sx: number, sy: number): [number, number] {
  const x = (sx - w / 2) / cam.zoom + cam.x;
  const y = (sy - h / 2) / cam.zoom + cam.y;
  return [x, y];
}

export function cellColor(cell: number, x: number, y: number, seed: number): string {
  const t = hashCoords(x, y, seed);
  switch (cell) {
    case CELL.SOFT: {
      if (t < 0.34) return `hsl(${100 + t * 40}, 90%, 55%)`;
      if (t < 0.67) return `hsl(${25 + t * 20}, 95%, 55%)`;
      return `hsl(${5 + t * 15}, 90%, 55%)`;
    }
    case CELL.MED: {
      if (t < 0.34) return `hsl(${100 + t * 40}, 70%, 32%)`;
      if (t < 0.67) return `hsl(${25 + t * 20}, 75%, 32%)`;
      return `hsl(${5 + t * 15}, 70%, 32%)`;
    }
    case CELL.HARD:
      return `hsl(${100 + t * 20}, 15%, ${28 + t * 10}%)`;
    case CELL.UPGRADE:
      return "#fffbe0";
    case CELL.GOLD:
      return "#ffd700";
    case CELL.OBJECT:
      return "#ffffff";
    default:
      return "";
  }
}

type CanvasLike = HTMLCanvasElement | OffscreenCanvas;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvas(size: number): CanvasLike {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(size, size);
  }
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  return c;
}

function makeChunkCanvas(): CanvasLike {
  return makeCanvas(CHUNK);
}

function makeBallSprite(color: string): CanvasLike {
  const canvas = makeCanvas(SPRITE_SIZE);
  const ctx = canvas.getContext("2d") as Ctx2D | null;
  if (!ctx) throw new Error("2d context unavailable");
  const center = SPRITE_SIZE / 2;
  ctx.shadowBlur = GLOW_BLUR;
  ctx.shadowColor = color;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(center, center, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  return canvas;
}

interface Chunk {
  canvas: CanvasLike;
  ctx: Ctx2D;
  pulseCells: PulseCell[];
}

export class Renderer {
  private world: World;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private chunksX: number;
  private chunksY: number;
  private chunks: Map<number, Chunk>;
  private dirty: Set<number>;
  private dirtyCells: Map<number, number[]>;
  private particles: Particle[];
  private time: number;
  private ballSprites: Map<BallType, CanvasLike>;

  constructor(world: World, canvas: HTMLCanvasElement) {
    this.world = world;
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.chunksX = Math.ceil(WORLD_W / CHUNK);
    this.chunksY = Math.ceil(WORLD_H / CHUNK);
    this.chunks = new Map();
    this.dirty = new Set();
    this.dirtyCells = new Map();
    this.particles = [];
    this.time = 0;
    this.ballSprites = new Map();
    for (const type of Object.keys(BALL_COLORS) as BallType[]) {
      this.ballSprites.set(type, makeBallSprite(BALL_COLORS[type]));
    }
  }

  private chunkId(cx: number, cy: number): number {
    return cy * this.chunksX + cx;
  }

  markDirty(x: number, y: number): void {
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    if (cx < 0 || cy < 0 || cx >= this.chunksX || cy >= this.chunksY) return;
    const id = this.chunkId(cx, cy);
    if (!this.chunks.has(id) || this.dirty.has(id)) return;
    let cells = this.dirtyCells.get(id);
    if (!cells) {
      cells = [];
      this.dirtyCells.set(id, cells);
    }
    cells.push(this.world.idx(x, y));
    if (cells.length > MAX_DIRTY_CELLS) {
      this.dirty.add(id);
      this.dirtyCells.delete(id);
    }
  }

  addBurst(x: number, y: number, color: string): void {
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 10 + Math.random() * 20;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.4 + Math.random() * 0.3,
        color,
      });
    }
    if (this.particles.length > MAX_PARTICLES) {
      this.particles.splice(0, this.particles.length - MAX_PARTICLES);
    }
  }

  private getOrCreateChunk(cx: number, cy: number): Chunk {
    const id = this.chunkId(cx, cy);
    let chunk = this.chunks.get(id);
    if (!chunk) {
      const canvas = makeChunkCanvas();
      const ctx = canvas.getContext("2d") as Ctx2D | null;
      if (!ctx) throw new Error("2d context unavailable");
      chunk = { canvas, ctx, pulseCells: [] };
      this.chunks.set(id, chunk);
      this.dirty.add(id);
    }
    return chunk;
  }

  private rasterChunk(cx: number, cy: number): void {
    const chunk = this.getOrCreateChunk(cx, cy);
    const ctx = chunk.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, CHUNK, CHUNK);
    chunk.pulseCells = [];
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const x1 = Math.min(WORLD_W, x0 + CHUNK);
    const y1 = Math.min(WORLD_H, y0 + CHUNK);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const cell = this.world.get(x, y);
        if (cell <= CELL.EMPTY) continue;
        const color = cellColor(cell, x, y, this.world.seed);
        ctx.fillStyle = color;
        ctx.fillRect(x - x0, y - y0, 1, 1);
        if (cell === CELL.UPGRADE || cell === CELL.GOLD) {
          chunk.pulseCells.push({ x, y, cell });
        }
      }
    }
  }

  private updatePulseCell(chunk: Chunk, x: number, y: number, cell: number): void {
    const idx = chunk.pulseCells.findIndex(p => p.x === x && p.y === y);
    if (idx !== -1) chunk.pulseCells.splice(idx, 1);
    if (cell === CELL.UPGRADE || cell === CELL.GOLD) {
      chunk.pulseCells.push({ x, y, cell });
    }
  }

  private patchChunk(cx: number, cy: number, cellIndices: number[]): void {
    const chunk = this.chunks.get(this.chunkId(cx, cy)) as Chunk;
    const ctx = chunk.ctx;
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    const seen = new Set<number>();
    for (const i of cellIndices) {
      if (seen.has(i)) continue;
      seen.add(i);
      const y = Math.floor(i / WORLD_W);
      const x = i - y * WORLD_W;
      const lx = x - x0;
      const ly = y - y0;
      ctx.clearRect(lx, ly, 1, 1);
      const cell = this.world.get(x, y);
      if (cell > CELL.EMPTY) {
        ctx.fillStyle = cellColor(cell, x, y, this.world.seed);
        ctx.fillRect(lx, ly, 1, 1);
      }
      this.updatePulseCell(chunk, x, y, cell);
    }
  }

  private ensureChunkRastered(cx: number, cy: number): Chunk {
    const id = this.chunkId(cx, cy);
    if (!this.chunks.has(id) || this.dirty.has(id)) {
      this.rasterChunk(cx, cy);
      this.dirty.delete(id);
      this.dirtyCells.delete(id);
      return this.chunks.get(id) as Chunk;
    }
    const cells = this.dirtyCells.get(id);
    if (cells && cells.length > 0) {
      this.patchChunk(cx, cy, cells);
      this.dirtyCells.delete(id);
    }
    return this.chunks.get(id) as Chunk;
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter(p => p.life > 0);
  }

  private drawParticles(cam: Camera, w: number, h: number): void {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const [sx, sy] = worldToScreen(cam, w, h, p.x, p.y);
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.fillStyle = p.color;
      ctx.fillRect(sx - 1, sy - 1, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  private drawBalls(cam: Camera, w: number, h: number, balls: Ball[]): void {
    const ctx = this.ctx;
    const half = SPRITE_SIZE / 2;
    for (const ball of balls) {
      const [sx, sy] = worldToScreen(cam, w, h, ball.x, ball.y);
      const sprite = this.ballSprites.get(ball.type);
      if (!sprite) continue;
      ctx.drawImage(sprite as CanvasImageSource, sx - half, sy - half, SPRITE_SIZE, SPRITE_SIZE);
    }
  }

  private drawPulseOverlay(cam: Camera, w: number, h: number, cx0: number, cy0: number, cx1: number, cy1: number): void {
    const ctx = this.ctx;
    const alpha = 0.35 + 0.35 * Math.sin(this.time * 4);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const id = this.chunkId(cx, cy);
        const chunk = this.chunks.get(id);
        if (!chunk || chunk.pulseCells.length === 0) continue;
        for (const p of chunk.pulseCells) {
          if (this.world.get(p.x, p.y) !== p.cell) continue;
          const [sx, sy] = worldToScreen(cam, w, h, p.x, p.y);
          ctx.globalAlpha = alpha;
          ctx.fillStyle = p.cell === CELL.GOLD ? "#fff7c0" : "#ffffff";
          ctx.fillRect(sx, sy, cam.zoom, cam.zoom);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  draw(cam: Camera, balls: Ball[], dt: number): void {
    this.time += dt;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;

    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    const [wx0, wy0] = screenToWorld(cam, w, h, 0, 0);
    const [wx1, wy1] = screenToWorld(cam, w, h, w, h);
    const cx0 = Math.max(0, Math.floor(Math.min(wx0, wx1) / CHUNK));
    const cy0 = Math.max(0, Math.floor(Math.min(wy0, wy1) / CHUNK));
    const cx1 = Math.min(this.chunksX - 1, Math.floor(Math.max(wx0, wx1) / CHUNK));
    const cy1 = Math.min(this.chunksY - 1, Math.floor(Math.max(wy0, wy1) / CHUNK));

    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = this.ensureChunkRastered(cx, cy);
        const x0 = cx * CHUNK;
        const y0 = cy * CHUNK;
        const [sx, sy] = worldToScreen(cam, w, h, x0, y0);
        const size = CHUNK * cam.zoom;
        ctx.drawImage(chunk.canvas, sx, sy, size, size);
      }
    }

    this.drawBalls(cam, w, h, balls);
    this.updateParticles(dt);
    this.drawParticles(cam, w, h);
    this.drawPulseOverlay(cam, w, h, cx0, cy0, cx1, cy1);
  }
}
