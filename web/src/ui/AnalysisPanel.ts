// ============================================================================
//  AnalysisPanel.ts — Pestaña ANÁLISIS.  [V2/UI]
//
//  * ÚLTIMO DISPARO — fallo respecto al objetivo con su descomposición en la
//    línea de tiro (largo/corto, derecha/izquierda) y un diagrama de impacto,
//    más alcance, TOF, ángulo de caída, velocidad y energía en el impacto,
//    Mach máximo, ápice y tipo de detonación.
//  * DISPERSIÓN PREVISTA — σ y error probable (EP) en alcance y dirección,
//    CEP aproximado (elipse PER pintada sobre el mapa).
//  * SALVA DISPERSA — CEP medido y desplazamiento del punto medio de impacto.
//  * COMPARAR FÍSICAS — leyenda con colores, alcances y lo que roba cada
//    efecto respecto al vacío.
// ============================================================================
import { Readout } from './components';
import { append, h, setText } from './dom';
import { icon } from './icons';
import { CompareReport, PredictionReport, SalvoReport, ShotReport, missGrade } from './reports';
import { RightDock } from './RightDock';
import { settings } from './settings';
import { UNIT_SUFFIX, cepFromSigmas, distanceParts, fmtAngleValue, fmtEnergy, fmtNum, probableError } from './units';

const DPR = 2;
const DETONATION: Record<ShotReport['detonation'], string> = {
  ground: 'Impacto',
  air: 'Estallido aéreo',
  buried: 'Retardo (enterrada)',
};

export class AnalysisPanel {
  private readonly shotEmpty: HTMLElement;
  private readonly shotBody: HTMLElement;
  private readonly missBig: HTMLElement;
  private readonly missSub: HTMLElement;
  private readonly missBox: HTMLElement;
  private readonly diagram: HTMLCanvasElement;
  private readonly shotMeta: HTMLElement;
  private readonly r: Record<string, Readout> = {};
  private readonly perBody: HTMLElement;
  private readonly perEmpty: HTMLElement;
  private readonly p: Record<string, Readout> = {};
  private readonly salvoBody: HTMLElement;
  private readonly salvoEmpty: HTMLElement;
  private readonly s: Record<string, Readout> = {};
  private readonly cmpBody: HTMLElement;
  private readonly cmpEmpty: HTMLElement;

  private shot: ShotReport | null = null;
  private pred: PredictionReport | null = null;

