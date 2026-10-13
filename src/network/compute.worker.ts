// Web Worker girişi: gelen işi compute.ts işleyicisine verir, sonucu geri yollar. Hiçbir DOM/Horizons bağımlılığı yok.
import { createHandler, type Req } from './compute';

const handle = createHandler();
self.onmessage = (e: MessageEvent<{ id: number; req: Req }>) => {
  const { id, req } = e.data;
  try { (self as unknown as Worker).postMessage({ id, ok: true, res: handle(req) }); }
  catch (err) { (self as unknown as Worker).postMessage({ id, ok: false, error: (err as Error).message }); }
};
