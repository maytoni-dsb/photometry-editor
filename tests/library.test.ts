/**
 * Прогон по реальной библиотеке файлов. Файлы заказчика в репозиторий не входят,
 * поэтому тест запускается, только если задана папка:
 *
 *   PHOTOMETRY_LIBRARY=/путь/к/папке npm test
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffIntensity, parseFile, parseIES, parseLDT, typeBToC, writeIES, writeLDT } from '../src/core/index';

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
});
