import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseFile, summarize } from '../src/core/index';
import { buildPolar, catalogStyle, defaultChartOptions, fontMeasure, renderPdf, renderSvg, CATALOG_WIDTH } from '../src/charts/index';
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const fonts = { regular: new Uint8Array(readFileSync('public/fonts/Roboto-Regular.woff')), bold: new Uint8Array(readFileSync('public/fonts/Roboto-Medium.woff')) };
for (const n of process.argv.slice(3)) {
  const f = `private-data/library/library/${n}.ldt`;
  const { photometry: p } = parseFile(new Uint8Array(readFileSync(f)), f);
  const s = summarize(p);
  const scene = buildPolar(p, s, { ...defaultChartOptions(), layout: 'catalog', lang: 'en', width: CATALOG_WIDTH, planes: [0] }, catalogStyle(), fontMeasure(fonts));
  writeFileSync(`${out}/${n}.pdf`, await renderPdf(scene, { color: 'cmyk', fonts }));
  writeFileSync(`${out}/${n}.svg`, renderSvg(scene));
  console.log(n, scene.width.toFixed(2), scene.height.toFixed(2));
}
