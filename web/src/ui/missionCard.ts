// ============================================================================
//  missionCard.ts — Tarjeta de misión de instrucción (pestaña INSTRUCCIÓN).
//
//  Icono + título + descripción, fila de récord con estrellas SVG, línea de
//  estado viva y botonera. El estado 'live' resalta la tarjeta en ámbar
//  mientras el reto está en curso.
// ============================================================================
import { h, setText } from './dom';
import { IconName, icon } from './icons';

export interface MissionCard {
  el: HTMLElement;
  status: HTMLElement;
  record: HTMLElement;
  actions: HTMLElement;
  extra: HTMLElement;
  setLive(live: boolean): void;
  setStatus(text: string): void;
  setRecord(stars: number | null, text: string): void;
}

/** Barra de estrellas en SVG (0-3), accesible con aria-label. */
export function starRow(stars: number, size = 14): HTMLElement {
  const row = h('span', { class: 'stars', attrs: { role: 'img', 'aria-label': `${stars} de 3 estrellas` } });
  for (let i = 0; i < 3; i++) {
    const s = icon(i < stars ? 'starFill' : 'star', size);
    s.classList.add(i < stars ? 'is-on' : 'is-off');
    row.appendChild(s);
  }
  return row;
}

export function missionCard(o: { icon: IconName; title: string; tag: string; desc: string; testid: string; gloss?: string }): MissionCard {
  const status = h('p', { class: 'mcard__status', attrs: { role: 'status' } });
  const record = h('div', { class: 'mcard__record' });
  const actions = h('div', { class: 'mcard__actions' });
  const extra = h('div', { class: 'mcard__extra' });
  const title = h('h3', { class: 'mcard__title', text: o.title });
  if (o.gloss) title.dataset.gloss = o.gloss;
  const el = h('article', { class: 'mcard', testid: o.testid },
    h('header', { class: 'mcard__head' },
      h('span', { class: 'mcard__icon' }, icon(o.icon, 20)),
      h('div', { class: 'mcard__titles' },
        h('span', { class: 'ua-eyebrow', text: o.tag }),
        title,
      ),
      h('span', { class: 'mcard__live' }, h('span', { class: 'mcard__live-dot' }), 'En curso'),
    ),
    h('p', { class: 'mcard__desc', text: o.desc }),
    extra,
    record,
    status,
    actions,
  );
  return {
    el, status, record, actions, extra,
    setLive(live: boolean) { el.classList.toggle('is-live', live); },
    setStatus(text: string) { setText(status, text); status.hidden = !text; },
    setRecord(stars: number | null, text: string) {
      record.textContent = '';
      record.append(
        h('span', { class: 'ua-eyebrow', text: 'Récord' }),
        stars === null ? h('span', { class: 'ua-muted', text: '—' }) : starRow(stars),
        h('span', { class: 'mcard__record-t num', text }),
      );
    },
  };
}
