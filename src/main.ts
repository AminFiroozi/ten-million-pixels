import { World, CELL, WORLD_W, WORLD_H } from "./world";
import { SaveData, diffWorld, applyDiff, saveGame, loadGame, clearSave, normalizeSave, encodeExplored, decodeExplored } from "./save";
import { EconomyState, BallType, BALL_ORDER, newEconomy, pixelValue, statMul, abilityLevel } from "./economy";
import { clampPull, launchSpeedMul, nextBallType, shouldLaunch, type Point } from "./slingshot";
import { biomeAt, biomeValueMul } from "./biomes";
import { Physics, AbilityStats } from "./physics";
import { Renderer, Camera, screenToWorld, worldToScreen, cellColor } from "./render";
import { UI } from "./ui";
import { AugmentState, newAugmentState, augmentMul, augmentBonus, pickAugment, rollChoices } from "./augments";
import { resolveFracture, FRACTURE_MAX_DEPTH } from "./erosion";
import { advanceCombo, type ComboState } from "./combo";
import { sweepGrid } from "./grid-collision";

const SIM_DT = 1 / 120;
const MAX_SIM_STEPS = 5;
const SPAWN_CAVITY_X = 640;
const SPAWN_CAVITY_Y = 400;
const AUTOSAVE_MS = 10000;
const AUGMENT_MILESTONE = 20;
const RADAR_INTERVAL_S = 2;
const PINCH_ZOOM_MIN = 0.5;
const PINCH_ZOOM_MAX = 24;
const TOUCH_DRAG_THRESHOLD = 12;
const LAUNCH_ZONE_RADIUS = 32;
const MAX_PULL = 120;
const MIN_PULL = 8;
const MIN_LAUNCH_SPEED = 0.55;
const MAX_LAUNCH_SPEED = 1.55;
const PREVIEW_DOTS = 32;
const PREVIEW_DT = 0.08;
const PREVIEW_BASE_SPEED = 90;
const PREVIEW_EPSILON = 1e-4;

const rawSave = loadGame();
const save = rawSave ? normalizeSave(rawSave) : null;

let world: World;
let economy: EconomyState;
let stats: { pixelsMined: number; startedAt: number; won: boolean };
let augmentState: AugmentState;
let upgradePointsSinceAugment = 0;
let pendingAugmentOffers = 0;
let comboState: ComboState = { count: 0, lastMinedAt: null };
let cascadeCount = 0;

if (save) {
  world = World.generate(save.seed);
  applyDiff(world, save.changes);
  world.syncBossMap();
  if (save.exploredRuns.length > 0) {
    decodeExplored(save.exploredRuns, world.explored);
  } else if (save.changes.length > 0) {
    let idx = 0;
    for (let i = 0; i < save.changes.length; i += 2) {
      idx += save.changes[i];
      const cy = Math.floor(idx / WORLD_W);
      const cx = idx - cy * WORLD_W;
      world.reveal(cx, cy, 6);
    }
  }
  economy = {
    currency: save.currency,
    upgradePoints: save.upgradePoints,
    upgrades: save.upgrades,
    ballsOwned: save.ballsOwned as Record<BallType, number>,
  };
  stats = { ...save.stats };
  augmentState = { picked: save.augments, rngState: save.augmentRngState };
  upgradePointsSinceAugment = save.upgradePointsSinceAugment;
  pendingAugmentOffers = save.pendingAugmentOffers;
} else {
  world = World.generate(Date.now() >>> 0);
  economy = newEconomy();
  stats = { pixelsMined: 0, startedAt: Date.now(), won: false };
  augmentState = newAugmentState(world.seed);
}

const canvas = document.getElementById("game") as HTMLCanvasElement;
canvas.style.touchAction = "none";

