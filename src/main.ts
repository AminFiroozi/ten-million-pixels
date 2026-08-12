import { World, CELL } from "./world";
import { SaveData, diffWorld, applyDiff, saveGame, loadGame, clearSave, normalizeSave, encodeExplored } from "./save";
import { EconomyState, BallType, BALL_ORDER, newEconomy, pixelValue, statMul, abilityLevel } from "./economy";
import { Physics, AbilityStats } from "./physics";
import { Renderer, Camera, screenToWorld, cellColor } from "./render";
import { UI } from "./ui";

const SIM_DT = 1 / 120;
const MAX_SIM_STEPS = 5;
const SPAWN_CAVITY_X = 640;
const SPAWN_CAVITY_Y = 400;
const AUTOSAVE_MS = 10000;

const rawSave = loadGame();
const save = rawSave ? normalizeSave(rawSave) : null;

let world: World;
let economy: EconomyState;
let stats: { pixelsMined: number; startedAt: number; won: boolean };

if (save) {
  world = World.generate(save.seed);
  applyDiff(world, save.changes);
  economy = {
    currency: save.currency,
    upgradePoints: save.upgradePoints,
    upgrades: save.upgrades,
    ballsOwned: save.ballsOwned as Record<BallType, number>,
  };
  stats = { ...save.stats };
} else {
  world = World.generate(Date.now() >>> 0);
  economy = newEconomy();
  stats = { pixelsMined: 0, startedAt: Date.now(), won: false };
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
  const [tx, ty] = screenToWorld(cam, canvas.width, canvas.height, clientX, clientY);
  const baseAngle = Math.atan2(ty - SPAWN_CAVITY_Y, tx - SPAWN_CAVITY_X);
  let remaining = 20;
  for (const t of BALL_ORDER) {
    if (remaining <= 0) break;
    const owned = economy.ballsOwned[t];
    const already = spawnedCount[t];
    const toSpawn = Math.min(remaining, owned - already);
    if (toSpawn <= 0) continue;
    for (let i = 0; i < toSpawn; i++) {
      const angle = baseAngle + (Math.random() * 0.3 - 0.15);
      physics.spawn(t, SPAWN_CAVITY_X, SPAWN_CAVITY_Y, angle);
    }
    spawnedCount[t] = already + toSpawn;
    remaining -= toSpawn;
  }
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

function onMined(cell: number, x: number, y: number): void {
  economy.currency += pixelValue(cell);
  stats.pixelsMined++;
  renderer.addBurst(x + 0.5, y + 0.5, cellColor(cell, x, y, world.seed));
  if (cell === CELL.UPGRADE) economy.upgradePoints++;
  if (cell === CELL.GOLD && !stats.won) {
    stats.won = true;
    ui.showWin({
      pixelsMined: stats.pixelsMined,
      seconds: (Date.now() - stats.startedAt) / 1000,
      ballCount: Object.values(economy.ballsOwned).reduce((a, b) => a + b, 0),
    });
  }
  uiDirty = true;
}

function buildAbilityStats(): AbilityStats {
  return {
    speedMul: statMul(economy, "speed"),
    dmgMul: statMul(economy, "damage"),
    smashRadius: 1 + abilityLevel(economy, "smashRadius"),
    poisonSpread: 1 + abilityLevel(economy, "poisonSpread"),
    splitCount: 1 + abilityLevel(economy, "splitCount"),
    pierceDepth: 1 + abilityLevel(economy, "pierceDepth"),
    moltenImmune: false,
    darkSpeedMul: 1,
  };
}

let savingDisabled = false;

function doSave(): void {
  if (savingDisabled) return;
  const data: SaveData = {
    version: 2,
    seed: world.seed,
    changes: diffWorld(world),
    currency: economy.currency,
    upgradePoints: economy.upgradePoints,
    upgrades: economy.upgrades,
    ballsOwned: economy.ballsOwned,
    stats,
    exploredRuns: encodeExplored(world.explored),
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

function frame(now: number): void {
  try {
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(dt, 0.25);
    acc += dt;

    const abilityStats = buildAbilityStats();
    let steps = 0;
    while (acc >= SIM_DT && steps < MAX_SIM_STEPS) {
      physics.step(SIM_DT, abilityStats, onMined);
      acc -= SIM_DT;
      steps++;
    }
    if (steps >= MAX_SIM_STEPS) {
      acc = Math.min(acc, SIM_DT * MAX_SIM_STEPS);
    }

    updateCameraPan(dt);
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
