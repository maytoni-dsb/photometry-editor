/**
 * Строит полярную и линейную КСС для файлов папки и сохраняет SVG, PDF и EPS (RGB и CMYK).
 *   npm run charts -- <папка или файл> [<папка вывода>]
 * Нужен для проверки экспорта на реальных файлах и сверки с Viso / LDT Editor.
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseFile, summarize } from '../src/core/index';
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

const [input, outDir = 'reports/charts'] = process.argv.slice(2);
if (!input) {
  console.error('Использование: npm run charts -- <папка или файл> [<папка вывода>]');
  process.exit(1);
}

const files = statSync(input).isDirectory()
  ? readdirSync(input).filter((n) => /\.(ies|ldt)$/i.test(n)).map((n) => join(input, n))
  : [input];
const fonts: FontSet = {
  regular: new Uint8Array(readFileSync('public/fonts/Roboto-Regular.woff')),
  bold: new Uint8Array(readFileSync('public/fonts/Roboto-Medium.woff')),
};
const measure = fontMeasure(fonts);
const style = defaultStyle();
mkdirSync(outDir, { recursive: true });

for (const f of files) {
  const { photometry } = parseFile(new Uint8Array(readFileSync(f)), f);
  const s = summarize(photometry);
  const opts = { ...defaultChartOptions(), planes: defaultPlanes(photometry) };
  const name = basename(f).replace(/\.(ies|ldt)$/i, '');
  for (const [kind, scene] of [
    ['polar', buildPolar(photometry, s, opts, style, measure)],
    ['linear', buildLinear(photometry, s, opts, style, measure)],
  ] as const) {
    const base = join(outDir, `${name}.${kind}`);
    writeFileSync(`${base}.svg`, renderSvg(scene, { xmlDeclaration: true }));
    writeFileSync(`${base}.pdf`, await renderPdf(scene, { color: 'rgb', fonts }));
    writeFileSync(`${base}.cmyk.pdf`, await renderPdf(scene, { color: 'cmyk', fonts }));
    writeFileSync(`${base}.eps`, await renderEps(scene, { color: 'rgb', fonts }));
    writeFileSync(`${base}.cmyk.eps`, await renderEps(scene, { color: 'cmyk', fonts }));
  }
  console.log(`${name}: Φ = ${s.flux.total.toFixed(1)} лм, Imax = ${s.peak.value.toFixed(1)} кд`);
}
