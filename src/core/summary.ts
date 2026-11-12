/**
 * Сводные параметры фотометрии для паспорта и графиков:
 * поток (расчётный), базовый поток для кд/клм, максимум силы света, светоотдача.
 */

import { peak } from './angles';
import { computeFlux, type FluxResult } from './flux';
import type { Photometry } from './model';
import { typeBToC } from './typeb';

/** Откуда взят поток, к которому приводятся кд/клм. */
export type ReferenceFluxKind = 'lamp' | 'stated' | 'computed';

export interface PhotometrySummary {
  /** Фотометрия типа C (для типа B — пересчитанная), по ней строятся графики и расчёты. */
  asC: Photometry;
  /** Расчётный поток по данным, лм. */
  flux: FluxResult;
  /** Поток, к которому приводятся кд/клм, лм. */
  referenceFlux: number;
  referenceKind: ReferenceFluxKind;
  /** Максимальная сила света, кд, и её направление в системе C-γ. */
  peak: { value: number; c: number; g: number };
  /** Светоотдача по расчётному потоку и мощности светильника, лм/Вт. */
  efficacy: number | null;
  /** КПД светильника по данным (только для относительной фотометрии), %. */
  lor: number | null;
  /** Доля потока вниз, %. */
  dlor: number;
  /** Самый большой угол γ в данных. */
  gMax: number;
}

/**
 * Поток для пересчёта в кд/клм — так же, как его понимают LDT-редакторы:
 *  - относительная фотометрия: поток ламп (первого комплекта);
 *  - абсолютная с заявленным потоком (LDT): заявленный поток светильника;
 *  - абсолютная без потока (IES lumens = −1): расчётный поток.
 */
export function referenceFlux(p: Photometry, computed: number): { value: number; kind: ReferenceFluxKind } {
  const f = p.lamps[0]?.flux;
  if (f != null && f > 0) return { value: f, kind: p.absolute ? 'stated' : 'lamp' };
  return { value: computed > 0 ? computed : 1000, kind: 'computed' };
}

export function summarize(p: Photometry): PhotometrySummary {
  const asC = p.photometryType === 'B' ? typeBToC(p).photometry : p;
  const flux = computeFlux(asC);
  const ref = referenceFlux(p, flux.total);
  const pk = peak(asC);
  const watts = p.inputWatts ?? p.lamps[0]?.watts ?? null;
  const lampFlux = !p.absolute ? p.lamps[0]?.flux : null;
  return {
    asC,
    flux,
    referenceFlux: ref.value,
    referenceKind: ref.kind,
    peak: { value: pk.value, c: pk.h, g: pk.v },
    efficacy: watts && watts > 0 ? flux.total / watts : null,
    lor: lampFlux && lampFlux > 0 ? (flux.total / lampFlux) * 100 : null,
    dlor: flux.total > 0 ? (flux.down / flux.total) * 100 : 0,
    gMax: asC.vAngles[asC.vAngles.length - 1] ?? 0,
  };
}
