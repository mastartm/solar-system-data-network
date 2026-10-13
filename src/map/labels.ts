// Saf etiket yerleştirici (DOM/Canvas yok): MapView ve NetworkLayer etiketleri çizmez, istek olarak toplar;
// render sonunda placeLabels çalışır. Rastgelelik yok: aynı girdi her zaman aynı yerleşimi verir.

/** Küçük sayı = önemli. */
export const LabelPriority = {
  selected: 0,
  planet: 1, // Güneş ve gezegenler
  moon: 2,
  relay: 3, // aktarma uydusu
  asset: 4, // yüzey aracı
  delay: 5, // ışık gecikmesi yazısı
} as const;

export interface LabelRequest {
  id: string;
  text: string;
  /** Etiketin bağlandığı nesnenin ekran konumu ve çizim yarıçapı (px). */
  ax: number;
  ay: number;
  radius: number;
  priority: number;
  /** Ölçülmüş metin kutusu (px). */
  w: number;
  h: number;
  /** Cisim merkezi: tercih edilen yön bu merkezden nesneye doğru (dışa) alınır. Yoksa sağ (E). */
  cx?: number;
  cy?: number;
  /** true ise yer bulunamasa da (çakışarak) yerleştirilir. */
  mandatory?: boolean;
  /** Çizim ipuçları (yerleştirici bakmaz). */
  color?: string;
  font?: string;
}

/** Etiketlerin üstüne binmemesi gereken nesne (cisim diski, işaret). owner = kendi etiketi hariç tutulur. */
export interface Obstacle { x: number; y: number; r: number; owner?: string }

export interface Bounds { x0: number; y0: number; x1: number; y1: number }

export interface PlacedLabel extends LabelRequest {
  /** Sol üst köşe. */
  x: number;
  y: number;
  /** Aday sırası: yön (0 = tercih edilen) ve mesafe indeksi. */
  dirIndex: number;
  distIndex: number;
  /** Uzağa yerleştirildiyse nesneden etikete çıkıntı çizgisi. */
  leader: { x1: number; y1: number; x2: number; y2: number } | null;
  /** Hiçbir serbest aday olmadığı için çakışarak konan zorunlu etiket. */
  forced: boolean;
}

export interface PlaceOptions {
  /** Nesne kenarından sonraki 4 mesafe (px). */
  distances: number[];
  /** Bu mesafe indeksinden itibaren çıkıntı çizgisi çizilir. */
  leaderFrom: number;
  /** Etiketler arası en az boşluk (px). */
  pad: number;
}

export const DEFAULT_PLACE: PlaceOptions = { distances: [3, 12, 28, 52], leaderFrom: 2, pad: 2 };

/** 8 yön (ekran koordinatı, y aşağı): E, SE, S, SW, W, NW, N, NE. */
const DIRS: [number, number][] = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

const angleOf = (dx: number, dy: number) => Math.atan2(dy, dx);
const angDiff = (a: number, b: number) => {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
};

/** Yönleri tercih edilene yakınlık sırasına dizer (eşitlikte sabit sıra → belirleyici). */
export function directionOrder(req: Pick<LabelRequest, 'ax' | 'ay' | 'cx' | 'cy'>): number[] {
  let pref = 0;
  if (req.cx !== undefined && req.cy !== undefined) {
    const dx = req.ax - req.cx, dy = req.ay - req.cy;
    if (Math.hypot(dx, dy) > 1e-6) pref = angleOf(dx, dy);
  }
  return DIRS.map((d, i) => ({ i, diff: angDiff(angleOf(d[0], d[1]), pref) }))
    .sort((a, b) => a.diff - b.diff || a.i - b.i)
    .map((o) => o.i);
}

interface Rect { x: number; y: number; w: number; h: number }

const rectsOverlap = (a: Rect, b: Rect, pad: number) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/** Daire (kare sınır kutusu değil, gerçek daire) ile dikdörtgen çakışması. */
function circleHitsRect(o: Obstacle, r: Rect, pad: number): boolean {
  const nx = Math.min(Math.max(o.x, r.x - pad), r.x + r.w + pad);
  const ny = Math.min(Math.max(o.y, r.y - pad), r.y + r.h + pad);
  return Math.hypot(o.x - nx, o.y - ny) < o.r;
}

const inside = (r: Rect, b: Bounds) => r.x >= b.x0 && r.y >= b.y0 && r.x + r.w <= b.x1 && r.y + r.h <= b.y1;

/** Aday dikdörtgen: nesne merkezinden (yarıçap + mesafe) uzaklıktaki nokta, etiketin o yöne bakan kenarı/köşesi olur. */
function candidate(req: LabelRequest, dir: [number, number], offset: number): Rect {
  const d = req.radius + offset;
  const len = Math.hypot(dir[0], dir[1]);
  const px = req.ax + (dir[0] / len) * d;
  const py = req.ay + (dir[1] / len) * d;
  const x = dir[0] > 0 ? px : dir[0] < 0 ? px - req.w : px - req.w / 2;
  const y = dir[1] > 0 ? py : dir[1] < 0 ? py - req.h : py - req.h / 2;
  return { x, y, w: req.w, h: req.h };
}