function resize(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener("resize", resize);

const renderer = new Renderer(world, canvas);
world.onCellChanged = (x, y) => renderer.markDirty(x, y);
world.onCellDamaged = (x, y) => renderer.markDirty(x, y);

const physics = new Physics(world);

const spawnedCount: Record<BallType, number> = {} as Record<BallType, number>;
for (const t of BALL_ORDER) spawnedCount[t] = 0;

const uiRoot = document.getElementById("ui") as HTMLElement;
const ui = new UI(uiRoot, economy, world);
ui.pixelsMined = stats.pixelsMined;
ui.update();

const cam: Camera = { x: SPAWN_CAVITY_X, y: SPAWN_CAVITY_Y, zoom: 4 };

const keys = new Set<string>();
window.addEventListener("keydown", e => keys.add(e.key.toLowerCase()));
window.addEventListener("keyup", e => keys.delete(e.key.toLowerCase()));

let dragging = false;
let panPointerId: number | null = null;
let lastDragX = 0;
let lastDragY = 0;

interface AimState {
  active: boolean;
  pointerId: number | null;
  pull: Point;
  ballType: BallType | null;
}

interface AimPreviewRenderer {
  setAimPreview?: (points: Point[], pull: Point, ballType: BallType) => void;
  clearAimPreview?: () => void;
}

const aimRenderer = renderer as Renderer & AimPreviewRenderer;
const aimState: AimState = { active: false, pointerId: null, pull: { x: 0, y: 0 }, ballType: null };
const activePointers = new Map<number, { x: number; y: number; type: string }>();
let touchPan: { pointerId: number; x: number; y: number } | null = null;
let pinch: PinchState | null = null;

canvas.addEventListener("contextmenu", e => e.preventDefault());

function clearAim(): void {
  const pointerId = aimState.pointerId;
  aimState.active = false;
  aimState.pointerId = null;
  aimState.pull = { x: 0, y: 0 };
  aimState.ballType = null;
  aimRenderer.clearAimPreview?.();
  if (pointerId !== null && canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
}

function launcherWorldPoint(): Point {
  return { x: SPAWN_CAVITY_X, y: SPAWN_CAVITY_Y };
}

function pointerWorldPoint(clientX: number, clientY: number): Point {
  const [x, y] = screenToWorld(cam, canvas.width, canvas.height, clientX, clientY);
  return { x, y };
}

function isInLaunchZone(clientX: number, clientY: number): boolean {
  const pointer = pointerWorldPoint(clientX, clientY);
  const anchor = launcherWorldPoint();
  return Math.hypot(pointer.x - anchor.x, pointer.y - anchor.y) <= LAUNCH_ZONE_RADIUS;
}

function updateAim(clientX: number, clientY: number): void {
  if (!aimState.active) return;
  const pull = clampPull(launcherWorldPoint(), pointerWorldPoint(clientX, clientY), MAX_PULL);
  aimState.pull = pull;
  if (aimState.ballType) aimRenderer.setAimPreview?.(buildAimPreview(pull, aimState.ballType), pull, aimState.ballType);
}

function buildAimPreview(pull: Point, ballType: BallType): Point[] {
  const anchor = launcherWorldPoint();
  const pullLength = Math.hypot(pull.x, pull.y);
  if (pullLength === 0) return [anchor];
  const angle = Math.atan2(-pull.y, -pull.x);
  const speedMul = statMul(economy, "launchSpeed") * augmentMul(augmentState, "launchSpeed") *
    launchSpeedMul(pullLength, MAX_PULL, MIN_LAUNCH_SPEED, MAX_LAUNCH_SPEED);
  const abilitySpeed = buildAbilityStats().speedMul * (ballType === "purple" ? 0.6 : 1);
  let x = anchor.x;
  let y = anchor.y;
  let vx = Math.cos(angle) * PREVIEW_BASE_SPEED * speedMul;
  let vy = Math.sin(angle) * PREVIEW_BASE_SPEED * speedMul;
  const points: Point[] = [{ x, y }];
  for (let i = 0; i < PREVIEW_DOTS - 1; i++) {
    const nextX = x + vx * abilitySpeed * PREVIEW_DT;
    const nextY = y + vy * abilitySpeed * PREVIEW_DT;
    const hit = sweepGrid(x, y, nextX, nextY, (cellX, cellY) => world.isSolid(cellX, cellY), WORLD_W, WORLD_H);
    if (!hit) {
      x = nextX;
      y = nextY;
    } else {
      x += (nextX - x) * hit.t + hit.normalX * PREVIEW_EPSILON;
      y += (nextY - y) * hit.t + hit.normalY * PREVIEW_EPSILON;
      if (hit.normalX !== 0) vx = -vx;
      if (hit.normalY !== 0) vy = -vy;
    }
    points.push({ x, y });
  }
  return points;
}

function beginAim(pointerId: number, clientX: number, clientY: number): boolean {
  if (paused || !isInLaunchZone(clientX, clientY)) return false;
  const ballType = nextBallType(economy.ballsOwned, spawnedCount);
  if (!ballType) return false;
  aimState.active = true;
  aimState.pointerId = pointerId;
  aimState.pull = { x: 0, y: 0 };
  aimState.ballType = ballType;
  aimRenderer.setAimPreview?.(buildAimPreview(aimState.pull, ballType), aimState.pull, ballType);
  updateAim(clientX, clientY);
  return true;
}

function releaseAim(clientX: number, clientY: number): void {
  if (!aimState.active) return;
  updateAim(clientX, clientY);
  const pull = aimState.pull;
  const ballType = aimState.ballType;
  clearAim();
  if (!ballType || !shouldLaunch(Math.hypot(pull.x, pull.y), MIN_PULL) || paused) return;
  const angle = Math.atan2(-pull.y, -pull.x);
  const baseSpeedMul = statMul(economy, "launchSpeed") * augmentMul(augmentState, "launchSpeed");
  const pullSpeedMul = launchSpeedMul(Math.hypot(pull.x, pull.y), MAX_PULL, MIN_LAUNCH_SPEED, MAX_LAUNCH_SPEED);
  physics.spawn(ballType, SPAWN_CAVITY_X, SPAWN_CAVITY_Y, angle, baseSpeedMul * pullSpeedMul);
  spawnedCount[ballType]++;
}

function endPointerCapture(pointerId: number): void {
  if (canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
}

canvas.addEventListener("pointerdown", e => {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
  if (e.button === 2) {
    dragging = true;
    panPointerId = e.pointerId;
    lastDragX = e.clientX;
    lastDragY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (e.button !== 0) return;
  if (e.pointerType === "touch") {
    if (activePointers.size >= 2) {
      clearAim();
      touchPan = null;
      const touches = Array.from(activePointers.values());
      const [a, b] = touches;
      pinch = { dist: Math.hypot(b.x - a.x, b.y - a.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
      return;
    }
    if (!beginAim(e.pointerId, e.clientX, e.clientY)) touchPan = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
  } else {
    beginAim(e.pointerId, e.clientX, e.clientY);
  }
  if (aimState.active) canvas.setPointerCapture(e.pointerId);
});

window.addEventListener("mouseup", e => {
  if (e.button === 2) {
    dragging = false;
    panPointerId = null;
  }
});

canvas.addEventListener("pointermove", e => {
  const previous = activePointers.get(e.pointerId);
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
  if (dragging && panPointerId === e.pointerId) {
    const dx = e.clientX - lastDragX;
    const dy = e.clientY - lastDragY;
    lastDragX = e.clientX;
    lastDragY = e.clientY;
    cam.x -= dx / cam.zoom;
    cam.y -= dy / cam.zoom;
    return;
  }
  if (aimState.active && aimState.pointerId === e.pointerId) {
    updateAim(e.clientX, e.clientY);
    return;
  }
  if (e.pointerType !== "touch") return;
  if (activePointers.size >= 2) {
    const touches = Array.from(activePointers.values());
    const [a, b] = touches;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    if (pinch && pinch.dist > 0) applyPinchZoom(midX, midY, dist / pinch.dist);
    pinch = { dist, midX, midY };
    return;
  }
  if (touchPan?.pointerId === e.pointerId && previous) {
    const dx = e.clientX - previous.x;
    const dy = e.clientY - previous.y;
    if (Math.hypot(dx, dy) > TOUCH_DRAG_THRESHOLD || touchPan.x !== previous.x || touchPan.y !== previous.y) {
      cam.x -= dx / cam.zoom;
      cam.y -= dy / cam.zoom;
    }
  }
});

function finishPointer(e: PointerEvent, cancelled: boolean): void {
  if (e.button === 2 || panPointerId === e.pointerId) {
    dragging = false;
    panPointerId = null;
  }
  const wasAim = aimState.active && aimState.pointerId === e.pointerId;
  if (wasAim) {
    if (cancelled) clearAim();
    else releaseAim(e.clientX, e.clientY);
    endPointerCapture(e.pointerId);
  }
  activePointers.delete(e.pointerId);
  if (activePointers.size < 2) pinch = null;
  if (touchPan?.pointerId === e.pointerId) touchPan = null;
}

canvas.addEventListener("pointerup", e => finishPointer(e, false));
canvas.addEventListener("pointercancel", e => finishPointer(e, true));
canvas.addEventListener("lostpointercapture", e => {
  if (aimState.pointerId === e.pointerId) clearAim();
});

window.addEventListener("keydown", e => {
  if (e.key === "Escape") clearAim();
});

canvas.addEventListener(
  "wheel",
  e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const [wx, wy] = screenToWorld(cam, canvas.width, canvas.height, e.clientX, e.clientY);
    const newZoom = Math.min(24, Math.max(0.5, cam.zoom * factor));
    cam.zoom = newZoom;
    cam.x = wx - (e.clientX - canvas.width / 2) / newZoom;
    cam.y = wy - (e.clientY - canvas.height / 2) / newZoom;
  },
  { passive: false }
);

interface PinchState {
  dist: number;
  midX: number;
  midY: number;
}

function applyPinchZoom(midX: number, midY: number, factor: number): void {
  const [wx, wy] = screenToWorld(cam, canvas.width, canvas.height, midX, midY);
  const newZoom = Math.min(PINCH_ZOOM_MAX, Math.max(PINCH_ZOOM_MIN, cam.zoom * factor));
  cam.zoom = newZoom;
  cam.x = wx - (midX - canvas.width / 2) / newZoom;
  cam.y = wy - (midY - canvas.height / 2) / newZoom;
}

function updateCameraPan(dt: number): void {
  const speed = 400 / cam.zoom;
  let dx = 0;
  let dy = 0;
  if (keys.has("w") || keys.has("arrowup")) dy -= 1;
  if (keys.has("s") || keys.has("arrowdown")) dy += 1;
  if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
  if (keys.has("d") || keys.has("arrowright")) dx += 1;
  if (dx === 0 && dy === 0) return;
  const len = Math.hypot(dx, dy);
  cam.x += (dx / len) * speed * dt;
  cam.y += (dy / len) * speed * dt;
}

let uiDirty = false;
let augmentOfferOpen = false;
let paused = false;

function addUpgradePoints(n: number): void {
  economy.upgradePoints += n;
  upgradePointsSinceAugment += n;
  while (upgradePointsSinceAugment >= AUGMENT_MILESTONE) {
    upgradePointsSinceAugment -= AUGMENT_MILESTONE;
    pendingAugmentOffers++;
  }
}

function showNextAugmentOffer(): void {
  if (augmentOfferOpen || pendingAugmentOffers <= 0) return;
  const defs = rollChoices(augmentState, 3);
  if (defs.length === 0) {
    pendingAugmentOffers--;
    showNextAugmentOffer();
    return;
  }
  augmentOfferOpen = true;
  paused = true;
  clearAim();
  try {
    ui.showAugmentChoice(defs);
  } catch (err) {
    console.error(err);
    augmentOfferOpen = false;
    paused = false;
  }
}

function onMined(cell: number, x: number, y: number): void {
  const previousCombo = comboState.count;
  comboState = advanceCombo(comboState, 1, performance.now());
  ui.showCombo(comboState.count, cascadeCount);
  const revealRadius = 6 + 2 * abilityLevel(economy, "revealRadius") + augmentBonus(augmentState, "revealRadius");
  world.reveal(x, y, revealRadius);
  economy.currency += Math.ceil(pixelValue(cell) * biomeValueMul(biomeAt(x, y, world.seed)) * augmentMul(augmentState, "pixelValueMul"));
  stats.pixelsMined++;
  renderer.addBurst(x + 0.5, y + 0.5, cellColor(cell, x, y, world.seed));
  if (cell === CELL.UPGRADE) addUpgradePoints(1);

  if (cell === CELL.TREASURE) {
    const amount = Math.ceil(100 * (1 + 2 * world.edgeAt(x, y)) * augmentMul(augmentState, "treasureMul"));
    economy.currency += amount;
    const [sx, sy] = worldToScreen(cam, canvas.width, canvas.height, x, y);
    ui.showPopup?.("+" + amount, sx, sy);
  }

  if (cell === CELL.BOSS) {
    const bossId = world.registerBossCellMined(x, y);
    if (bossId !== -1) {
      const amount = Math.ceil(2000 * (1 + world.edgeAt(x, y)) * augmentMul(augmentState, "bossMul"));
      economy.currency += amount;
      addUpgradePoints(3);
      pendingAugmentOffers++;
      for (let dy = -6; dy <= 6; dy++) {
        for (let dx = -6; dx <= 6; dx++) {
          const cx = x + dx;
          const cy = y + dy;
          if (world.get(cx, cy) > 0) {
            const destroyed = world.hit(cx, cy, 999);
            if (destroyed) onMined(destroyed, cx, cy);
          }
        }
      }
      for (let i = 0; i < 6; i++) {
        renderer.addBurst(x, y, "#c13bff");
      }
      const [sx, sy] = worldToScreen(cam, canvas.width, canvas.height, x, y);
      ui.showPopup?.("BOSS DOWN +" + amount, sx, sy);
    }
  }

  if (cell === CELL.GOLD && !stats.won) {
    stats.won = true;
    ui.showWin({
      pixelsMined: stats.pixelsMined,
      seconds: (Date.now() - stats.startedAt) / 1000,
      ballCount: Object.values(economy.ballsOwned).reduce((a, b) => a + b, 0),
    });
  }
  uiDirty = true;
  showNextAugmentOffer();
}

function onImpact(context: { x: number; y: number; cell: number; ballType: BallType; destroyed: boolean }): void {
  const impactColor = context.destroyed ? cellColor(context.cell, context.x, context.y, world.seed) : "#fff";
  renderer.addImpact(context.x + 0.5, context.y + 0.5, impactColor, context.destroyed ? 1 : 0.5);
  if (!context.destroyed || ![CELL.SOFT, CELL.MED, CELL.HARD].includes(context.cell)) return;

  const before = new Map<string, number>();
  for (let y = context.y - FRACTURE_MAX_DEPTH; y <= context.y + FRACTURE_MAX_DEPTH; y++) {
    for (let x = context.x - FRACTURE_MAX_DEPTH; x <= context.x + FRACTURE_MAX_DEPTH; x++) {
      before.set(`${x},${y}`, world.get(x, y));
    }
  }
  const result = resolveFracture(world, context.x, context.y, 1, world.seed ^ (context.x * 73856093) ^ (context.y * 19349663));
  for (const cell of result.processed) {
    if (world.get(cell.x, cell.y) !== CELL.EMPTY) continue;
    const minedCell = before.get(`${cell.x},${cell.y}`) ?? CELL.EMPTY;
    if (minedCell === CELL.EMPTY) continue;
    onMined(minedCell, cell.x, cell.y);
    cascadeCount++;
    renderer.addImpact(cell.x + 0.5, cell.y + 0.5, cellColor(minedCell, cell.x, cell.y, world.seed), 0.8, cell.depth);
  }
  ui.showCombo(comboState.count, cascadeCount);
}

let moltenBurstsThisFrame = 0;
const MOLTEN_BURST_CAP = 24;

function onMoltenHit(x: number, y: number): void {
  if (moltenBurstsThisFrame >= MOLTEN_BURST_CAP) return;
  moltenBurstsThisFrame++;
  renderer.addBurst(x + 0.5, y + 0.5, "#f63");
}

function buildAbilityStats(): AbilityStats {
  return {
    speedMul: statMul(economy, "speed") * augmentMul(augmentState, "speed"),
    dmgMul: statMul(economy, "damage") * augmentMul(augmentState, "damage"),
    smashRadius: 1 + abilityLevel(economy, "smashRadius") + augmentBonus(augmentState, "smashRadius"),
    poisonSpread: 1 + abilityLevel(economy, "poisonSpread") + augmentBonus(augmentState, "poisonSpread"),
    splitCount: 1 + abilityLevel(economy, "splitCount") + augmentBonus(augmentState, "splitCount"),
    pierceDepth: 1 + abilityLevel(economy, "pierceDepth") + augmentBonus(augmentState, "pierceDepth"),
    darkSpeedMul: statMul(economy, "darkSpeed"),
  };
}

let savingDisabled = false;

function doSave(): void {
  if (savingDisabled) return;
  const data: SaveData = {
    version: 3,
    seed: world.seed,
    changes: diffWorld(world),
    currency: economy.currency,
    upgradePoints: economy.upgradePoints,
    upgrades: economy.upgrades,
    ballsOwned: economy.ballsOwned,
    stats,
    exploredRuns: encodeExplored(world.explored),
    augments: augmentState.picked,
    augmentRngState: augmentState.rngState,
    upgradePointsSinceAugment: upgradePointsSinceAugment,
    pendingAugmentOffers: pendingAugmentOffers,
  };
  saveGame(data);
}

setInterval(doSave, AUTOSAVE_MS);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) doSave();
});
window.addEventListener("beforeunload", doSave);

ui.onNewRun = () => {
  savingDisabled = true;
  clearSave();
  location.reload();
};

ui.onPickAugment = (id) => {
  pickAugment(augmentState, id);
  augmentOfferOpen = false;
  paused = false;
  pendingAugmentOffers--;
  requestAnimationFrame(showNextAugmentOffer);
};

function showErrorOverlay(): void {
  const div = document.createElement("div");
  div.textContent = "Error — reload page";
  div.style.position = "fixed";
  div.style.inset = "0";
  div.style.display = "flex";
  div.style.alignItems = "center";
  div.style.justifyContent = "center";
  div.style.background = "rgba(0, 0, 0, 0.9)";
  div.style.color = "#f55";
  div.style.fontFamily = "monospace";
  div.style.fontSize = "24px";
  div.style.zIndex = "1000";
  document.body.appendChild(div);
}

(window as unknown as { __game: unknown }).__game = { economy, physics, world };

let last = performance.now();
let acc = 0;
let errorCount = 0;
let radarAcc = 0;

function updateRadar(dt: number): void {
  radarAcc += dt;
  if (radarAcc < RADAR_INTERVAL_S) return;
  radarAcc -= RADAR_INTERVAL_S;
  if (abilityLevel(economy, "radar") <= 0) return;
  if (world.goldenIndex < 0) return;
  const gx = world.goldenIndex % WORLD_W;
  const gy = Math.floor(world.goldenIndex / WORLD_W);
  const angle = Math.atan2(gy - cam.y, gx - cam.x);
  const distance = Math.hypot(gx - cam.x, gy - cam.y);
  ui.updateRadar?.(angle, distance);
}

function frame(now: number): void {
  try {
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(dt, 0.25);

    moltenBurstsThisFrame = 0;
    const previousCombo = comboState.count;
    comboState = advanceCombo(comboState, 0, now);
    if (comboState.count === 0 && previousCombo !== 0) {
      cascadeCount = 0;
      ui.showCombo(0, 0);
    }

    if (!paused) {
      acc += dt;

      const abilityStats = buildAbilityStats();
      let steps = 0;
      while (acc >= SIM_DT && steps < MAX_SIM_STEPS) {
        physics.step(SIM_DT, abilityStats, onMined, onMoltenHit, onImpact);
        acc -= SIM_DT;
        steps++;
      }
      if (steps >= MAX_SIM_STEPS) {
        acc = Math.min(acc, SIM_DT * MAX_SIM_STEPS);
      }

      updateCameraPan(dt);
      updateRadar(dt);
    }

    renderer.showTreasurePulse = abilityLevel(economy, "treasureHunter") > 0;
    ui.treasurePings = abilityLevel(economy, "treasureHunter") > 0;
    renderer.draw(cam, physics.balls, dt);
    ui.drawMinimap(cam);
    if (uiDirty) {
      ui.pixelsMined = stats.pixelsMined;
      ui.update();
      uiDirty = false;
    }

    errorCount = 0;
  } catch (err) {
    console.error(err);
    errorCount++;
    if (errorCount >= 3) {
      showErrorOverlay();
      return;
    }
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
