// ============================================================================
//  ballistics.worker.ts — El núcleo balístico fuera del hilo UI.  [P-NEXT.5]
//
//  Shim fino sobre WorkerProtocol.executeRequest. Detalle importante: se
//  procesa UNA petición por macrotarea (setTimeout 0) en vez de resolver
//  dentro de onmessage. Así, mientras un solve largo corre, los mensajes de
//  cancelación que llegan se registran ANTES de que arranque el siguiente
//  solve en cola — un preview obsoleto encolado se salta de verdad en vez de
//  quemarse enteros (los mensajes son FIFO; sin este yield la cancelación
//  siempre llegaría tarde).
// ============================================================================
import {
  CancelMessage, WorkerRequest, WorkerResponse, executeRequest,
} from './ballistics/WorkerProtocol';

const queue: WorkerRequest[] = [];
const cancelled = new Set<number>();
let draining = false;

function post(msg: WorkerResponse): void {
  (self as unknown as Worker).postMessage(msg);
}

function drainOne(): void {
  const req = queue.shift();
  if (!req) {
    draining = false;
    return;
  }
  if (cancelled.delete(req.id)) {
    post({ id: req.id, ok: false, error: 'superseded', cancelled: true });
  } else {
    try {
      post({ id: req.id, ok: true, result: executeRequest(req) });
    } catch (err) {
      post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  // Ceder el bucle de eventos entre tareas para poder recibir cancelaciones.
  if (queue.length > 0) setTimeout(drainOne, 0);
  else draining = false;
}

self.onmessage = (ev: MessageEvent<WorkerRequest | CancelMessage>) => {
  const msg = ev.data;
  if ('cancel' in msg) {
    cancelled.add(msg.cancel);
    return;
  }
  queue.push(msg);
  if (!draining) {
    draining = true;
    setTimeout(drainOne, 0);
  }
};
