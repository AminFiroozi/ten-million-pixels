import { World, WORLD_W, WORLD_H, CELL, CELL_HP } from "./world";
import { hashCoords } from "./rng";
import { Ball } from "./physics";
import { BallType } from "./economy";
import { Biome, biomeAt } from "./biomes";
import { VisualEffectsState } from "./visual-effects";

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
const FOG_COLOR = "#070b08";
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

function verdantTerrain(cell: number, t: number): string {
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
    default:
      return `hsl(${100 + t * 20}, 15%, ${28 + t * 10}%)`;
  }
}

function crystalTerrain(cell: number, t: number): string {
  switch (cell) {
    case CELL.SOFT: {
      if (t < 0.34) return `hsl(${185 + t * 20}, 90%, 65%)`;
      if (t < 0.67) return `hsl(${195 + t * 20}, 85%, 55%)`;
      return `hsl(${170 + t * 15}, 70%, 50%)`;
    }
    case CELL.MED: {
      if (t < 0.34) return `hsl(${185 + t * 20}, 70%, 38%)`;
      if (t < 0.67) return `hsl(${195 + t * 20}, 65%, 32%)`;
      return `hsl(${170 + t * 15}, 55%, 28%)`;
    }
    default:
      return `hsl(${195 + t * 20}, 30%, ${28 + t * 10}%)`;
  }
}

function moltenTerrain(cell: number, t: number): string {
  switch (cell) {
    case CELL.SOFT: {
      if (t < 0.34) return `hsl(${10 + t * 20}, 95%, 58%)`;
      if (t < 0.67) return `hsl(${5 + t * 15}, 90%, 45%)`;
      return `hsl(${15 + t * 10}, 85%, 30%)`;
    }
    case CELL.MED: {
      if (t < 0.34) return `hsl(${10 + t * 20}, 80%, 35%)`;
      if (t < 0.67) return `hsl(${5 + t * 15}, 75%, 28%)`;
      return `hsl(${15 + t * 10}, 70%, 20%)`;
    }
    default:
      return `hsl(${10 + t * 15}, 60%, ${18 + t * 8}%)`;
  }
}

function ruinsTerrain(cell: number, t: number): string {
  switch (cell) {
    case CELL.SOFT: {
      if (t < 0.34) return `hsl(${30 + t * 20}, 25%, 70%)`;
      if (t < 0.67) return `hsl(${35 + t * 15}, 20%, 60%)`;
      return `hsl(${45 + t * 10}, 15%, 50%)`;
    }
    case CELL.MED: {
      if (t < 0.34) return `hsl(${30 + t * 20}, 20%, 45%)`;
      if (t < 0.67) return `hsl(${35 + t * 15}, 18%, 38%)`;
      return `hsl(${45 + t * 10}, 15%, 32%)`;
    }
    default:
      return `hsl(${35 + t * 15}, 12%, ${22 + t * 8}%)`;
  }
}

function terrainColor(cell: number, biome: Biome, t: number): string {
  switch (biome) {
    case "crystal":
      return crystalTerrain(cell, t);
    case "molten":
      return moltenTerrain(cell, t);
    case "ruins":
      return ruinsTerrain(cell, t);
    default:
      return verdantTerrain(cell, t);
  }
}

