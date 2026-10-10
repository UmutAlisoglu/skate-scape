import type { LocalPlace } from './places.ts';

export interface MapMarker { x: number; z: number; kind: 'marker' | 'spot' | 'done' | 'rune' }
/**
 * The exported minimap (see tools/export-area.ts): detailed tiles (`scale` px per map tile, one image per block of
 * `block` x `block` map tiles, loaded as you get near) over a 1 px per tile overview, which the world map shows.
 * `width` and `height` are the whole map in tile pixels.
 */
interface MapImage { scale: number; width: number; height: number; block: number; overview: HTMLImageElement; tile(bx: number, by: number): HTMLImageElement | null }

/** Loads the minimap's overview and index; null when the area has none. */
export async function loadMapImage(base: string): Promise<MapImage | null> {
  try {
    const meta = await (await fetch(`${base}/minimap.json`)).json() as { version: number; scale: number; width: number; height: number; block: number; tiles: [number, number][]; overview: string };
    if (meta.version !== 2) return null;
    const overview = new Image(); overview.src = `${base}/${meta.overview}`; await overview.decode();
    const available = new Set(meta.tiles.map(([bx, by]) => `${bx}_${by}`)), cache = new Map<string, HTMLImageElement>();
    const tile = (bx: number, by: number) => {
      const key = `${bx}_${by}`;
      if (!available.has(key)) return null;
      let image = cache.get(key);
      if (image) cache.delete(key);
      else { image = new Image(); image.src = `${base}/minimap/${key}.png`; }
      cache.set(key, image); // most recently used last
      if (cache.size > 16) cache.delete(cache.keys().next().value!);
      return image.complete && image.naturalWidth ? image : null;
    };
    return { ...meta, overview, tile };
  } catch { return null; }
}

const ICON: Record<MapMarker['kind'] | 'place', string> = { marker: '#f2d22c', spot: '#ff9a3c', done: '#7fd18b', place: '#7fd4ff', rune: '#ffffff' };

/**
 * RS-style round minimap (rotates with the camera, north on the compass) plus a full world map that teleports
 * to a destination when one is clicked.
 */
export class Minimap {
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly compass = document.createElement('div');
  private readonly world = document.createElement('div');
  private readonly worldCanvas = document.createElement('canvas');
  private readonly size = 172;
  open = false;

  constructor(private map: MapImage, private places: LocalPlace[], private teleport: (place: LocalPlace) => void) {
    const ratio = Math.min(2, devicePixelRatio || 1);
    this.canvas.width = this.canvas.height = this.size * ratio;
    this.canvas.id = 'minimap'; this.canvas.setAttribute('aria-label', 'Minimap');
    this.context = this.canvas.getContext('2d')!; this.context.scale(ratio, ratio);
    this.compass.id = 'compass'; this.compass.textContent = 'N';
    this.world.id = 'world-map'; this.world.hidden = true;
    this.world.innerHTML = '<div class="world-map-head"><span class="eyebrow">WORLD MAP</span><span>Click a teleport · Tab to close</span></div>';
    this.world.append(this.worldCanvas);
    this.worldCanvas.addEventListener('click', (event) => {
      const rect = this.worldCanvas.getBoundingClientRect(), scale = this.worldCanvas.width / rect.width;
      const mx = (event.clientX - rect.left) * scale, my = (event.clientY - rect.top) * scale;
      const hit = this.places.find((place) => Math.hypot(this.worldX(place.x) - mx, this.worldY(place.z) - my) < 16 * scale);
      if (hit) { this.toggle(false); this.teleport(hit); }
    });
    document.body.append(this.canvas, this.compass, this.world);
  }
  private worldX(x: number) { return x * this.map.scale * this.fit; }
  private worldY(z: number) { return (this.map.height + z * this.map.scale) * this.fit; }
  private fit = 1;

