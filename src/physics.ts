import { World, WORLD_W, CELL } from "./world";
import { BallType } from "./economy";
import { mulberry32 } from "./rng";
import { biomeAt, MOLTEN_DESTROY_CHANCE } from "./biomes";

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: BallType;
  ttl: number;
  pierceLeft: number;
  dead: boolean;
}

export interface AbilityStats {
  speedMul: number;
  dmgMul: number;
  smashRadius: number;
  poisonSpread: number;
  splitCount: number;
  pierceDepth: number;
  moltenImmune: boolean;
  darkSpeedMul: number;
}

export type MineCallback = (cell: number, x: number, y: number) => void;

const BASE_SPEED = 90;
const MAX_SUBSTEP = 0.9;
const POISON_TICK = 0.5;
const MAX_BALLS = 20000;

export class Physics {
  world: World;
  balls: Ball[];
  poison: Map<number, number>;
  private rng: () => number;
  private poisonAccum: number;

  constructor(world: World) {
    this.world = world;
    this.balls = [];
    this.poison = new Map();
    this.rng = mulberry32(world.seed);
    this.poisonAccum = 0;
  }

  spawn(type: BallType, x: number, y: number, angle: number, speedMul: number = 1): void {
    if (this.balls.length >= MAX_BALLS) return;
    const ball: Ball = {
      x,
      y,
      vx: Math.cos(angle) * BASE_SPEED * speedMul,
      vy: Math.sin(angle) * BASE_SPEED * speedMul,
      type,
      ttl: -1,
      pierceLeft: type === "yellow" ? -1 : 0,
      dead: false,
    };
    if (type === "blue") this.snapToAxis(ball);
    this.balls.push(ball);
  }

  step(dt: number, stats: AbilityStats, onMined: MineCallback): void {
    for (const ball of this.balls) {
      this.moveBall(ball, dt, stats, onMined);
    }

    this.tickPoison(dt, stats, onMined);

    for (const ball of this.balls) {
      if (ball.ttl >= 0) ball.ttl -= dt;
    }

    this.balls = this.balls.filter(b =>
      !b.dead &&
      Number.isFinite(b.x) &&
      Number.isFinite(b.y) &&
      Number.isFinite(b.vx) &&
      Number.isFinite(b.vy) &&
      (b.ttl === -1 || b.ttl > 0)
    );
  }

  private moveBall(ball: Ball, dt: number, stats: AbilityStats, onMined: MineCallback): void {
    const speedScale = ball.type === "purple" ? 0.6 : 1;
    const totalDist = BASE_SPEED * stats.speedMul * dt * speedScale;
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed === 0 || !Number.isFinite(totalDist)) return;

    let dirX = ball.vx / speed;
    let dirY = ball.vy / speed;

