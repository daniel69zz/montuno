// Una acción principal por pantalla, derivada SOLO de estados reales de la API.
import type { OrderView } from './types';

export type ActionId =
  | 'ramp'
  | 'fund'
  | 'advance'
  | 'logistics'
  | 'confirm'
  | 'dispute'
  | 'resolve'
  | 'review'
  | 'wait'
  | 'done';

export interface NextAction {
  id: ActionId;
  title: string;
  detail: string;
}

const LOGISTIC = ['NOT_PURCHASED', 'PURCHASED', 'IN_TRANSIT', 'ARRIVED_BOLIVIA', 'READY_FOR_DELIVERY', 'DELIVERED', 'ACCEPTED'] as const;
export const LOGISTIC_LABEL: Record<string, string> = {
  NOT_PURCHASED: 'Por comprar',
  PURCHASED: 'Comprado',
  IN_TRANSIT: 'En tránsito',
  ARRIVED_BOLIVIA: 'Llegó a Bolivia',
  READY_FOR_DELIVERY: 'Listo para entregar',
  DELIVERED: 'Entregado',
  ACCEPTED: 'Aceptado',
};

export function nextLogistic(current: string): string | null {
  const i = LOGISTIC.indexOf(current as (typeof LOGISTIC)[number]);
  if (i < 0 || i >= LOGISTIC.indexOf('DELIVERED')) return null;
  return LOGISTIC[i + 1];
}

const open = (o: OrderView) => o.states.onchain === 'FUNDED' || o.states.onchain === 'ADVANCE_PAID';
const disputed = (o: OrderView) => o.states.dispute === 'OPEN' || o.states.dispute === 'UNDER_REVIEW' || o.states.onchain === 'DISPUTED';
const closed = (o: OrderView) => o.states.onchain === 'SETTLED' || o.states.onchain === 'CANCELLED';

export function buyerAction(o: OrderView, opts: { rampAvailable: boolean }): NextAction {
  if (closed(o)) return { id: 'done', title: 'Pedido cerrado', detail: o.summary.label };
  if (disputed(o)) return { id: 'wait', title: 'Disputa en revisión', detail: 'Los fondos retenidos están congelados hasta que el árbitro decida.' };
  if (o.states.onchain === 'NONE') {
    if (opts.rampAvailable && ['NOT_STARTED', 'FAILED'].includes(o.states.payment))
      return { id: 'ramp', title: 'Consigue los USDC', detail: 'Paga en bolivianos con QR y recibe USDC en tu wallet. Después los depositas en el escrow.' };
    return { id: 'fund', title: 'Deposita el pago protegido', detail: 'Tu wallet firma el depósito en el contrato. La importadora no puede tocarlo hasta que confirmes la entrega.' };
  }
  if (open(o) && ['READY_FOR_DELIVERY', 'DELIVERED'].includes(o.states.logistic))
    return { id: 'confirm', title: 'Confirma que recibiste tu pedido', detail: 'Al confirmar, el contrato libera el saldo retenido a la importadora.' };
  return { id: 'wait', title: 'La importadora está trabajando', detail: `Estado del envío: ${LOGISTIC_LABEL[o.states.logistic] ?? o.states.logistic}.` };
}

export function importerAction(o: OrderView): NextAction {
  if (closed(o)) return { id: 'done', title: 'Pedido cerrado', detail: o.summary.label };
  if (disputed(o)) return { id: 'wait', title: 'Disputa en revisión', detail: 'El árbitro decidirá sobre el saldo retenido.' };
  if (o.states.onchain === 'NONE') return { id: 'wait', title: 'Esperando el pago del comprador', detail: 'Cuando deposite en el escrow podrás comprar con la tranquilidad de que el dinero existe.' };
  if (o.states.onchain === 'FUNDED' && o.escrow.mode === 'PARTIAL_ADVANCE' && o.engine === 'MONTUNO')
    return { id: 'advance', title: 'Cobra el anticipo para comprar', detail: 'El comprador aceptó este anticipo antes de pagar. Se cobra una sola vez.' };
  const nxt = nextLogistic(o.states.logistic);
  if (open(o) && nxt) return { id: 'logistics', title: `Marca: ${LOGISTIC_LABEL[nxt]}`, detail: 'Mantén informado al comprador. El tracking no libera fondos.' };
  return { id: 'wait', title: 'Esperando la confirmación del comprador', detail: 'Cuando confirme la entrega, recibirás el saldo retenido.' };
}

export function arbiterAction(o: OrderView): NextAction {
  if (o.states.onchain === 'DISPUTED') {
    if (o.states.dispute === 'OPEN') return { id: 'review', title: 'Toma la disputa', detail: 'Marca la disputa en revisión antes de resolver.' };
    return { id: 'resolve', title: 'Resuelve el reparto', detail: 'Reparte exactamente el saldo retenido. El anticipo pagado no se puede devolver.' };
  }
  return { id: 'wait', title: 'Sin disputa activa', detail: o.summary.label };
}

export interface Stratum {
  key: string;
  label: string;
  state: 'done' | 'current' | 'todo';
}

/** Capas del pedido (de la base a la cima). */
export function strata(o: OrderView): Stratum[] {
  const funded = o.states.onchain !== 'NONE';
  const li = LOGISTIC.indexOf(o.states.logistic as (typeof LOGISTIC)[number]);
  const settled = o.states.onchain === 'SETTLED';
  const layers: { key: string; label: string; done: boolean }[] = [
    { key: 'accepted', label: 'Cotización aceptada', done: true },
    { key: 'funded', label: 'Pago protegido en el escrow', done: funded },
    ...(o.escrow.mode === 'PARTIAL_ADVANCE' ? [{ key: 'advance', label: 'Anticipo cobrado por la importadora', done: BigInt(o.escrow.projection.advanceReleasedAtomic) > 0n }] : []),
    { key: 'purchased', label: 'Producto comprado', done: li >= 1 },
    { key: 'transit', label: 'En camino a Bolivia', done: li >= 2 },
    { key: 'delivered', label: 'Entregado', done: li >= 5 },
    { key: 'released', label: o.states.dispute === 'RESOLVED' ? 'Resuelto por el árbitro' : 'Saldo liberado', done: settled },
  ];
  let current = false;
  return layers.map((l) => {
    if (l.done) return { key: l.key, label: l.label, state: 'done' as const };
    if (!current) {
      current = true;
      return { key: l.key, label: l.label, state: 'current' as const };
    }
    return { key: l.key, label: l.label, state: 'todo' as const };
  });
}