  /** Redraws the round minimap: centred on the rider, rotated so the camera's forward is up. */
  update(x: number, z: number, heading: number, cameraYaw: number, markers: MapMarker[]) {
    // off the map (the training grounds sit outside it): hide instead of drawing a blank disc
    const inside = x >= 0 && -z >= 0 && x * this.map.scale <= this.map.width && -z * this.map.scale <= this.map.height;
    this.canvas.hidden = this.compass.hidden = !inside;
    if (!inside) return;
    const c = this.context, s = this.size, r = s / 2, m = this.map;
    c.save(); c.clearRect(0, 0, s, s);
    c.beginPath(); c.arc(r, r, r - 2, 0, Math.PI * 2); c.clip();
    c.fillStyle = '#0b1a14'; c.fillRect(0, 0, s, s);
    c.translate(r, r); c.rotate(cameraYaw);
    // the overview underneath (blurry), then the detailed tiles in view once they've loaded
    const view = 34, rows = m.height / m.scale, sx = Math.max(0, Math.floor(x - view)), sy = Math.max(0, Math.floor(rows + z - view));
    c.imageSmoothingEnabled = false;
    c.drawImage(m.overview, sx, sy, view * 2, view * 2, (sx - x) * m.scale, (sy - rows - z) * m.scale, view * 2 * m.scale, view * 2 * m.scale);
    const b = m.block;
    for (let bx = Math.floor((x - view) / b); bx <= Math.floor((x + view) / b); bx++) for (let by = Math.floor((-z - view) / b); by <= Math.floor((-z + view) / b); by++) {
      const image = bx >= 0 && by >= 0 ? m.tile(bx, by) : null;
      // a tile's bottom edge is its southern border, by * b tiles north of the map's corner
      if (image) c.drawImage(image, (bx * b - x) * m.scale, -(by * b + z) * m.scale - image.height);
    }
    c.imageSmoothingEnabled = true;
    for (const place of this.places) this.dot(place.x - x, place.z - z, ICON.place, 4, true);
    for (const marker of markers) this.dot(marker.x - x, marker.z - z, ICON[marker.kind], marker.kind === 'marker' ? 5 : 4, false);
    c.restore();
    // the rider: a white arrow pointing along the board's travel, relative to the camera
    c.save(); c.translate(r, r); c.rotate(cameraYaw - heading);
    c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, -7); c.lineTo(5, 6); c.lineTo(0, 3); c.lineTo(-5, 6); c.closePath(); c.fill(); c.stroke(); c.restore();
    c.strokeStyle = '#8a7a4d'; c.lineWidth = 3; c.beginPath(); c.arc(r, r, r - 2, 0, Math.PI * 2); c.stroke();
    this.compass.style.transform = `rotate(${cameraYaw}rad)`;
    if (this.open) this.drawWorld(x, z, markers);
  }
  private dot(dx: number, dz: number, color: string, size: number, star: boolean) {
    const c = this.context, px = dx * this.map.scale, py = dz * this.map.scale;
    if (px * px + py * py > (this.size / 2) ** 2 * 1.6) return;
    c.save(); c.translate(px, py);
    c.fillStyle = color; c.strokeStyle = '#000'; c.lineWidth = 1;
    c.beginPath();
    if (star) for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4, l = i % 2 ? size * 0.45 : size; c.lineTo(Math.sin(a) * l, -Math.cos(a) * l); }
    else c.arc(0, 0, size, 0, Math.PI * 2);
    c.closePath(); c.fill(); c.stroke(); c.restore();
  }
  toggle(open = !this.open) {
    this.open = open; this.world.hidden = !open;
  }
  private drawWorld(x: number, z: number, markers: MapMarker[]) {
    const m = this.map, maxW = innerWidth * 0.86, maxH = innerHeight * 0.8;
    this.fit = Math.min(maxW / m.width, maxH / m.height);
    const w = Math.round(m.width * this.fit), h = Math.round(m.height * this.fit);
    if (this.worldCanvas.width !== w || this.worldCanvas.height !== h) { this.worldCanvas.width = w; this.worldCanvas.height = h; }
    const c = this.worldCanvas.getContext('2d')!;
    c.drawImage(m.overview, 0, 0, w, h);
    c.font = '600 12px system-ui, sans-serif'; c.textAlign = 'center';
    for (const place of this.places) {
      const px = this.worldX(place.x), py = this.worldY(place.z);
      c.fillStyle = ICON.place; c.strokeStyle = '#000'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(px, py, 6, 0, Math.PI * 2); c.fill(); c.stroke();
      const half = c.measureText(place.name).width / 2 + 3, lx = Math.max(half, Math.min(w - half, px)), ly = Math.max(14, py - 11);
      c.lineWidth = 3; c.strokeText(place.name, lx, ly); c.fillStyle = '#fff'; c.fillText(place.name, lx, ly);
    }
    // runes are small specks so a whole world's worth doesn't bury the place names
    for (const marker of markers) { c.fillStyle = ICON[marker.kind]; c.beginPath(); c.arc(this.worldX(marker.x), this.worldY(marker.z), marker.kind === 'rune' ? 2 : 5, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 2;
    c.beginPath(); c.arc(this.worldX(x), this.worldY(z), 6, 0, Math.PI * 2); c.fill(); c.stroke();
  }
}