  constructor(host: HTMLElement) {
    host.textContent = '';
    const section = (title: string, gloss: string | null, ...children: HTMLElement[]) =>
      h('section', { class: 'rpanel-section' },
        h('div', { class: 'rpanel-section__head' }, h('span', { class: 'ua-eyebrow', text: title, dataset: gloss ? { gloss } : undefined })),
        ...children,
      );
    const empty = (ic: Parameters<typeof icon>[0], text: string) =>
      h('div', { class: 'an-empty' }, icon(ic, 18), h('span', { text }));

    // -- Último disparo --------------------------------------------------------
    this.missBig = h('span', { class: 'an-miss__v num', testid: 'an-miss' });
    this.missSub = h('span', { class: 'an-miss__sub num' });
    this.missBox = h('div', { class: 'an-miss' },
      h('span', { class: 'ua-eyebrow', text: 'Fallo al objetivo' }),
      this.missBig,
      this.missSub,
    );
    this.diagram = document.createElement('canvas');
    this.diagram.width = 132 * DPR;
    this.diagram.height = 132 * DPR;
    this.diagram.className = 'an-diagram';
    this.diagram.dataset.testid = 'impact-diagram';
    this.shotMeta = h('div', { class: 'an-meta' });
    for (const [k, label, gloss] of [
      ['range', 'Alcance', 'alcance'], ['tof', 'Tiempo de vuelo', 'tof'], ['fall', 'Ángulo de caída', 'caida'],
      ['speed', 'Vel. impacto', null], ['energy', 'Energía impacto', null], ['mach', 'Mach máx.', 'mach'],
      ['apex', 'Ápice', 'apice'], ['det', 'Detonación', 'espoleta'],
    ] as const) {
      this.r[k] = new Readout(label, { size: 's', gloss: gloss ?? undefined });
    }
    this.shotEmpty = empty('impact', 'Aún no hay disparos. Pulsa FUEGO: aquí verás el informe del impacto.');
    this.shotBody = h('div', { class: 'an-shot' },
      h('div', { class: 'an-shot__top' }, this.missBox, this.diagram),
      this.shotMeta,
      h('div', { class: 'an-grid' }, ...Object.values(this.r).map((x) => x.el)),
    );
    this.shotBody.hidden = true;

    // -- PER ------------------------------------------------------------------------
    for (const [k, label, gloss] of [
      ['sr', 'σ alcance', 'per'], ['sc', 'σ dirección', 'per'], ['epr', 'EP alcance', 'per'],
      ['epc', 'EP dirección', 'per'], ['cep', 'CEP aprox.', 'cep'], ['rng', 'Alcance', 'alcance'],
    ] as const) {
      this.p[k] = new Readout(label, { size: 's', gloss, tone: k === 'cep' ? 'info' : 'plain' });
    }
    this.perEmpty = empty('ellipse', 'Designa un objetivo: se predice la elipse de error (1σ/2σ) con σ V0 0.3 %, puntería 1 mil y viento no medido 0.6 m/s.');
    this.perBody = h('div', { class: 'an-grid an-grid--3' }, ...Object.values(this.p).map((x) => x.el));
    this.perBody.hidden = true;

    // -- Salva ------------------------------------------------------------------------
    for (const [k, label, gloss] of [
      ['n', 'Impactos', null], ['cep', 'CEP medido', 'cep'], ['mpi', 'PMI al objetivo', null],
    ] as const) {
      this.s[k] = new Readout(label, { size: 's', gloss: gloss ?? undefined, tone: k === 'cep' ? 'info' : 'plain' });
    }
    this.salvoEmpty = empty('salvo', 'Lanza una salva ×6: los cráteres dibujan la dispersión real y aquí se mide.');
    this.salvoBody = h('div', { class: 'an-grid an-grid--3' }, ...Object.values(this.s).map((x) => x.el));
    this.salvoBody.hidden = true;

    // -- Comparar ---------------------------------------------------------------------
    this.cmpEmpty = empty('compare', 'Pulsa "Comparar": el mismo tiro en vacío, con arrastre, con Coriolis y con viento.');
    this.cmpBody = h('div', { class: 'an-cmp', testid: 'compare-legend' });
    this.cmpBody.hidden = true;

    host.append(
      RightDock.header('Análisis del tiro'),
      h('div', { class: 'rpanel-body' },
        section('Último disparo', null, this.shotEmpty, this.shotBody),
        section('Dispersión prevista (PER)', 'per', this.perEmpty, this.perBody),
        section('Salva dispersa', 'cep', this.salvoEmpty, this.salvoBody),
        section('Comparar físicas', null, this.cmpEmpty, this.cmpBody),
      ),
    );
    settings.subscribe((_s, changed) => {
      if (changed.includes('angleUnit') && this.shot) this.setShot(this.shot);
    });
  }

