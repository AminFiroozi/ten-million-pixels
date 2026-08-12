import { EconomyState, BallType, BALL_ORDER, buyBall, buyUpgrade, isUnlocked, nextBallCost, UPGRADE_TREE, UpgradeNode, statMul } from "./economy";
import { World, CELL } from "./world";
import { Camera, BALL_COLORS } from "./render";
import "./style.css";

const MINIMAP_W = 160;
const MINIMAP_H = 100;
const MINIMAP_SAMPLE = 8;
const MINIMAP_REFRESH_MS = 500;

interface WinStats {
  pixelsMined: number;
  seconds: number;
  ballCount: number;
}

interface ShopRow {
  button: HTMLButtonElement;
  label: HTMLElement;
  status: HTMLElement;
}

function ballName(t: BallType): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function nodeBallType(node: UpgradeNode): BallType | undefined {
  if (node.unlocksBall) return node.unlocksBall;
  if (node.requires && node.requires.startsWith("unlock_")) {
    return node.requires.slice("unlock_".length) as BallType;
  }
  return undefined;
}

function nodeColor(node: UpgradeNode): string {
  const t = nodeBallType(node);
  return t ? BALL_COLORS[t] : "#7dff9a";
}

function nodeAbbrev(node: UpgradeNode): string {
  return node.name
    .split(" ")
    .map(w => w.charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, 3);
}

