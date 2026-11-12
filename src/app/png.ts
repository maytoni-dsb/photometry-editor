/**
 * PNG графика: SVG той же сцены (текст кривыми — картинка SVG не видит шрифты страницы)
 * рисуется на холсте с нужным разрешением. Фон — из стиля, иначе белый.
 */

import type { FontSet } from '../charts/fonts';
import { renderSvg } from '../charts/render-svg';
import type { Scene } from '../charts/scene';

const WHITE = { rgb: [255, 255, 255] as [number, number, number], cmyk: [0, 0, 0, 0] as [number, number, number, number] };

export async function renderPng(scene: Scene, fonts: FontSet, dpi: number): Promise<Blob> {
  const svg = renderSvg(scene, { textAsPaths: fonts, background: WHITE });
  const w = Math.max(1, Math.round((scene.width / 25.4) * dpi));
  const h = Math.max(1, Math.round((scene.height / 25.4) * dpi));
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image(w, h);
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('canvas 2d');
    g.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