  setShot(r: ShotReport): void {
    this.shot = r;
    this.shotEmpty.hidden = true;
    this.shotBody.hidden = false;
    const unit = settings.angleUnit;
    if (r.miss) {
      const grade = missGrade(r.miss.missM);
      this.missBox.dataset.grade = grade;
      setText(this.missBig, `${fmtNum(r.miss.missM, 0)} m`);
      const long = r.miss.rangeM >= 0 ? 'largo' : 'corto';
      const right = r.miss.deflM >= 0 ? 'derecha' : 'izquierda';
      setText(this.missSub, `${fmtNum(Math.abs(r.miss.rangeM), 0)} m ${long} · ${fmtNum(Math.abs(r.miss.deflM), 0)} m ${right}`);
    } else {
      this.missBox.dataset.grade = 'none';
      setText(this.missBig, 'Sin objetivo');
      setText(this.missSub, 'Designa un objetivo para medir el fallo');
    }
    this.shotMeta.textContent = '';
    append(this.shotMeta,
      h('span', { class: 'an-meta__w', text: r.weaponName }),
      h('span', { class: 'ua-muted', text: ` · ${r.roundName} · espoleta ${r.fuzeLabel.toLowerCase()}` }),
      r.guided ? h('span', { class: 'an-tag', text: 'Guiado' }) : null,
      r.segments > 1 ? h('span', { class: 'an-tag', text: `${r.segments - 1} rebote${r.segments > 2 ? 's' : ''}` }) : null,
    );
    const d = distanceParts(r.rangeM);
    this.r.range.set(d.value, d.unit);
    this.r.tof.set(r.tofS.toFixed(1), 's');
    this.r.fall.set(fmtAngleValue(r.angleOfFallDeg, unit, unit === 'mil' ? 0 : 1), UNIT_SUFFIX[unit]);
    this.r.speed.set(fmtNum(r.impactSpeedMS, 0), 'm/s');
    const e = fmtEnergy(r.impactEnergyJ).split(' ');
    this.r.energy.set(e[0], e[1] ?? '');
    this.r.mach.set(r.maxMach.toFixed(2));
    const a = distanceParts(r.apexM);
    this.r.apex.set(a.value, a.unit);
    this.r.det.set(DETONATION[r.detonation], '', r.detonation === 'air' ? `a ${r.burstHeightM.toFixed(0)} m` : '');
    this.drawDiagram(r);
  }

  /** Dispersión prevista (null = sin objetivo). */
  setPrediction(p: PredictionReport | null): void {
    this.pred = p;
    this.perEmpty.hidden = !!p;
    this.perBody.hidden = !p;
    if (!p) return;
    this.p.sr.set(fmtNum(p.sigmaRangeM, 0), 'm');
    this.p.sc.set(fmtNum(p.sigmaCrossM, 0), 'm');
    this.p.epr.set(fmtNum(probableError(p.sigmaRangeM), 0), 'm');
    this.p.epc.set(fmtNum(probableError(p.sigmaCrossM), 0), 'm');
    this.p.cep.set(fmtNum(cepFromSigmas(p.sigmaRangeM, p.sigmaCrossM), 0), 'm');
    const d = distanceParts(p.rangeM);
    this.p.rng.set(d.value, d.unit);
    if (this.shot) this.drawDiagram(this.shot);
  }

  setSalvo(r: SalvoReport): void {
    this.salvoEmpty.hidden = true;
    this.salvoBody.hidden = false;
    this.s.n.set(String(r.rounds));
    this.s.cep.set(fmtNum(r.cepM, 0), 'm');
    if (r.mpiMiss) {
      this.s.mpi.set(fmtNum(r.mpiMiss.missM, 0), 'm',
        `${fmtNum(Math.abs(r.mpiMiss.rangeM), 0)} ${r.mpiMiss.rangeM >= 0 ? 'L' : 'C'} · ${fmtNum(Math.abs(r.mpiMiss.deflM), 0)} ${r.mpiMiss.deflM >= 0 ? 'D' : 'I'}`);
    } else {
      this.s.mpi.set('—', '', 'sin objetivo');
    }
  }

