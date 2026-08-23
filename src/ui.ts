import {
  EconomyState,
  BallType,
  BALL_ORDER,
  buyBall,
  buyUpgrade,
  isUnlocked,
  nextBallCost,
  UPGRADE_TREE,
  UpgradeNode,
  NODE_LAYOUT,
  statMul,
} from "./economy";
import { World, CELL } from "./world";
import { Camera, BALL_COLORS } from "./render";
import { AugmentDef } from "./augments";
import "./style.css";

const MINIMAP_W = 160;
const MINIMAP_H = 100;
const MINIMAP_SAMPLE = 8;
const MINIMAP_REFRESH_MS = 500;

const SKILL_TREE_COL_W = 100;
const SKILL_TREE_ROW_H = 64;
const NODE_PAD = 12;
const NODE_W = 80;
const NODE_H = 44;
const NODE_LABEL_CHARS = 12;

const LAUNCHER_COLOR = "#8cf";
const DISCOVERY_COLOR = "#6ec6ff";
const SURVIVAL_COLOR = "#ff8a5c";
const NEUTRAL_COLOR = "#888";

const NEW_RUN_CONFIRM_MS = 5000;
const POPUP_LIFETIME_MS = 1200;
const POPUP_MAX = 20;
const RADAR_PULSE_MS = 300;
const TOUCH_TAP_WINDOW_MS = 3000;

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
  const layout = NODE_LAYOUT[node.id];
  const branch = layout?.branch;
  if (branch === "launcher") return LAUNCHER_COLOR;
  if (branch === "discovery") return DISCOVERY_COLOR;
  if (branch === "survival") return SURVIVAL_COLOR;
  const t = nodeBallType(node);
  return t ? BALL_COLORS[t] : NEUTRAL_COLOR;
}

function nodeShortLabel(node: UpgradeNode): string {
  return node.name.slice(0, NODE_LABEL_CHARS);
}

function nodeCenter(layout: { col: number; row: number }): [number, number] {
  return [layout.col * SKILL_TREE_COL_W + NODE_PAD + NODE_W / 2, layout.row * SKILL_TREE_ROW_H + NODE_PAD + NODE_H / 2];
}

function computeTreeSize(): [number, number] {
  let maxCol = 0;
  let maxRow = 0;
  for (const id in NODE_LAYOUT) {
    const l = NODE_LAYOUT[id];
    if (l.col > maxCol) maxCol = l.col;
    if (l.row > maxRow) maxRow = l.row;
  }
  const w = Math.max(640, (maxCol + 1) * SKILL_TREE_COL_W + NODE_PAD * 2);
  const h = Math.max(480, (maxRow + 1) * SKILL_TREE_ROW_H + NODE_PAD * 2);
  return [w, h];
}

const [SKILL_TREE_W, SKILL_TREE_H] = computeTreeSize();

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