    let remaining = totalDist;
    while (remaining > 0 && !ball.dead) {
      const sub = Math.min(MAX_SUBSTEP, remaining);
      remaining -= sub;

      const darkMul = this.world.isExplored(Math.floor(ball.x), Math.floor(ball.y)) ? 1 : stats.darkSpeedMul;
      const moveDist = sub * darkMul;

      const nx = ball.x + dirX * moveDist;
      const ny = ball.y + dirY * moveDist;

      if (this.world.isSolid(Math.floor(nx), Math.floor(ny))) {
        const passThrough = this.resolveCollision(ball, nx, ny, stats, onMined);
        if (!passThrough) break;

        ball.x = nx;
        ball.y = ny;

        const newSpeed = Math.hypot(ball.vx, ball.vy);
        if (newSpeed === 0) break;
        dirX = ball.vx / newSpeed;
        dirY = ball.vy / newSpeed;
        continue;
      }

      ball.x = nx;
      ball.y = ny;
    }
  }

  private resolveCollision(ball: Ball, nx: number, ny: number, stats: AbilityStats, onMined: MineCallback): boolean {
    const hitX = Math.floor(nx);
    const hitY = Math.floor(ny);
    const solidX = this.world.isSolid(Math.floor(nx), Math.floor(ball.y));
    const solidY = this.world.isSolid(Math.floor(ball.x), Math.floor(ny));

    const reflect = (): void => {
      if (solidX) ball.vx = -ball.vx;
      if (solidY) ball.vy = -ball.vy;
      if (!solidX && !solidY) {
        ball.vx = -ball.vx;
        ball.vy = -ball.vy;
      }
      if (ball.type === "blue") this.snapToAxis(ball);
    };

    if (ball.type === "yellow" && ball.pierceLeft < 0) {
      ball.pierceLeft = stats.pierceDepth;
    }

    if (ball.type === "yellow" && ball.pierceLeft > 0) {
      const destroyed = this.world.hit(hitX, hitY, 999);
      if (destroyed) onMined(destroyed, hitX, hitY);
      if (this.rollMolten(hitX, hitY, stats)) {
        ball.dead = true;
        return false;
      }
      ball.pierceLeft -= 1;
      return true;
    }

    const damage = 1 * stats.dmgMul * (ball.type === "purple" ? 5 : 1);
    const destroyed = this.world.hit(hitX, hitY, damage);
    if (destroyed) onMined(destroyed, hitX, hitY);

    if (this.rollMolten(hitX, hitY, stats)) {
      ball.dead = true;
      return false;
    }

    if (ball.type === "red") {
      this.smash(hitX, hitY, stats.smashRadius, damage, onMined);
    }

    if (ball.type === "green" && !destroyed && this.world.isSolid(hitX, hitY)) {
      this.poison.set(this.world.idx(hitX, hitY), 0);
    }

    if (ball.type === "orange") {
      this.spawnShards(nx, ny, stats.splitCount);
    }

    if (ball.type === "purple" && destroyed) {
      return true;
    }

    reflect();

    if (ball.type === "yellow") {
      ball.pierceLeft = stats.pierceDepth;
    }

    return false;
  }

  private rollMolten(hitX: number, hitY: number, stats: AbilityStats): boolean {
    if (stats.moltenImmune) return false;
    if (biomeAt(hitX, hitY, this.world.seed) !== "molten") return false;
    return this.rng() < MOLTEN_DESTROY_CHANCE;
  }

  private smash(cx: number, cy: number, radius: number, dmg: number, onMined: MineCallback): void {
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (!this.world.isSolid(x, y)) continue;
        const destroyed = this.world.hit(x, y, dmg);
        if (destroyed) onMined(destroyed, x, y);
      }
    }
  }

  private spawnShards(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = this.rng() * Math.PI * 2;
      this.spawn("white", x, y, angle);
      this.balls[this.balls.length - 1].ttl = 3;
    }
  }

  private snapToAxis(ball: Ball): void {
    const speed = Math.hypot(ball.vx, ball.vy);
    if (Math.abs(ball.vx) >= Math.abs(ball.vy)) {
      ball.vx = ball.vx >= 0 ? speed : -speed;
      ball.vy = 0;
    } else {
      ball.vy = ball.vy >= 0 ? speed : -speed;
      ball.vx = 0;
    }
  }

  private tickPoison(dt: number, stats: AbilityStats, onMined: MineCallback): void {
    this.poisonAccum += dt;
    while (this.poisonAccum >= POISON_TICK) {
      this.poisonAccum -= POISON_TICK;
      const indices = Array.from(this.poison.keys());
      for (const i of indices) {
        const y = Math.floor(i / WORLD_W);
        const x = i - y * WORLD_W;
        const destroyed = this.world.hit(x, y, 1);
        if (destroyed) {
          onMined(destroyed, x, y);
          this.poison.delete(i);
        }
        if (this.rng() < 0.15 * stats.poisonSpread) {
          this.infectNeighbor(x, y);
        }
      }
    }
  }

  private infectNeighbor(x: number, y: number): void {
    const neighbors = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    const solidNeighbors = neighbors.filter(([nx, ny]) => this.world.get(nx, ny) > CELL.EMPTY);
    if (solidNeighbors.length === 0) return;
    const [nx, ny] = solidNeighbors[Math.floor(this.rng() * solidNeighbors.length)];
    this.poison.set(this.world.idx(nx, ny), 0);
  }
}
