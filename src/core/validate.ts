/**
 * Проверка фотометрии: дефекты данных и метаданных.
 * Замечания парсера (число значений, симметрия, Ityp…) выдают сами парсеры;
 * здесь — проверки уже прочитанной модели.
 */

import { peak } from './angles';
import { diffIntensity } from './compare';
import { computeFlux } from './flux';
import { issue, type Issue } from './issues';
import type { Photometry } from './model';
import { typeBToC } from './typeb';

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Имя файла без расширения и без суффикса варианта « @ 3000K». */
export function articleFromFileName(fileName: string): { base: string; withoutVariant: string } {
  const name = fileName.replace(/^.*[\\/]/, '').replace(/\.(ies|ldt)$/i, '');
  return { base: name, withoutVariant: name.replace(/\s*@.*$/, '') };
}

function sameArticle(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function checkArticle(p: Photometry, fileName: string): Issue[] {
  const { base, withoutVariant } = articleFromFileName(fileName);
  const matches = (s: string) => !!s && (sameArticle(s, base) || sameArticle(s, withoutVariant));
  const article = p.meta.article.trim();
  const name = p.meta.luminaireName.trim();
  if (matches(article)) return [];
  if (matches(name)) return [issue('article-swapped', 'warning', { article: name, other: article })];
  if (!article) return [issue('article-missing', 'warning')];
  return [issue('article-mismatch', 'info', { article, file: base })];
}

export interface ValidateOptions {
  /** Имя файла — для проверки артикула. */
  fileName?: string;
  /** Порог расхождения заявленного и рассчитанного потока, доля (по умолчанию 0.03). */
  fluxTolerance?: number;
}

export function validatePhotometry(p: Photometry, opts: ValidateOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const pk = peak(p).value;

  let negatives = 0;
  for (const row of p.candela) for (const x of row) if (x < 0) negatives++;
  if (negatives) issues.push(issue('negative-candela', 'error', { count: negatives }));

  if (p.photometryType === 'C' && pk > 0) {
    const v = p.vAngles;
    const planes = p.candela;
    const spread = (j: number) => {
      const vals = planes.map((r) => r[j]);
      const mx = Math.max(...vals);
      const mn = Math.min(...vals);
      return { abs: mx - mn, rel: mx > 0 ? (mx - mn) / mx : 0 };
    };
    if (planes.length > 1 && v[0] === 0) {
      const s = spread(0);
      if (s.rel > 0.05 && s.abs > 0.01 * pk) issues.push(issue('pole-spread-nadir', 'warning', { percent: round1(s.rel * 100) }));
    }
    if (planes.length > 1 && v[v.length - 1] === 180) {
      const s = spread(v.length - 1);
      if (s.rel > 0.05 && s.abs > 0.01 * pk) issues.push(issue('pole-spread-zenith', 'warning', { percent: round1(s.rel * 100) }));
    }
    if (v[v.length - 1] === 90) {
      const top = Math.max(...planes.map((r) => r[r.length - 1]));
      if (top > 0.02 * pk) issues.push(issue('truncated-at-90', 'warning', { percent: round1((top / pk) * 100) }));
    }
    const stated = p.absolute ? p.lamps[0]?.flux : null;
    if (stated && stated > 0) {
      const computed = computeFlux(p).total;
      const d = Math.abs(computed - stated) / stated;
      if (d > (opts.fluxTolerance ?? 0.03)) {
        issues.push(issue('flux-mismatch', 'warning', { stated: round1(stated), computed: round1(computed), percent: round1(d * 100) }));
      }
    }
  }

  if (opts.fileName) issues.push(...checkArticle(p, opts.fileName));
  return issues;
}

/** Приводит к типу C для сравнений. */
function asC(p: Photometry): Photometry {
  return p.photometryType === 'B' ? typeBToC(p).photometry : p;
}

function scaled(p: Photometry, k: number): Photometry {
  return { ...p, candela: p.candela.map((r) => r.map((x) => x * k)) };
}

/**
 * Сверка двух файлов одного светильника (например, пары IES и LDT).
 * Различает два случая: форма КСС та же, а масштаб (поток) разный, и разная форма.
 */
export function comparePair(a: Photometry, b: Photometry, tolerance = 0.02): Issue[] {
  const ca = asC(a);
  const cb = asC(b);
  const fa = computeFlux(ca).total;
  const fb = computeFlux(cb).total;
  const pa = peak(ca).value;
  const pb = peak(cb).value;
  const shape = fa > 0 && fb > 0 ? diffIntensity(scaled(ca, 1 / fa), scaled(cb, 1 / fb)).maxRelToPeak : 1;
  if (shape > tolerance) {
    return [issue('pair-mismatch-shape', 'error', { percent: round1(shape * 100), a: round1(fa), b: round1(fb) })];
  }
  const df = Math.abs(fa - fb) / Math.max(fa, fb, 1e-9);
  if (df > tolerance) {
    return [issue('pair-mismatch-scale', 'error', { a: round1(fa), b: round1(fb), pa: round1(pa), pb: round1(pb), percent: round1(df * 100) })];
  }
  return [];
}