/** Dikdörtgenin nesne merkezine en yakın noktası (çıkıntı çizgisinin ucu). */
function nearestPoint(r: Rect, x: number, y: number): [number, number] {
  return [Math.min(Math.max(x, r.x), r.x + r.w), Math.min(Math.max(y, r.y), r.y + r.h)];
}

/**
 * Etiketleri önceliğe göre yerleştirir (küçük priority önce; eşitlikte girdi sırası).
 * Her etiket için önce en yakın mesafede 8 yön (tercih edilenden başlayarak), sonra bir sonraki mesafe denenir.
 * Hiçbir aday sınır içinde ve çakışmasız değilse etiket atlanır; mandatory ise tercih edilen adayın en az çakışanında kalır.
 * Dönen dizi yerleştirilenleri, yerleştirme sırasıyla içerir.
 */
export function placeLabels(
  requests: LabelRequest[],
  obstacles: Obstacle[],
  bounds: Bounds,
  opts: PlaceOptions = DEFAULT_PLACE,
): PlacedLabel[] {
  const order = requests.map((r, i) => ({ r, i })).sort((a, b) => a.r.priority - b.r.priority || a.i - b.i);
  const placed: PlacedLabel[] = [];
  const taken: Rect[] = [];

  const free = (rect: Rect, id: string) =>
    inside(rect, bounds) &&
    !taken.some((t) => rectsOverlap(rect, t, opts.pad)) &&
    !obstacles.some((o) => o.owner !== id && circleHitsRect(o, rect, opts.pad));

  for (const { r } of order) {
    const dirs = directionOrder(r);
    let found: { rect: Rect; di: number; mi: number } | null = null;
    outer: for (let mi = 0; mi < opts.distances.length; mi++) {
      for (let di = 0; di < dirs.length; di++) {
        const rect = candidate(r, DIRS[dirs[di]], opts.distances[mi]);
        if (free(rect, r.id)) { found = { rect, di, mi }; break outer; }
      }
    }
    let forced = false;
    if (!found) {
      if (!r.mandatory) continue;
      // Zorunlu: sınır içindeki adaylardan en az engelle çakışanı; hiçbiri sınır içinde değilse sınıra sıkıştırılmış tercih edileni.
      let best: { rect: Rect; di: number; mi: number; cost: number } | null = null;
      for (let mi = 0; mi < opts.distances.length; mi++) {
        for (let di = 0; di < dirs.length; di++) {
          const rect = candidate(r, DIRS[dirs[di]], opts.distances[mi]);
          if (!inside(rect, bounds)) continue;
          const cost = taken.filter((t) => rectsOverlap(rect, t, opts.pad)).length * 2 +
            obstacles.filter((o) => o.owner !== r.id && circleHitsRect(o, rect, opts.pad)).length;
          if (!best || cost < best.cost) best = { rect, di, mi, cost };
        }
      }
      if (!best) {
        const rect = candidate(r, DIRS[dirs[0]], opts.distances[0]);
        rect.x = Math.min(Math.max(rect.x, bounds.x0), Math.max(bounds.x0, bounds.x1 - rect.w));
        rect.y = Math.min(Math.max(rect.y, bounds.y0), Math.max(bounds.y0, bounds.y1 - rect.h));
        best = { rect, di: 0, mi: 0, cost: 0 };
      }
      found = best;
      forced = true;
    }
    const { rect, di, mi } = found;
    let leader: PlacedLabel['leader'] = null;
    if (mi >= opts.leaderFrom) {
      const [x2, y2] = nearestPoint(rect, r.ax, r.ay);
      const len = Math.hypot(x2 - r.ax, y2 - r.ay) || 1;
      // Çizgi nesnenin kenarından başlar (içine girmez).
      leader = { x1: r.ax + ((x2 - r.ax) / len) * r.radius, y1: r.ay + ((y2 - r.ay) / len) * r.radius, x2, y2 };
    }
    taken.push(rect);
    placed.push({ ...r, x: rect.x, y: rect.y, dirIndex: di, distIndex: mi, leader, forced });
  }
  return placed;
}

/** Etiket toplayıcı: MapView ve NetworkLayer'ın çağırdığı arayüz. */
export interface LabelSink {
  label(req: Omit<LabelRequest, 'w' | 'h'>): void;
  obstacle(x: number, y: number, r: number, owner?: string): void;
}

/** Ölçüm işlevi verilen saf toplayıcı (test edilebilir). */
export class LabelCollector implements LabelSink {
  requests: LabelRequest[] = [];
  obstacles: Obstacle[] = [];
  constructor(private measure: (text: string, font?: string) => { w: number; h: number }) {}
  label(req: Omit<LabelRequest, 'w' | 'h'>) {
    const m = this.measure(req.text, req.font);
    this.requests.push({ ...req, w: m.w, h: m.h });
  }
  obstacle(x: number, y: number, r: number, owner?: string) {
    this.obstacles.push({ x, y, r, owner });
  }
  clear() {
    this.requests.length = 0;
    this.obstacles.length = 0;
  }
}
