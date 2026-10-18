// ============================================================================
//  dom.ts — Micro-ayudante DOM de la interfaz V2 (sin framework).
//
//  `h(tag, props, ...children)` crea un elemento con clases, atributos,
//  dataset, eventos y texto en una sola expresión: los módulos de src/ui/
//  describen su árbol de forma declarativa y legible sin innerHTML (cero
//  inyección: el texto siempre entra como textContent).
// ============================================================================

export type Child = Node | string | number | null | undefined | false;

export interface Props {
  class?: string;
  id?: string;
  text?: string;
  title?: string;
  /** Atributos arbitrarios (aria-*, role, type…); null/false los omite. */
  attrs?: Record<string, string | number | boolean | null | undefined>;
  dataset?: Record<string, string>;
  /** Atajo de `data-testid` (localizadores estables de los E2E). */
  testid?: string;
  style?: Partial<Record<string, string>>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (ev: HTMLElementEventMap[K]) => void }>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    if (props.class) el.className = props.class;
    if (props.id) el.id = props.id;
    if (props.title) el.title = props.title;
    if (props.testid) el.dataset.testid = props.testid;
    if (props.attrs) {
      for (const [k, v] of Object.entries(props.attrs)) {
        if (v === null || v === undefined || v === false) continue;
        el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    if (props.dataset) Object.assign(el.dataset, props.dataset);
    if (props.style) {
      for (const [k, v] of Object.entries(props.style)) {
        if (v !== undefined) el.style.setProperty(k, v);
      }
    }
    if (props.on) {
      for (const [ev, fn] of Object.entries(props.on)) {
        if (fn) el.addEventListener(ev, fn as EventListener);
      }
    }
    if (props.text !== undefined) el.textContent = props.text;
  }
  append(el, ...children);
  return el;
}

/** Añade hijos ignorando null/false (composición condicional cómoda). */
export function append(parent: Node, ...children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === 'string' || typeof c === 'number'
      ? document.createTextNode(String(c))
      : c);
  }
}

/** Sustituye TODO el contenido de un nodo. */
export function replaceChildren(parent: Element, ...children: Child[]): void {
  parent.textContent = '';
  append(parent, ...children);
}

/**
 * Escribe texto SOLO si cambió (la telemetría llama a 15 Hz: tocar el DOM
 * con el mismo valor provoca recálculos de estilo inútiles).
 */
export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** Igual que setText pero para un atributo. */
export function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

/** ¿El evento de teclado viene de un campo editable? (los atajos se apartan). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    // Casillas, radios y botones no "escriben": los atajos siguen vivos.
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range'].includes(target.type);
  }
  return false;
}

let uidSeq = 0;
/** Id único para enlazar label/aria-labelledby/aria-controls. */
export function uid(prefix = 'ua'): string {
  uidSeq += 1;
  return `${prefix}-${uidSeq}`;
}
