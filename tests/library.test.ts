/**
 * Прогон по реальной библиотеке файлов. Файлы заказчика в репозиторий не входят,
 * поэтому тест запускается, только если задана папка:
 *
 *   PHOTOMETRY_LIBRARY=/путь/к/папке npm test
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildLinear,
  buildPolar,
  defaultChartOptions,
  defaultPlanes,
  defaultStyle,
  fontMeasure,
  renderEps,
  renderPdf,
  renderSvg,
  type FontSet,
} from '../src/charts/index';
import { diffIntensity, parseFile, parseIES, parseLDT, summarize, typeBToC, writeIES, writeLDT } from '../src/core/index';

const dir = process.env.PHOTOMETRY_LIBRARY;

function walk(d: string): string[] {
  return readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ies|ldt)$/i.test(n) ? [p] : [];
  });
}

describe.skipIf(!dir)('библиотека заказчика', () => {
  const files = dir ? walk(dir) : [];

  it(`все файлы читаются, запись без потерь (${files.length} файлов)`, () => {
    const failures: string[] = [];
    for (const f of files) {
      try {
        const { photometry } = parseFile(new Uint8Array(readFileSync(f)), f);
        const c = photometry.photometryType === 'B' ? typeBToC(photometry).photometry : photometry;
        const isIes = /\.ies$/i.test(f);
        const same = isIes ? parseIES(writeIES(photometry)).photometry : parseLDT(writeLDT(c).text).photometry;
        const sameC = same.photometryType === 'B' ? typeBToC(same).photometry : same;
        const other = isIes ? parseLDT(writeLDT(c).text).photometry : parseIES(writeIES(c)).photometry;
        const d1 = diffIntensity(c, sameC).maxRelToPeak;
        const d2 = diffIntensity(c, other).maxRelToPeak;
        if (d1 > 1e-4 || d2 > 1e-3) failures.push(`${f}: same ${d1.toExponential(2)}, other ${d2.toExponential(2)}`);
      } catch (e) {
        failures.push(`${f}: ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('графики строятся для всех файлов, экспорт — для каждого 50-го', async () => {
    const fonts: FontSet = {
      regular: new Uint8Array(readFileSync('public/fonts/Roboto-Regular.woff')),
      bold: new Uint8Array(readFileSync('public/fonts/Roboto-Medium.woff')),
    };
    const measure = fontMeasure(fonts);
    const style = defaultStyle();
    const failures: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        const { photometry } = parseFile(new Uint8Array(readFileSync(f)), f);
        const s = summarize(photometry);
        const opts = { ...defaultChartOptions(), planes: defaultPlanes(photometry) };
        for (const scene of [buildPolar(photometry, s, opts, style, measure), buildLinear(photometry, s, opts, style, measure)]) {
          const svg = renderSvg(scene);
          if (/NaN|undefined|Infinity/.test(svg)) failures.push(`${f}: плохие числа в SVG`);
          if (i % 50 === 0) {
            await renderPdf(scene, { color: 'cmyk', fonts });
            const eps = await renderEps(scene, { color: 'cmyk', fonts });
            if (/NaN|undefined|Infinity/.test(eps)) failures.push(`${f}: плохие числа в EPS`);
          }
        }
      } catch (e) {
        failures.push(`${f}: ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