function minimapColor(cell: number): [number, number, number] {
  switch (cell) {
    case CELL.SOFT:
      return [70, 210, 100];
    case CELL.MED:
      return [40, 120, 60];
    case CELL.HARD:
      return [95, 95, 85];
    case CELL.UPGRADE:
      return [255, 251, 224];
    case CELL.GOLD:
      return [255, 215, 0];
    case CELL.OBJECT:
      return [255, 255, 255];
    default:
      return [5, 10, 6];
  }
}

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export class UI {
  private economy: EconomyState;
  private world: World;

  onBuyBall?: (t: BallType) => void;
  onNewRun?: () => void;
  pixelsMined = 0;

  private currencyEl: HTMLElement;
  private upgradePointsEl: HTMLElement;
  private pixelsMinedEl: HTMLElement;

  private shopRows: Map<BallType, ShopRow>;

  private upgradePanel: HTMLElement;
  private upgradeButtons: Map<string, HTMLButtonElement>;
  private tooltip: HTMLElement;

  private minimapCanvas: HTMLCanvasElement;
  private minimapCtx: CanvasRenderingContext2D;
  private minimapCache: ImageData | null;
  private minimapCacheTime: number;

  private winOverlay: HTMLElement;

  constructor(root: HTMLElement, economy: EconomyState, world: World) {
    this.economy = economy;
    this.world = world;
    this.shopRows = new Map();
    this.upgradeButtons = new Map();
    this.minimapCache = null;
    this.minimapCacheTime = -Infinity;

    const hud = document.createElement("div");
    hud.className = "hud-topleft";
    this.currencyEl = document.createElement("div");
    this.currencyEl.className = "hud-currency";
    this.upgradePointsEl = document.createElement("div");
    this.upgradePointsEl.className = "hud-sub";
    this.pixelsMinedEl = document.createElement("div");
    this.pixelsMinedEl.className = "hud-sub";
    hud.appendChild(this.currencyEl);
    hud.appendChild(this.upgradePointsEl);
    hud.appendChild(this.pixelsMinedEl);
    root.appendChild(hud);

    const shopBar = document.createElement("div");
    shopBar.className = "shop-bar";
    for (const t of BALL_ORDER) {
      const button = document.createElement("button");
      button.className = "shop-btn";
      button.style.setProperty("--ball-color", BALL_COLORS[t]);

      const dot = document.createElement("span");
      dot.className = "shop-dot";

      const label = document.createElement("div");
      label.className = "shop-label";
      label.appendChild(dot);
      const nameEl = document.createElement("span");
      nameEl.textContent = ballName(t);
      label.appendChild(nameEl);

      const status = document.createElement("div");
      status.className = "shop-status";

      button.appendChild(label);
      button.appendChild(status);
      button.addEventListener("click", () => {
        if (buyBall(this.economy, t)) {
          this.onBuyBall?.(t);
          this.update();
        }
      });

      shopBar.appendChild(button);
      this.shopRows.set(t, { button, label, status });
    }
    root.appendChild(shopBar);

    const upgradeTab = document.createElement("button");
    upgradeTab.className = "upgrade-tab";
    upgradeTab.textContent = "UPGRADES [U]";
    upgradeTab.addEventListener("click", () => this.toggleUpgradePanel());
    root.appendChild(upgradeTab);

    this.upgradePanel = document.createElement("div");
    this.upgradePanel.className = "upgrade-panel hidden";
    for (const node of UPGRADE_TREE) {
      const btn = document.createElement("button");
      btn.className = "upgrade-node";
      btn.style.setProperty("--node-color", nodeColor(node));
      btn.title = node.desc;

      const abbrev = document.createElement("div");
      abbrev.className = "upgrade-node-abbrev";
      abbrev.textContent = nodeAbbrev(node);

      const level = document.createElement("div");
      level.className = "upgrade-node-level";

      btn.appendChild(abbrev);
      btn.appendChild(level);

      btn.addEventListener("mouseenter", () => this.showTooltip(btn, node));
      btn.addEventListener("mouseleave", () => this.hideTooltip());
      btn.addEventListener("click", () => {
        if (buyUpgrade(this.economy, node.id)) {
          this.update();
          this.showTooltip(btn, node);
        }
      });

      this.upgradePanel.appendChild(btn);
      this.upgradeButtons.set(node.id, btn);
    }
    root.appendChild(this.upgradePanel);

    this.tooltip = document.createElement("div");
    this.tooltip.className = "upgrade-tooltip hidden";
    root.appendChild(this.tooltip);

    window.addEventListener("keydown", e => {
      if (e.key === "u" || e.key === "U") this.toggleUpgradePanel();
    });

    const minimapWrap = document.createElement("div");
    minimapWrap.className = "minimap-wrap";
    this.minimapCanvas = document.createElement("canvas");
    this.minimapCanvas.width = MINIMAP_W;
    this.minimapCanvas.height = MINIMAP_H;
    const ctx = this.minimapCanvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.minimapCtx = ctx;
    minimapWrap.appendChild(this.minimapCanvas);
    root.appendChild(minimapWrap);

    this.winOverlay = document.createElement("div");
    this.winOverlay.className = "win-overlay hidden";
    root.appendChild(this.winOverlay);

    this.update();
  }

  private toggleUpgradePanel(): void {
    this.upgradePanel.classList.toggle("hidden");
    this.hideTooltip();
  }

  private showTooltip(anchor: HTMLElement, node: UpgradeNode): void {
    const level = this.economy.upgrades[node.id] ?? 0;
    const lines = [node.name, node.desc, `Cost: ${node.cost} | Level: ${level}/${node.max}`];
    if (node.stat === "speed" || node.stat === "damage") {
      lines.push(`Current mult: x${statMul(this.economy, node.stat).toFixed(2)}`);
    }
    this.tooltip.textContent = lines.join("\n");
    const rect = anchor.getBoundingClientRect();
    this.tooltip.style.left = `${rect.left}px`;
    this.tooltip.style.top = `${rect.bottom + 4}px`;
    this.tooltip.classList.remove("hidden");
  }

  private hideTooltip(): void {
    this.tooltip.classList.add("hidden");
  }

  update(): void {
    this.currencyEl.textContent = `${Math.floor(this.economy.currency)}`;
    this.upgradePointsEl.textContent = `Upgrade Points: ${this.economy.upgradePoints}`;
    this.pixelsMinedEl.textContent = `Pixels Mined: ${this.pixelsMined}`;

    for (const t of BALL_ORDER) {
      const row = this.shopRows.get(t);
      if (!row) continue;
      const unlocked = isUnlocked(this.economy, t);
      if (!unlocked) {
        row.status.textContent = "[LOCKED]";
        row.button.disabled = true;
        continue;
      }
      const owned = this.economy.ballsOwned[t];
      const cost = nextBallCost(this.economy, t);
      row.status.textContent = `Owned: ${owned} | Cost: ${cost}`;
      row.button.disabled = this.economy.currency < cost;
    }

    for (const node of UPGRADE_TREE) {
      const btn = this.upgradeButtons.get(node.id);
      if (!btn) continue;
      const level = this.economy.upgrades[node.id] ?? 0;
      const levelEl = btn.querySelector(".upgrade-node-level");
      if (levelEl) levelEl.textContent = `${level}/${node.max}`;
      const requiresMet = !node.requires || (this.economy.upgrades[node.requires] ?? 0) > 0;
      const affordable = this.economy.upgradePoints >= node.cost;
      btn.disabled = level >= node.max || !requiresMet || !affordable;
    }
  }

  drawMinimap(cam: Camera): void {
    const now = performance.now();
    if (!this.minimapCache || now - this.minimapCacheTime >= MINIMAP_REFRESH_MS) {
      this.minimapCache = this.buildMinimapImage();
      this.minimapCacheTime = now;
    }
    this.minimapCtx.putImageData(this.minimapCache, 0, 0);

    const viewWorldW = window.innerWidth / cam.zoom;
    const viewWorldH = window.innerHeight / cam.zoom;
    const worldW = MINIMAP_W * MINIMAP_SAMPLE;
    const worldH = MINIMAP_H * MINIMAP_SAMPLE;
    const sx = MINIMAP_W / worldW;
    const sy = MINIMAP_H / worldH;

    const rectX = (cam.x - viewWorldW / 2) * sx;
    const rectY = (cam.y - viewWorldH / 2) * sy;
    const rectW = viewWorldW * sx;
    const rectH = viewWorldH * sy;

    const ctx = this.minimapCtx;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.strokeRect(rectX + 0.5, rectY + 0.5, rectW, rectH);
  }

  private buildMinimapImage(): ImageData {
    const image = new ImageData(MINIMAP_W, MINIMAP_H);
    const data = image.data;
    for (let y = 0; y < MINIMAP_H; y++) {
      for (let x = 0; x < MINIMAP_W; x++) {
        const cell = this.world.get(x * MINIMAP_SAMPLE, y * MINIMAP_SAMPLE);
        const [r, g, b] = minimapColor(cell);
        const i = (y * MINIMAP_W + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
    return image;
  }

  showPopup(text: string, x: number, y: number): void {}

  updateRadar(angle: number, distance: number): void {}

  showWin(stats: WinStats): void {
    this.winOverlay.textContent = "";

    const panel = document.createElement("div");
    panel.className = "win-panel";

    const title = document.createElement("div");
    title.className = "win-title";
    title.textContent = "GOLDEN PIXEL FOUND";
    panel.appendChild(title);

    const lines = [
      `Pixels Mined: ${stats.pixelsMined}`,
      `Time: ${formatTime(stats.seconds)}`,
      `Balls: ${stats.ballCount}`,
    ];
    for (const line of lines) {
      const el = document.createElement("div");
      el.className = "win-stat";
      el.textContent = line;
      panel.appendChild(el);
    }

    const buttonRow = document.createElement("div");
    buttonRow.className = "win-buttons";

    const continueBtn = document.createElement("button");
    continueBtn.className = "win-btn";
    continueBtn.textContent = "Continue";
    continueBtn.addEventListener("click", () => {
      this.winOverlay.classList.add("hidden");
    });

    const newRunBtn = document.createElement("button");
    newRunBtn.className = "win-btn";
    newRunBtn.textContent = "New Run";
    newRunBtn.addEventListener("click", () => {
      this.onNewRun?.();
    });

    buttonRow.appendChild(continueBtn);
    buttonRow.appendChild(newRunBtn);
    panel.appendChild(buttonRow);

    this.winOverlay.appendChild(panel);
    this.winOverlay.classList.remove("hidden");
  }
}