export function cellColor(cell: number, x: number, y: number, seed: number): string {
  const t = hashCoords(x, y, seed);
  switch (cell) {
    case CELL.SOFT:
    case CELL.MED:
    case CELL.HARD:
      return terrainColor(cell, biomeAt(x, y, seed), t);
    case CELL.UPGRADE:
      return "#fffbe0";
    case CELL.GOLD:
      return "#ffd700";
    case CELL.OBJECT:
      return "#ffffff";
    case CELL.TREASURE:
      return "#ffd75e";
    case CELL.BOSS:
      return "#c13bff";
    default:
      return "";
  }
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  const num = parseInt(h, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let r = 0, g = 0, b = 0;
  if (hue < 60) { r = c; g = x; b = 0; }
  else if (hue < 120) { r = x; g = c; b = 0; }
  else if (hue < 180) { r = 0; g = c; b = x; }
  else if (hue < 240) { r = 0; g = x; b = c; }
  else if (hue < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function darken(hex: string, f: number): string {
  const hslMatch = hex.match(/^hsl\(\s*([-\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/);
  const [r, g, b] = hslMatch
    ? hslToRgb(parseFloat(hslMatch[1]), parseFloat(hslMatch[2]), parseFloat(hslMatch[3]))
    : hexToRgb(hex);
  const k = 1 - f;
  return `rgb(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)})`;
}

function isDamageTintable(cell: number): boolean {
  return cell === CELL.SOFT || cell === CELL.MED || cell === CELL.HARD ||
    cell === CELL.OBJECT || cell === CELL.TREASURE || cell === CELL.BOSS;
}

function paintedColor(world: World, cell: number, x: number, y: number): string {
  let color = cellColor(cell, x, y, world.seed);
  if (isDamageTintable(cell)) {
    const damage = world.damageAt(x, y);
    if (damage > 0) {
      color = darken(color, Math.min(0.65, (0.65 * damage) / CELL_HP[cell]));
    }
  }
  return color;
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
  showTreasurePulse: boolean = false;
  private world: World;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private chunksX: number;
  private chunksY: number;
  private chunks: Map<number, Chunk>;
  private dirty: Set<number>;
  private dirtyCells: Map<number, Set<number>>;
  private particles: Particle[];
  private time: number;
  private ballSprites: Map<BallType, CanvasLike>;
  private readonly effects: VisualEffectsState;

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
    this.effects = new VisualEffectsState();
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
      cells = new Set();
      this.dirtyCells.set(id, cells);
    }
    cells.add(this.world.idx(x, y));
    if (cells.size > MAX_DIRTY_CELLS) {
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

  addImpact(x: number, y: number, color: string, strength = 1, cascadeDepth = 0): void {
    this.effects.addImpact({ x, y, color, strength, cascadeDepth });
    const direction = ((x * 17 + y * 31) % 2 === 0 ? 1 : -1) * Math.min(0.8, strength * 0.12);
    this.effects.addImpulse(direction, -direction * 0.6);
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
        if (!this.world.isExplored(x, y)) {
          ctx.fillStyle = FOG_COLOR;
          ctx.fillRect(x - x0, y - y0, 1, 1);
          continue;
        }
        const cell = this.world.get(x, y);
        if (cell <= CELL.EMPTY) continue;
        ctx.fillStyle = paintedColor(this.world, cell, x, y);
        ctx.fillRect(x - x0, y - y0, 1, 1);
        if (cell === CELL.UPGRADE || cell === CELL.GOLD || cell === CELL.TREASURE) {
          chunk.pulseCells.push({ x, y, cell });
        }
      }
    }
  }

  private updatePulseCell(chunk: Chunk, x: number, y: number, cell: number): void {
    const idx = chunk.pulseCells.findIndex(p => p.x === x && p.y === y);
    if (idx !== -1) chunk.pulseCells.splice(idx, 1);
    if (cell === CELL.UPGRADE || cell === CELL.GOLD || cell === CELL.TREASURE) {
      chunk.pulseCells.push({ x, y, cell });
    }
  }

  private patchChunk(cx: number, cy: number, cellIndices: Set<number>): void {
    const chunk = this.chunks.get(this.chunkId(cx, cy)) as Chunk;
    const ctx = chunk.ctx;
    const x0 = cx * CHUNK;
    const y0 = cy * CHUNK;
    for (const i of cellIndices) {
      const y = Math.floor(i / WORLD_W);
      const x = i - y * WORLD_W;
      const lx = x - x0;
      const ly = y - y0;
      ctx.clearRect(lx, ly, 1, 1);
      if (!this.world.isExplored(x, y)) {
        ctx.fillStyle = FOG_COLOR;
        ctx.fillRect(lx, ly, 1, 1);
        this.updatePulseCell(chunk, x, y, -1);
        continue;
      }
      const cell = this.world.get(x, y);
      if (cell > CELL.EMPTY) {
        ctx.fillStyle = paintedColor(this.world, cell, x, y);
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
    if (cells && cells.size > 0) {
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

  private drawTrails(cam: Camera, w: number, h: number): void {
    const ctx = this.ctx;
    for (const trail of this.effects.trails) {
      const age = trail.age ?? 0;
      const alpha = Math.max(0, 0.28 * (1 - age / 0.24));
      if (alpha === 0) continue;
      const [sx, sy] = worldToScreen(cam, w, h, trail.x, trail.y);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = BALL_COLORS[trail.type];
      const size = Math.max(1, cam.zoom * (0.8 - age * 2));
      ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  private drawImpacts(cam: Camera, w: number, h: number): void {
    const ctx = this.ctx;
    for (const impact of this.effects.impacts) {
      const progress = Math.min(1, impact.age / impact.life);
      const alpha = Math.max(0, 1 - progress);
      const [sx, sy] = worldToScreen(cam, w, h, impact.x, impact.y);
      const radius = cam.zoom * (1 + progress * (2 + impact.cascadeDepth * 0.5)) * impact.strength;
      ctx.globalAlpha = alpha * 0.8;
      ctx.strokeStyle = impact.color;
      ctx.lineWidth = Math.max(1, cam.zoom * 0.35);
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = impact.color;
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
          if (p.cell === CELL.TREASURE && !this.showTreasurePulse) continue;
          if (this.world.get(p.x, p.y) !== p.cell) continue;
          const [sx, sy] = worldToScreen(cam, w, h, p.x, p.y);
          ctx.globalAlpha = alpha;
          ctx.fillStyle = p.cell === CELL.GOLD ? "#fff7c0" : p.cell === CELL.TREASURE ? "#ffe9a8" : "#ffffff";
          ctx.fillRect(sx, sy, cam.zoom, cam.zoom);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  draw(cam: Camera, balls: Ball[], dt: number): void {
    this.time += dt;
    for (const ball of balls) this.effects.pushTrail({ x: ball.x, y: ball.y, type: ball.type });
    this.effects.advance(dt);
    const visualCam: Camera = {
      x: cam.x - this.effects.impulse.x,
      y: cam.y - this.effects.impulse.y,
      zoom: cam.zoom,
    };
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;

    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    const [wx0, wy0] = screenToWorld(visualCam, w, h, 0, 0);
    const [wx1, wy1] = screenToWorld(visualCam, w, h, w, h);
    const cx0 = Math.max(0, Math.floor(Math.min(wx0, wx1) / CHUNK));
    const cy0 = Math.max(0, Math.floor(Math.min(wy0, wy1) / CHUNK));
    const cx1 = Math.min(this.chunksX - 1, Math.floor(Math.max(wx0, wx1) / CHUNK));
    const cy1 = Math.min(this.chunksY - 1, Math.floor(Math.max(wy0, wy1) / CHUNK));

    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = this.ensureChunkRastered(cx, cy);
        const x0 = cx * CHUNK;
        const y0 = cy * CHUNK;
        const [sx, sy] = worldToScreen(visualCam, w, h, x0, y0);
        const size = CHUNK * visualCam.zoom;
        ctx.drawImage(chunk.canvas, sx, sy, size, size);
      }
    }

    this.drawTrails(visualCam, w, h);
    this.drawBalls(visualCam, w, h, balls);
    this.drawImpacts(visualCam, w, h);
    this.updateParticles(dt);
    this.drawParticles(visualCam, w, h);
    this.drawPulseOverlay(visualCam, w, h, cx0, cy0, cx1, cy1);
  }
}