function radarColor(distance: number): string {
  if (distance > 300) return "#6ec6ff";
  if (distance >= 150) return "#ffd75e";
  return "#ff5c5c";
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
  private root: HTMLElement;

  onBuyBall?: (t: BallType) => void;
  onNewRun?: () => void;
  onPickAugment?: (id: string) => void;
  pixelsMined = 0;
  treasurePings = false;

  private currencyEl: HTMLElement;
  private upgradePointsEl: HTMLElement;
  private pixelsMinedEl: HTMLElement;

  private shopRows: Map<BallType, ShopRow>;

  private upgradePanel: HTMLElement;
  private upgradeButtons: Map<string, HTMLButtonElement>;
  private edgeLines: Map<string, SVGLineElement>;
  private tooltip: HTMLElement;
  private touchCapable: boolean;
  private lastTapNode: string | null;
  private lastTapTime: number;

  private minimapCanvas: HTMLCanvasElement;
  private minimapCtx: CanvasRenderingContext2D;
  private minimapCache: ImageData | null;
  private minimapCacheTime: number;
  private treasurePingCache: Array<[number, number]>;

  private winOverlay: HTMLElement;
  private augmentOverlay: HTMLElement;

  private popups: HTMLElement[];

  private radarEl: HTMLElement | null;
  private radarArrow: HTMLElement | null;
  private radarPulseTimer: number | null;

  constructor(root: HTMLElement, economy: EconomyState, world: World) {
    this.economy = economy;
    this.world = world;
    this.root = root;
    this.shopRows = new Map();
    this.upgradeButtons = new Map();
    this.edgeLines = new Map();
    this.minimapCache = null;
    this.minimapCacheTime = -Infinity;
    this.treasurePingCache = [];
    this.touchCapable = "ontouchstart" in window;
    this.lastTapNode = null;
    this.lastTapTime = 0;
    this.popups = [];
    this.radarEl = null;
    this.radarArrow = null;
    this.radarPulseTimer = null;

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

    const closeBtn = document.createElement("button");
    closeBtn.className = "upgrade-panel-close";
    closeBtn.textContent = "X";
    closeBtn.addEventListener("click", () => this.toggleUpgradePanel());
    this.upgradePanel.appendChild(closeBtn);

    const skillTree = document.createElement("div");
    skillTree.className = "skill-tree";
    skillTree.style.width = `${SKILL_TREE_W}px`;
    skillTree.style.height = `${SKILL_TREE_H}px`;

    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg") as SVGSVGElement;
    svg.classList.add("skill-tree-svg");
    svg.setAttribute("width", `${SKILL_TREE_W}`);
    svg.setAttribute("height", `${SKILL_TREE_H}`);
    skillTree.appendChild(svg);

    for (const node of UPGRADE_TREE) {
      if (!node.requires) continue;
      const parentLayout = NODE_LAYOUT[node.requires];
      const childLayout = NODE_LAYOUT[node.id];
      if (!parentLayout || !childLayout) continue;
      const line = document.createElementNS(svgNS, "line") as SVGLineElement;
      const [px, py] = nodeCenter(parentLayout);
      const [cx, cy] = nodeCenter(childLayout);
      line.setAttribute("x1", `${px}`);
      line.setAttribute("y1", `${py}`);
      line.setAttribute("x2", `${cx}`);
      line.setAttribute("y2", `${cy}`);
      line.setAttribute("stroke-width", "2");
      line.setAttribute("stroke", "#123");
      svg.appendChild(line);
      this.edgeLines.set(node.id, line);
    }

    for (const node of UPGRADE_TREE) {
      const layout = NODE_LAYOUT[node.id];
      const btn = document.createElement("button");
      btn.className = "upgrade-node";
      btn.style.setProperty("--node-color", nodeColor(node));
      if (layout) {
        btn.style.left = `${layout.col * SKILL_TREE_COL_W + NODE_PAD}px`;
        btn.style.top = `${layout.row * SKILL_TREE_ROW_H + NODE_PAD}px`;
      }
      btn.title = node.desc;

      const label = document.createElement("div");
      label.className = "upgrade-node-label";
      label.textContent = nodeShortLabel(node);

      const level = document.createElement("div");
      level.className = "upgrade-node-level";

      btn.appendChild(label);
      btn.appendChild(level);

      btn.addEventListener("mouseenter", () => this.showTooltip(btn, node));
      btn.addEventListener("mouseleave", () => this.hideTooltip());
      btn.addEventListener("click", () => this.handleNodeClick(btn, node));

      skillTree.appendChild(btn);
      this.upgradeButtons.set(node.id, btn);
    }

    this.upgradePanel.appendChild(skillTree);
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
    this.minimapCanvas.className = "minimap-canvas";
    this.minimapCanvas.width = MINIMAP_W;
    this.minimapCanvas.height = MINIMAP_H;
    const ctx = this.minimapCanvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.minimapCtx = ctx;
    minimapWrap.appendChild(this.minimapCanvas);
    root.appendChild(minimapWrap);

    const newRunPinned = document.createElement("div");
    newRunPinned.className = "new-run-pinned";

    const newRunBtn = document.createElement("button");
    newRunBtn.className = "new-run-btn";
    newRunBtn.textContent = "NEW RUN";

    const confirmRow = document.createElement("div");
    confirmRow.className = "new-run-confirm hidden";
    const confirmLabel = document.createElement("span");
    confirmLabel.textContent = "SURE?";
    const yesBtn = document.createElement("button");
    yesBtn.className = "new-run-yes";
    yesBtn.textContent = "YES";
    const noBtn = document.createElement("button");
    noBtn.className = "new-run-no";
    noBtn.textContent = "NO";
    confirmRow.appendChild(confirmLabel);
    confirmRow.appendChild(yesBtn);
    confirmRow.appendChild(noBtn);

    newRunPinned.appendChild(newRunBtn);
    newRunPinned.appendChild(confirmRow);
    root.appendChild(newRunPinned);

    let newRunTimer: number | null = null;
    const revertNewRun = () => {
      confirmRow.classList.add("hidden");
      newRunBtn.classList.remove("hidden");
      if (newRunTimer !== null) {
        window.clearTimeout(newRunTimer);
        newRunTimer = null;
      }
    };
    newRunBtn.addEventListener("click", () => {
      newRunBtn.classList.add("hidden");
      confirmRow.classList.remove("hidden");
      newRunTimer = window.setTimeout(revertNewRun, NEW_RUN_CONFIRM_MS);
    });
    yesBtn.addEventListener("click", () => {
      revertNewRun();
      this.onNewRun?.();
    });
    noBtn.addEventListener("click", () => revertNewRun());

    this.winOverlay = document.createElement("div");
    this.winOverlay.className = "win-overlay hidden";
    root.appendChild(this.winOverlay);

    this.augmentOverlay = document.createElement("div");
    this.augmentOverlay.className = "augment-overlay hidden";
    root.appendChild(this.augmentOverlay);

    this.update();
  }

  private handleNodeClick(btn: HTMLButtonElement, node: UpgradeNode): void {
    if (this.touchCapable) {
      const now = performance.now();
      if (this.lastTapNode === node.id && now - this.lastTapTime < TOUCH_TAP_WINDOW_MS) {
        if (buyUpgrade(this.economy, node.id)) this.update();
        this.lastTapNode = null;
        this.hideTooltip();
        return;
      }
      this.showTooltip(btn, node);
      this.lastTapNode = node.id;
      this.lastTapTime = now;
      return;
    }
    if (buyUpgrade(this.economy, node.id)) {
      this.update();
      this.showTooltip(btn, node);
    }
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
      const buyable = level < node.max && requiresMet && affordable;
      btn.disabled = !buyable;
      btn.classList.toggle("affordable", buyable);

      if (node.requires) {
        const line = this.edgeLines.get(node.id);
        if (line) {
          const parentLevel = this.economy.upgrades[node.requires] ?? 0;
          line.setAttribute("stroke", parentLevel > 0 ? "#2a4" : "#123");
        }
      }
    }
  }

  drawMinimap(cam: Camera): void {
    const now = performance.now();
    if (!this.minimapCache || now - this.minimapCacheTime >= MINIMAP_REFRESH_MS) {
      this.minimapCache = this.buildMinimapImage();
      this.minimapCacheTime = now;
    }
    this.minimapCtx.putImageData(this.minimapCache, 0, 0);

    if (this.treasurePings) {
      this.drawTreasurePings();
    }

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

  private drawTreasurePings(): void {
    const ctx = this.minimapCtx;
    ctx.fillStyle = "#ffd75e";
    for (const [x, y] of this.treasurePingCache) {
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
  }

  private buildMinimapImage(): ImageData {
    const image = new ImageData(MINIMAP_W, MINIMAP_H);
    const data = image.data;
    const pings: Array<[number, number]> = [];
    for (let y = 0; y < MINIMAP_H; y++) {
      for (let x = 0; x < MINIMAP_W; x++) {
        const wx = x * MINIMAP_SAMPLE;
        const wy = y * MINIMAP_SAMPLE;
        const i = (y * MINIMAP_W + x) * 4;
        if (!this.world.isExplored(wx, wy)) {
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
          data[i + 3] = 255;
          continue;
        }
        const cell = this.world.get(wx, wy);
        const [r, g, b] = minimapColor(cell);
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
        if (cell === CELL.TREASURE) pings.push([x, y]);
      }
    }
    this.treasurePingCache = pings;
    return image;
  }

  showPopup(text: string, sx: number, sy: number): void {
    if (this.popups.length >= POPUP_MAX) {
      const oldest = this.popups.shift();
      oldest?.remove();
    }
    const el = document.createElement("div");
    el.className = "popup";
    el.textContent = text;
    el.style.left = `${sx}px`;
    el.style.top = `${sy}px`;
    this.root.appendChild(el);
    this.popups.push(el);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.classList.add("popup-active");
      });
    });

    window.setTimeout(() => {
      el.remove();
      const idx = this.popups.indexOf(el);
      if (idx !== -1) this.popups.splice(idx, 1);
    }, POPUP_LIFETIME_MS);
  }

  updateRadar(angle: number, distance: number): void {
    if (!this.radarEl) {
      this.radarEl = document.createElement("div");
      this.radarEl.className = "radar hidden";
      this.radarArrow = document.createElement("div");
      this.radarArrow.className = "radar-arrow";
      this.radarEl.appendChild(this.radarArrow);
      this.root.appendChild(this.radarEl);
    }
    this.radarEl.classList.remove("hidden");

    const color = radarColor(distance);
    if (this.radarArrow) {
      this.radarArrow.style.transform = `rotate(${angle}rad)`;
      this.radarArrow.style.borderLeftColor = color;
    }

    this.radarEl.classList.remove("radar-pulse");
    void this.radarEl.offsetWidth;
    this.radarEl.classList.add("radar-pulse");
    if (this.radarPulseTimer !== null) window.clearTimeout(this.radarPulseTimer);
    this.radarPulseTimer = window.setTimeout(() => {
      this.radarEl?.classList.remove("radar-pulse");
      this.radarPulseTimer = null;
    }, RADAR_PULSE_MS);
  }

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

  showAugmentChoice(defs: AugmentDef[]): void {
    this.augmentOverlay.textContent = "";

    const panel = document.createElement("div");
    panel.className = "augment-panel";

    const title = document.createElement("div");
    title.className = "augment-title";
    title.textContent = "CHOOSE AN AUGMENT";
    panel.appendChild(title);

    const cardRow = document.createElement("div");
    cardRow.className = "augment-cards";

    for (const def of defs) {
      const card = document.createElement("button");
      card.className = "augment-card";

      const name = document.createElement("div");
      name.className = "augment-card-name";
      name.textContent = def.name;
      card.appendChild(name);

      const desc = document.createElement("div");
      desc.className = "augment-card-desc";
      desc.textContent = def.desc;
      card.appendChild(desc);

      card.addEventListener("click", () => {
        this.augmentOverlay.classList.add("hidden");
        this.onPickAugment?.(def.id);
      });

      cardRow.appendChild(card);
    }

    panel.appendChild(cardRow);
    this.augmentOverlay.appendChild(panel);
    this.augmentOverlay.classList.remove("hidden");
  }
}
