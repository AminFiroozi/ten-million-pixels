import { BallType } from "./economy";

export interface TrailSample {
  x: number;
  y: number;
  type: BallType;
  age?: number;
}

export interface ImpactEvent {
  x: number;
  y: number;
  color: string;
  strength: number;
  cascadeDepth: number;
  age: number;
  life: number;
}

export interface VisualEffectsOptions {
  maxTrails?: number;
  maxImpacts?: number;
  impulseDecay?: number;
}

const DEFAULT_MAX_TRAILS = 240;
const DEFAULT_MAX_IMPACTS = 96;
const DEFAULT_IMPULSE_DECAY = 10;

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Math.max(0, Math.floor(finite(value ?? fallback, fallback)));
}

export class VisualEffectsState {
  readonly trails: TrailSample[] = [];
  readonly impacts: ImpactEvent[] = [];
  readonly impulse = { x: 0, y: 0 };

  private readonly maxTrails: number;
  private readonly maxImpacts: number;
  private readonly impulseDecay: number;

  constructor(options: VisualEffectsOptions = {}) {
    this.maxTrails = positiveInteger(options.maxTrails, DEFAULT_MAX_TRAILS);
    this.maxImpacts = positiveInteger(options.maxImpacts, DEFAULT_MAX_IMPACTS);
    this.impulseDecay = Math.max(0, finite(options.impulseDecay ?? DEFAULT_IMPULSE_DECAY, DEFAULT_IMPULSE_DECAY));
  }

  pushTrail(sample: TrailSample): void {
    if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y) || this.maxTrails === 0) return;
    this.trails.push({ ...sample, age: 0 });
    if (this.trails.length > this.maxTrails) {
      this.trails.splice(0, this.trails.length - this.maxTrails);
    }
  }

  addImpact(event: { x: number; y: number; color: string; strength?: number; cascadeDepth?: number; life?: number }): void {
    if (!Number.isFinite(event.x) || !Number.isFinite(event.y) || this.maxImpacts === 0) return;
    this.impacts.push({
      x: event.x,
      y: event.y,
      color: event.color,
      strength: Math.max(0, finite(event.strength ?? 1, 1)),
      cascadeDepth: Math.max(0, Math.floor(finite(event.cascadeDepth ?? 0, 0))),
      age: 0,
      life: Math.max(0.05, finite(event.life ?? 0.35, 0.35)),
    });
    if (this.impacts.length > this.maxImpacts) {
      this.impacts.splice(0, this.impacts.length - this.maxImpacts);
    }
  }

  addImpulse(x: number, y: number): void {
    this.impulse.x = finite(this.impulse.x + finite(x));
    this.impulse.y = finite(this.impulse.y + finite(y));
  }

  advance(dt: number): void {
    const safeDt = Math.max(0, finite(dt));
    const decay = Math.exp(-this.impulseDecay * safeDt);
    this.impulse.x = finite(this.impulse.x * decay);
    this.impulse.y = finite(this.impulse.y * decay);

    for (const trail of this.trails) trail.age = finite((trail.age ?? 0) + safeDt);
    for (const impact of this.impacts) impact.age += safeDt;
    this.impacts.splice(0, this.impacts.length, ...this.impacts.filter(impact => impact.age < impact.life));
  }
}
