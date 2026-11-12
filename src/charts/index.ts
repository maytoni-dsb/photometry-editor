/** Графики: построение сцены и рендеры SVG / PDF / EPS. Без интерфейса — работает в браузере и в Node. */

export * from './scene';
export * from './style';
export * from './series';
export * from './labels';
export { buildPolar } from './polar';
export { buildLinear } from './linear';
export { renderSvg, escapeXml, type SvgOptions } from './render-svg';
export { renderPdf, type VectorExportOptions } from './render-pdf';
export { renderEps } from './render-eps';
export { fontMeasure, openFont, isCff, type FontSet } from './fonts';
export type { ColorMode } from './vector';
