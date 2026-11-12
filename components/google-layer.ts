
/**
 * The one DOM layer our own markers live in on the Google map: station dots,
 * labels, live trains, the GPS dot, cards and the place pin. Every element is
 * a zero-size box placed at a coordinate, so an element's anchor is the exact
 * point it marks (the bug that put station dots off their lines was a marker
 * whose anchor was the middle of dot-plus-label). It sits in Google's
 * `overlayMouseTarget` pane, which pans with the map for free; only a zoom or
 * a resize needs the positions recomputed, which `draw()` does.
 */

export interface LayerItem {
  lat: number;
  lon: number;
  el: HTMLElement;
}

export interface TransitLayer extends google.maps.OverlayView {
  /** The projection once the layer is attached; null before that. */
  projection(): google.maps.MapCanvasProjection | null;
  add(id: string, lat: number, lon: number, el: HTMLElement, z: number): void;
  move(id: string, lat: number, lon: number): void;
  remove(id: string): void;
  has(id: string): boolean;
  /** A point's position in the pane, in px, or null until the layer is attached. */
  pointOf(lat: number, lon: number): { x: number; y: number } | null;
  /** A point's position in the map's container, in px (what is visible on screen). */
  containerPointOf(lat: number, lon: number): { x: number; y: number } | null;
  /** Called after every draw (a zoom, a resize): re-lay-out things that depend on screen size. */
  onDraw: (() => void) | null;
  /** Called once, when the layer is attached to the map. */
  onReady: (() => void) | null;
}

export function createTransitLayer(g: typeof google): TransitLayer {
  class Layer extends g.maps.OverlayView implements TransitLayer {
    private root: HTMLDivElement | null = null;
    private items = new Map<string, LayerItem>();
    onDraw: (() => void) | null = null;
    onReady: (() => void) | null = null;

    projection() {
      return this.getProjection() ?? null;
    }

    onAdd() {
      const root = document.createElement("div");
      root.style.cssText = "position:absolute;left:0;top:0;width:0;height:0";
      this.getPanes()?.overlayMouseTarget.appendChild(root);
      this.root = root;
      for (const item of this.items.values()) root.appendChild(item.el);
      this.onReady?.();
    }

    onRemove() {
      this.root?.remove();
      this.root = null;
    }

    draw() {
      for (const item of this.items.values()) this.place(item);
      this.onDraw?.();
    }

    private place(item: LayerItem) {
      const p = this.pointOf(item.lat, item.lon);
      if (p) item.el.style.transform = `translate3d(${p.x}px,${p.y}px,0)`;
    }

    pointOf(lat: number, lon: number) {
      const proj = this.getProjection();
      if (!proj) return null;
      const p = proj.fromLatLngToDivPixel(new g.maps.LatLng(lat, lon));
      return p ? { x: p.x, y: p.y } : null;
    }

    containerPointOf(lat: number, lon: number) {
      const proj = this.getProjection();
      if (!proj) return null;
      const p = proj.fromLatLngToContainerPixel(new g.maps.LatLng(lat, lon));
      return p ? { x: p.x, y: p.y } : null;
    }

    add(id: string, lat: number, lon: number, el: HTMLElement, z: number) {
      this.remove(id);
      el.style.cssText += `;position:absolute;left:0;top:0;width:0;height:0;z-index:${z}`;
      const item = { lat, lon, el };
      this.items.set(id, item);
      this.root?.appendChild(el);
      this.place(item);
    }

    move(id: string, lat: number, lon: number) {
      const item = this.items.get(id);
      if (!item) return;
      item.lat = lat;
      item.lon = lon;
      this.place(item);
    }

    remove(id: string) {
      const item = this.items.get(id);
      if (!item) return;
      item.el.remove();
      this.items.delete(id);
    }

    has(id: string) {
      return this.items.has(id);
    }
  }
  return new Layer() as TransitLayer;
}

/** The text-box size of a label in px, measured with the same font it is drawn in. */
let measureCtx: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();
export function textWidth(text: string, sizePx: number, weight = 700): number {
  const key = `${weight}|${sizePx.toFixed(1)}|${text}`;
  const hit = widths.get(key);
  if (hit !== undefined) return hit;
  if (measureCtx === undefined) measureCtx = document.createElement("canvas").getContext("2d");
  let w: number;
  if (measureCtx) {
    measureCtx.font = `${weight} ${sizePx}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans Thai", sans-serif`;
    w = measureCtx.measureText(text).width;
  } else {
    w = text.length * sizePx * 0.6;
  }
  widths.set(key, w);
  return w;
}


