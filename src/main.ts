import { World, CELL, WORLD_W } from "./world";
import { SaveData, diffWorld, applyDiff, saveGame, loadGame, clearSave, normalizeSave, encodeExplored, decodeExplored } from "./save";
import { EconomyState, BallType, BALL_ORDER, newEconomy, pixelValue, statMul, abilityLevel } from "./economy";
import { biomeAt, biomeValueMul } from "./biomes";
import { Physics, AbilityStats } from "./physics";
import { Renderer, Camera, screenToWorld, worldToScreen, cellColor } from "./render";
import { UI } from "./ui";
import { AugmentState, newAugmentState, augmentMul, augmentBonus, pickAugment, rollChoices } from "./augments";
import { resolveFracture, FRACTURE_MAX_DEPTH } from "./erosion";
import { advanceCombo, type ComboState } from "./combo";

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
let lastDragX = 0;
let lastDragY = 0;

canvas.addEventListener("contextmenu", e => e.preventDefault());

canvas.addEventListener("mousedown", e => {
  if (e.button === 2) {
    dragging = true;
    lastDragX = e.clientX;
    lastDragY = e.clientY;
  } else if (e.button === 0) {
    spawnWaveAt(e.clientX, e.clientY);
  }
});

window.addEventListener("mousemove", e => {
  if (!dragging) return;
  const dx = e.clientX - lastDragX;
  const dy = e.clientY - lastDragY;
  lastDragX = e.clientX;
  lastDragY = e.clientY;
  cam.x -= dx / cam.zoom;
  cam.y -= dy / cam.zoom;
});

window.addEventListener("mouseup", e => {
  if (e.button === 2) dragging = false;
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

function spawnWaveAt(clientX: number, clientY: number): void {
  if (paused) return;
  const [tx, ty] = screenToWorld(cam, canvas.width, canvas.height, clientX, clientY);
  const baseAngle = Math.atan2(ty - SPAWN_CAVITY_Y, tx - SPAWN_CAVITY_X);
  const launchSpeedMul = statMul(economy, "launchSpeed") * augmentMul(augmentState, "launchSpeed");
  let remaining = 20 + 10 * abilityLevel(economy, "launchWave") + augmentBonus(augmentState, "launchWave");
  for (const t of BALL_ORDER) {
    if (remaining <= 0) break;
    const owned = economy.ballsOwned[t];
    const already = spawnedCount[t];
    const toSpawn = Math.min(remaining, owned - already);
    if (toSpawn <= 0) continue;
    for (let i = 0; i < toSpawn; i++) {
      const angle = baseAngle + (Math.random() * 0.3 - 0.15);
      physics.spawn(t, SPAWN_CAVITY_X, SPAWN_CAVITY_Y, angle, launchSpeedMul);
    }
    spawnedCount[t] = already + toSpawn;
    remaining -= toSpawn;
  }
}

interface TouchTap {
  x: number;
  y: number;
  time: number;
  dragged: boolean;
}

interface PinchState {
  dist: number;
  midX: number;
  midY: number;
}

let touchTap: TouchTap | null = null;
let pinch: PinchState | null = null;

function touchDistance(a: Touch, b: Touch): number {
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

function touchMidpoint(a: Touch, b: Touch): [number, number] {
  return [(a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2];
}

function applyPinchZoom(midX: number, midY: number, factor: number): void {
  const [wx, wy] = screenToWorld(cam, canvas.width, canvas.height, midX, midY);
  const newZoom = Math.min(PINCH_ZOOM_MAX, Math.max(PINCH_ZOOM_MIN, cam.zoom * factor));
  cam.zoom = newZoom;
  cam.x = wx - (midX - canvas.width / 2) / newZoom;
  cam.y = wy - (midY - canvas.height / 2) / newZoom;
}

canvas.addEventListener(
  "touchstart",
  e => {
    e.preventDefault();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchTap = { x: t.clientX, y: t.clientY, time: performance.now(), dragged: false };
      pinch = null;
    } else if (e.touches.length === 2) {
      touchTap = null;
      const [dist, [midX, midY]] = [touchDistance(e.touches[0], e.touches[1]), touchMidpoint(e.touches[0], e.touches[1])];
      pinch = { dist, midX, midY };
    }
  },
  { passive: false }
);

canvas.addEventListener(
  "touchmove",
  e => {
    e.preventDefault();
    if (e.touches.length === 2) {
      const dist = touchDistance(e.touches[0], e.touches[1]);
      const [midX, midY] = touchMidpoint(e.touches[0], e.touches[1]);
      if (pinch) {
        applyPinchZoom(midX, midY, dist / pinch.dist);
      }
      pinch = { dist, midX, midY };
      touchTap = null;
      return;
    }
    if (e.touches.length === 1 && touchTap) {
      const t = e.touches[0];
      const dx = t.clientX - touchTap.x;
      const dy = t.clientY - touchTap.y;
      if (touchTap.dragged || Math.hypot(dx, dy) > TOUCH_DRAG_THRESHOLD) {
        touchTap.dragged = true;
        cam.x -= dx / cam.zoom;
        cam.y -= dy / cam.zoom;
        touchTap.x = t.clientX;
        touchTap.y = t.clientY;
      }
    }
  },
  { passive: false }
);

canvas.addEventListener(
  "touchend",
  e => {
    e.preventDefault();
    if (touchTap && !touchTap.dragged && e.touches.length === 0) {
      spawnWaveAt(touchTap.x, touchTap.y);
    }
    if (e.touches.length === 0) {
      touchTap = null;
      pinch = null;
    } else if (e.touches.length === 1) {
      const t = e.touches[0];
      touchTap = { x: t.clientX, y: t.clientY, time: performance.now(), dragged: false };
      pinch = null;
    }
  },
  { passive: false }
);

canvas.addEventListener(
  "touchcancel",
  e => {
    e.preventDefault();
    touchTap = null;
    pinch = null;
  },
  { passive: false }
);

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