  setCompare(r: CompareReport): void {
    this.cmpEmpty.hidden = true;
    this.cmpBody.hidden = false;
    this.cmpBody.textContent = '';
    const vac = r.entries[0]?.rangeM ?? 0;
    for (const e of r.entries) {
      const d = distanceParts(e.rangeM);
      const delta = vac > 0 ? ((e.rangeM - vac) / vac) * 100 : 0;
      this.cmpBody.appendChild(
        h('div', { class: 'an-cmp__row' },
          h('span', { class: 'an-cmp__sw', style: { background: e.cssColor } }),
          h('span', { class: 'an-cmp__label', text: e.label }),
          h('span', { class: 'an-cmp__v num', text: `${d.value} ${d.unit}` }),
          h('span', { class: 'an-cmp__d num', text: e === r.entries[0] ? 'ref.' : `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} %` }),
        ),
      );
    }
  }

  /** Diagrama de impacto: objetivo al centro, línea de tiro hacia arriba
   *  (arriba = LARGO, derecha = DERECHA), anillos 25/75/150 m y elipse PER. */
  private drawDiagram(r: ShotReport): void {
    const ctx = this.diagram.getContext('2d')!;
    const S = this.diagram.width;
    const c = S / 2;
    ctx.clearRect(0, 0, S, S);
    const ref = r.miss ? Math.max(160, Math.abs(r.miss.rangeM) * 1.25, Math.abs(r.miss.deflM) * 1.25) : 160;
    const k = (S / 2 - 8 * DPR) / ref;
    ctx.fillStyle = 'rgba(5,8,12,0.85)';
    ctx.strokeStyle = 'rgba(148,163,184,0.22)';
    ctx.lineWidth = DPR;
    ctx.beginPath();
    ctx.arc(c, c, S / 2 - 2 * DPR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Anillos de referencia.
    ctx.font = `500 ${8 * DPR}px "JetBrains Mono Variable", monospace`;
    ctx.fillStyle = '#6b7785';
    ctx.textAlign = 'left';
    for (const [rad, col] of [[25, 'rgba(52,211,153,0.5)'], [75, 'rgba(251,191,36,0.4)'], [150, 'rgba(244,63,94,0.35)']] as const) {
      if (rad * k > S / 2 - 4 * DPR) continue;
      ctx.strokeStyle = col;
      ctx.setLineDash([3 * DPR, 3 * DPR]);
      ctx.beginPath();
      ctx.arc(c, c, rad * k, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(`${rad}`, c + rad * k * 0.71 + 2 * DPR, c - rad * k * 0.71);
    }
    // Ejes.
    ctx.strokeStyle = 'rgba(148,163,184,0.18)';
    ctx.beginPath();
    ctx.moveTo(c, 6 * DPR); ctx.lineTo(c, S - 6 * DPR);
    ctx.moveTo(6 * DPR, c); ctx.lineTo(S - 6 * DPR, c);
    ctx.stroke();
    ctx.fillStyle = '#a3afbb';
    ctx.textAlign = 'center';
    ctx.font = `600 ${8 * DPR}px "Barlow Condensed", sans-serif`;
    ctx.fillText('LARGO', c, 14 * DPR);
    ctx.fillText('CORTO', c, S - 8 * DPR);
    // Elipse PER (1σ) prevista.
    if (this.pred) {
      ctx.strokeStyle = 'rgba(56,189,248,0.6)';
      ctx.beginPath();
      ctx.ellipse(c, c, this.pred.sigmaCrossM * k, this.pred.sigmaRangeM * k, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Objetivo (rombo hostil).
    const tr = 5 * DPR;
    ctx.strokeStyle = '#ff4d4f';
    ctx.lineWidth = 1.6 * DPR;
    ctx.beginPath();
    ctx.moveTo(c, c - tr); ctx.lineTo(c + tr, c); ctx.lineTo(c, c + tr); ctx.lineTo(c - tr, c);
    ctx.closePath();
    ctx.stroke();
    // Impacto.
    if (r.miss) {
      const x = c + r.miss.deflM * k;
      const y = c - r.miss.rangeM * k;
      ctx.fillStyle = '#f5a524';
      ctx.shadowColor = 'rgba(245,165,36,0.8)';
      ctx.shadowBlur = 6 * DPR;
      ctx.beginPath();
      ctx.arc(x, y, 3.6 * DPR, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
}
