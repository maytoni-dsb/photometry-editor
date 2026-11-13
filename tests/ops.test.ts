/**
 * Этап 4: операции над телами.
 * Приёмка по ТЗ: поток и максимум силы света совпадают с ручным расчётом;
 * сложение двух копий одного тела даёт удвоенный поток.
 */

import { describe, expect, it } from 'vitest';
import {
  applyOp,
  computeFlux,
  diffIntensity,
  intensityC,
  mirror,
  normalize,
  OpError,
  parseIES,
  parseLDT,
  peak,
  regrid,
  rotate,
  rotatedDirection,
  sumBodies,
  summarize,
  symmetrize,
  writeIES,
  writeLDT,
  type Photometry,
} from '../src/core/index';
import { asym, lambert, makeC, symC0, symC90, symQuad } from './helpers';

const flux = (p: Photometry) => computeFlux(p).total;
const PI1000 = Math.PI * 1000; // поток ламбертовского источника I0 = 1000 кд

/** Узкий пучок, ось которого направлена в (c0, g0): I = 1000·cos⁸(угол до оси). */
function beam(c0: number, g0: number) {
  const r = Math.PI / 180;
  const ax = [Math.sin(g0 * r) * Math.cos(c0 * r), Math.sin(g0 * r) * Math.sin(c0 * r), -Math.cos(g0 * r)];
  return (c: number, g: number) => {
    const d = [Math.sin(g * r) * Math.cos(c * r), Math.sin(g * r) * Math.sin(c * r), -Math.cos(g * r)];
    const cos = Math.max(0, d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2]);
    return 1000 * cos ** 8;
  };
}

describe('нормировка', () => {
  const p = makeC(asym, { cStep: 5, gStep: 1, flux: 2000 });

  it('к заданному потоку: расчётный поток = заданному, кд/клм и форма не меняются', () => {
    const r = normalize(p, 'flux', 1500).photometry;
    expect(flux(r)).toBeCloseTo(1500, 6);
    const k = 1500 / flux(p);
    expect(r.lamps[0].flux).toBeCloseTo(2000 * k, 6);
    expect(peak(r).value).toBeCloseTo(peak(p).value * k, 6);
    // кд/клм те же
    expect((peak(r).value * 1000) / r.lamps[0].flux!).toBeCloseTo((peak(p).value * 1000) / 2000, 6);
  });

  it('к 1000 лм: силы света в кд равны кд/клм', () => {
    const r = normalize(p, 'cdklm').photometry;
    expect(r.lamps[0].flux).toBeCloseTo(1000, 9);
    expect(r.candela[3][10]).toBeCloseTo((p.candela[3][10] * 1000) / 2000, 9);
  });

  it('к 1000 лм для абсолютной без потока — по расчётному потоку', () => {
    const a = makeC(lambert, { cStep: 10, gStep: 1 });
    const r = normalize(a, 'cdklm').photometry;
    expect(flux(r)).toBeCloseTo(1000, 6);
    expect(r.lamps[0].flux).toBeNull();
  });

  it('к максимальной силе света и умножение на коэффициент', () => {
    expect(peak(normalize(p, 'peak', 500).photometry).value).toBeCloseTo(500, 9);
    const r = normalize(p, 'factor', 2).photometry;
    expect(flux(r)).toBeCloseTo(2 * flux(p), 6);
    expect(r.lamps[0].flux).toBeCloseTo(4000, 9);
  });

  it('неверные параметры — ошибка с кодом', () => {
    expect(() => normalize(p, 'flux', -5)).toThrow(OpError);
    expect(() => normalize(makeC(() => 0, { symmetry: 'axial' }), 'flux', 100)).toThrow(OpError);
  });

  it('исходная модель не меняется', () => {
    const before = JSON.stringify(p);
    normalize(p, 'factor', 3);
    rotate(p, 'x', 30);
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe('отражение', () => {
  it('относительно C0–C180: I\'(C) = I(−C), поток тот же', () => {
    const p = makeC(asym, { cStep: 15, gStep: 5 });
    const r = mirror(p, 'c0c180').photometry;
    expect(intensityC(r, 30, 20)).toBeCloseTo(asym(330, 20), 9);
    expect(intensityC(r, 330, 20)).toBeCloseTo(asym(30, 20), 9);
    expect(flux(r)).toBeCloseTo(flux(p), 9);
    expect(peak(r).h).toBeCloseTo(330, 9);
  });

  it('относительно C90–C270: I\'(C) = I(180° − C)', () => {
    const p = makeC(asym, { cStep: 15, gStep: 5 });
    const r = mirror(p, 'c90c270').photometry;
    expect(intensityC(r, 150, 40)).toBeCloseTo(asym(30, 40), 9);
    expect(flux(r)).toBeCloseTo(flux(p), 9);
  });

  it('двойное отражение возвращает исходное тело', () => {
    const p = makeC(asym, { cStep: 15, gStep: 5 });
    for (const pl of ['c0c180', 'c90c270', 'updown'] as const) {
      const back = mirror(mirror(p, pl).photometry, pl).photometry;
      expect(diffIntensity(p, back).maxAbs).toBeLessThan(1e-9);
    }
  });

  it('симметричные тела сохраняют тип симметрии', () => {
    for (const [sym, f] of [['c0c180', symC0], ['c90c270', symC90], ['quadrant', symQuad]] as const) {
      const p = makeC(f, { symmetry: sym, cStep: 15, gStep: 5 });
      for (const pl of ['c0c180', 'c90c270'] as const) {
        const r = mirror(p, pl).photometry;
        expect(r.symmetry).toBe(sym);
        const full = makeC((c, g) => f(pl === 'c0c180' ? -c : 180 - c, g), { cStep: 15, gStep: 5 });
        expect(diffIntensity(full, r).maxAbs).toBeLessThan(1e-9);
      }
    }
  });

  it('верх / низ: потоки вниз и вверх меняются местами, сетка 0…90 расширяется до 180', () => {
    const p = makeC(lambert, { cStep: 30, gStep: 5, gMax: 90 });
    const r = mirror(p, 'updown').photometry;
    expect(r.vAngles[0]).toBe(0);
    expect(r.vAngles[r.vAngles.length - 1]).toBe(180);
    const f0 = computeFlux(p);
    const f1 = computeFlux(r);
    expect(f1.up).toBeCloseTo(f0.down, 6);
    expect(f1.down).toBeCloseTo(0, 9);
    expect(peak(r).v).toBe(180);
  });
});

describe('поворот вокруг Z', () => {
  it('угол кратен шагу — точный сдвиг плоскостей', () => {
    const p = makeC(asym, { cStep: 15, gStep: 5 });
    const r = rotate(p, 'z', 45).photometry;
    expect(intensityC(r, 75, 30)).toBeCloseTo(asym(30, 30), 9);
    expect(peak(r).h).toBeCloseTo(75, 9);
    expect(peak(r).value).toBeCloseTo(peak(p).value, 9);
    expect(flux(r)).toBeCloseTo(flux(p), 9);
  });

  it('произвольный угол — интерполяция на исходную сетку, поток сохраняется', () => {
    const p = makeC(asym, { cStep: 5, gStep: 2.5 });
    const r = rotate(p, 'z', 7).photometry;
    expect(r.hAngles).toEqual(p.hAngles);
    expect(flux(r) / flux(p)).toBeCloseTo(1, 3);
    expect(intensityC(r, 37, 30)).toBeCloseTo(asym(30, 30), 0);
  });

  it('осевая симметрия не меняется; квадрант на 90° остаётся квадрантом', () => {
    const ax = makeC(lambert, { symmetry: 'axial' });
    expect(rotate(ax, 'z', 33).photometry).toEqual(ax);
    const q = makeC(symQuad, { symmetry: 'quadrant', cStep: 15 });
    const r = rotate(q, 'z', 90).photometry;
    expect(r.symmetry).toBe('quadrant');
    expect(intensityC(r, 90, 30)).toBeCloseTo(symQuad(0, 30), 9);
    // C0–C180 на 90° становится C90–C270
    const c0 = makeC(symC0, { symmetry: 'c0c180', cStep: 15 });
    expect(rotate(c0, 'z', 90).photometry.symmetry).toBe('c90c270');
  });

  it('размеры поворачиваются', () => {
    const p = makeC(asym, { cStep: 15 });
    const r = rotate(p, 'z', 90).photometry;
    expect(r.luminous.length).toBeCloseTo(80, 9);
    expect(r.luminous.width).toBeCloseTo(580, 9);
  });
});

describe('поворот вокруг X и Y', () => {
  const down = makeC(beam(0, 0), { cStep: 5, gStep: 2.5 });

  it('X +90°: ось пучка уходит из надира в C90, γ 90°; поток и максимум сохраняются', () => {
    const r = rotate(down, 'x', 90).photometry;
    const pk = peak(r);
    expect(pk.h).toBeCloseTo(90, 6);
    expect(pk.v).toBeCloseTo(90, 6);
    expect(pk.value).toBeCloseTo(1000, 6);
    expect(flux(r) / flux(down)).toBeCloseTo(1, 3);
    expect(computeFlux(r).down / flux(r)).toBeCloseTo(0.5, 2);
  });

  it('Y +90°: ось уходит в C180, γ 90°', () => {
    const pk = peak(rotate(down, 'y', 90).photometry);
    expect(pk.h).toBeCloseTo(180, 6);
    expect(pk.v).toBeCloseTo(90, 6);
  });

  it('наклон 30° совпадает с аналитическим пучком', () => {
    const r = rotate(down, 'x', 30).photometry;
    const ref = makeC(beam(90, 30), { cStep: 5, gStep: 2.5 });
    expect(diffIntensity(ref, r).maxRelToPeak).toBeLessThan(0.01);
    expect(flux(r) / flux(ref)).toBeCloseTo(1, 2);
  });

  it('X 180°: весь свет вверх', () => {
    const r = rotate(makeC(lambert, { cStep: 15, gStep: 5 }), 'x', 180).photometry;
    const f = computeFlux(r);
    expect(f.down).toBeLessThan(1e-6 * f.total);
    expect(f.total / PI1000).toBeCloseTo(1, 2);
  });

  it('поворот и обратный поворот дают исходное тело', () => {
    // гладкое тело (у asym в полюсе разрыв — у реального светильника его нет)
    const p = makeC(beam(30, 40), { cStep: 5, gStep: 2.5 });
    const back = rotate(rotate(p, 'y', 25).photometry, 'y', -25).photometry;
    expect(diffIntensity(p, back).maxRelToPeak).toBeLessThan(0.02);
  });

  it('порядок поворотов важен; подсказка о направлении надира', () => {
    expect(rotatedDirection([{ axis: 'x', angle: 90 }])).toEqual({ c: 90, g: 90 });
    expect(rotatedDirection([{ axis: 'y', angle: 90 }]).c).toBeCloseTo(180, 9);
    const a = rotatedDirection([{ axis: 'x', angle: 30 }, { axis: 'z', angle: 90 }]);
    const b = rotatedDirection([{ axis: 'z', angle: 90 }, { axis: 'x', angle: 30 }]);
    expect(a.c).toBeCloseTo(180, 6);
    expect(b.c).toBeCloseTo(90, 6);
  });

  it('из нижней полусферы 0…90 получается полная сфера; осевое тело вокруг X — без осевой симметрии', () => {
    const ax = makeC(lambert, { symmetry: 'axial', gStep: 5, gMax: 90 });
    const r = rotate(ax, 'x', 45).photometry;
    expect(r.vAngles[r.vAngles.length - 1]).toBe(180);
    // вращение вокруг X сохраняет симметрию относительно плоскости C0–C180
    expect(['c90c270', 'c0c180', 'none']).toContain(r.symmetry);
    expect(flux(r) / PI1000).toBeCloseTo(1, 2);
  });

  it('тип B пересчитывается и поворачивается', () => {
    const ies = [
      'IESNA:LM-63-2002',
      'TILT=NONE',
      '1 -1 1 37 1 2 2 0 0 0',
      '1 1 10',
      Array.from({ length: 37 }, (_, i) => -90 + i * 5).join(' '),
      '0',
      Array.from({ length: 37 }, (_, i) => Math.round(1000 * Math.cos(((-90 + i * 5) * Math.PI) / 180) ** 4)).join(' '),
    ].join('\n');
    const b = parseIES(ies).photometry;
    expect(b.photometryType).toBe('B');
    const r = rotate(b, 'z', 0);
    expect(r.photometry.photometryType).toBe('C');
    expect(r.issues.some((i) => i.code === 'converted-type-b')).toBe(true);
  });
});

describe('симметризация и смена сетки', () => {
  const p = makeC(asym, { cStep: 5, gStep: 2.5 });

  it('осевая: среднее по C, поток сохраняется точно', () => {
    const r = symmetrize(p, 'axial').photometry;
    expect(r.symmetry).toBe('axial');
    expect(r.hAngles).toEqual([0]);
    expect(flux(r)).toBeCloseTo(flux(p), 9);
    // среднее cos(C − 30) по кругу = 0 → I = 100·cosγ
    expect(r.candela[0][0]).toBeCloseTo(100, 9);
  });

  it('C0–C180, C90–C270, квадрант: поток сохраняется, результат симметричен', () => {
    for (const s of ['c0c180', 'c90c270', 'quadrant'] as const) {
      const r = symmetrize(p, s).photometry;
      expect(r.symmetry).toBe(s);
      expect(flux(r) / flux(p)).toBeCloseTo(1, 9);
    }
    const r = symmetrize(p, 'c0c180').photometry;
    expect(intensityC(r, 30, 20)).toBeCloseTo((asym(30, 20) + asym(330, 20)) / 2, 9);
  });

  it('уже симметричное тело не меняется', () => {
    const q = makeC(symQuad, { symmetry: 'quadrant', cStep: 15 });
    expect(diffIntensity(q, symmetrize(q, 'quadrant').photometry).maxAbs).toBeLessThan(1e-9);
    const full = symmetrize(q, 'none').photometry;
    expect(full.symmetry).toBe('none');
    expect(full.hAngles.length).toBe(24);
    expect(diffIntensity(q, full).maxAbs).toBeLessThan(1e-9);
  });

  it('смена сетки: в старых узлах значения те же, поток почти тот же', () => {
    const q = makeC(asym, { cStep: 15, gStep: 5 });
    const r = regrid(q, 5, 1).photometry;
    expect(r.hAngles.length).toBe(72);
    expect(r.vAngles.length).toBe(181);
    expect(intensityC(r, 30, 40)).toBeCloseTo(intensityC(q, 30, 40), 9);
    expect(flux(r) / flux(q)).toBeCloseTo(1, 2);
  });

  it('смена сетки: обрезка до нижней полусферы и проверка шага', () => {
    const q = makeC(lambert, { symmetry: 'axial', gStep: 5 });
    const r = regrid(q, 5, 2.5, 'lower').photometry;
    expect(r.vAngles[r.vAngles.length - 1]).toBe(90);
    expect(() => regrid(makeC(asym), 7, 5)).toThrow(OpError);
    expect(() => regrid(makeC(asym), 15, 7)).toThrow(OpError);
  });
});

describe('сложение', () => {
  it('две копии одного тела — удвоенный поток и максимум (приёмка этапа 4)', () => {
    const p = makeC(asym, { cStep: 15, gStep: 5, flux: 1200 });
    const r = sumBodies([{ photometry: p, weight: 1 }, { photometry: p, weight: 1 }]).photometry;
    expect(flux(r)).toBeCloseTo(2 * flux(p), 9);
    expect(peak(r).value).toBeCloseTo(2 * peak(p).value, 9);
    expect(r.lamps[0].flux).toBeCloseTo(2400, 9);
    expect(r.inputWatts).toBeCloseTo(20, 9);
  });

  it('веса и разные сетки', () => {
    const a = makeC(lambert, { symmetry: 'axial', gStep: 5 });
    const b = makeC(asym, { cStep: 15, gStep: 2.5 });
    const res = sumBodies([{ photometry: a, weight: 0.5 }, { photometry: b, weight: 2 }]);
    const r = res.photometry;
    expect(res.issues.some((i) => i.code === 'op-sum-resampled')).toBe(true);
    expect(flux(r) / (0.5 * flux(a) + 2 * flux(b))).toBeCloseTo(1, 3);
    expect(intensityC(r, 30, 20)).toBeCloseTo(0.5 * lambert(0, 20) + 2 * asym(30, 20), 6);
  });

  it('с поворотом: вниз + вверх (X 180°) — поток поровну вниз и вверх', () => {
    const p = makeC(lambert, { cStep: 15, gStep: 5 });
    const r = sumBodies([
      { photometry: p, weight: 1 },
      { photometry: p, weight: 1, rotations: [{ axis: 'x', angle: 180 }] },
    ]).photometry;
    const f = computeFlux(r);
    expect(f.total / (2 * PI1000)).toBeCloseTo(1, 2);
    expect(f.down / f.up).toBeCloseTo(1, 2);
  });

  it('смещения расширяют светящие размеры', () => {
    const p = makeC(lambert, { cStep: 15, gStep: 5 });
    const res = sumBodies([
      { photometry: p, weight: 1, offset: { x: -500, y: 0, z: 0 } },
      { photometry: p, weight: 1, offset: { x: 500, y: 0, z: 0 } },
    ]);
    expect(res.photometry.luminous.length).toBeCloseTo(1580, 9);
    expect(res.photometry.luminous.width).toBeCloseTo(80, 9);
    expect(res.issues.some((i) => i.code === 'op-sum-offsets')).toBe(true);
  });
});

describe('паспортные значения LDT после операции', () => {
  it('КПД и доля вниз пересчитываются', () => {
    const p = makeC(lambert, { cStep: 15, gStep: 5, flux: 5000 });
    const ldt = parseLDT(writeLDT(p).text).photometry;
    const r = applyOp(ldt, { op: 'mirror', plane: 'updown' }).photometry;
    expect(r.ldt!.dff).toBeCloseTo(0, 6);
    expect(r.ldt!.lorl).toBeCloseTo((flux(r) / 5000) * 100, 6);
  });
});

describe('результат операций записывается в IES и LDT', () => {
  const p = makeC(asym, { cStep: 15, gStep: 5, flux: 1000 });
  const results = [
    applyOp(p, { op: 'normalize', mode: 'flux', value: 3000 }),
    applyOp(p, { op: 'mirror', plane: 'updown' }),
    applyOp(p, { op: 'rotate', axis: 'x', angle: 20 }),
    applyOp(p, { op: 'rotate', axis: 'z', angle: 10 }),
    applyOp(p, { op: 'symmetrize', symmetry: 'quadrant' }),
    applyOp(p, { op: 'regrid', cStep: 5, gStep: 2.5 }),
  ];
  results.forEach(({ photometry: r }, i) => {
    it(`шаг ${i + 1}`, () => {
      const ies = parseIES(writeIES(r)).photometry;
      expect(diffIntensity(r, ies).maxRelToPeak).toBeLessThan(1e-3);
      const ldt = parseLDT(writeLDT(r).text).photometry;
      expect(diffIntensity(r, ldt).maxRelToPeak).toBeLessThan(1e-3);
      expect(summarize(ldt).flux.total / flux(r)).toBeCloseTo(1, 3);
    });
  });
});

describe('сглаживание', () => {
  // детерминированный «шум» измерения ±5 %
  const noise = (c: number, g: number) => 1 + 0.05 * Math.sin(c * 12.9898 + g * 78.233) * Math.cos(c * 4.1414 + g * 1.7);
  const smoothBody = (c: number, g: number) => beam(30, 20)(c, g) + 50;

  it('постоянное поле не меняется', () => {
    const p = makeC(() => 100, { cStep: 15, gStep: 5 });
    const r = applyOp(p, { op: 'smooth', width: 10 }).photometry;
    for (const row of r.candela) for (const x of row) expect(x).toBeCloseTo(100, 6);
  });

  it('шум уменьшается, поток сохраняется, форма почти та же', () => {
    const clean = makeC(smoothBody, { cStep: 5, gStep: 2.5 });
    const noisy = makeC((c, g) => smoothBody(c, g) * noise(c, g), { cStep: 5, gStep: 2.5 });
    const r = applyOp(noisy, { op: 'smooth', width: 6 }).photometry;
    expect(flux(r)).toBeCloseTo(flux(noisy), 6);
    const errBefore = diffIntensity(clean, noisy).maxRelToPeak;
    const errAfter = diffIntensity(clean, r).maxRelToPeak;
    expect(errAfter).toBeLessThan(errBefore * 0.6);
  });

  it('пик понижается тем сильнее, чем шире ядро; ось пучка на месте', () => {
    const p = makeC(beam(0, 0), { cStep: 5, gStep: 2.5 });
    const a = peak(applyOp(p, { op: 'smooth', width: 5 }).photometry);
    const b = peak(applyOp(p, { op: 'smooth', width: 15 }).photometry);
    expect(a.value).toBeLessThan(1000);
    expect(b.value).toBeLessThan(a.value);
    expect(b.v).toBe(0);
  });

  it('симметрия и сетка сохраняются; осевое остаётся осевым', () => {
    const q = makeC(symQuad, { symmetry: 'quadrant', cStep: 15, gStep: 5 });
    const r = applyOp(q, { op: 'smooth', width: 8 }).photometry;
    expect(r.symmetry).toBe('quadrant');
    expect(r.hAngles).toEqual(q.hAngles);
    const full = makeC(symQuad, { cStep: 15, gStep: 5 });
    const rf = applyOp(full, { op: 'smooth', width: 8 }).photometry;
    expect(diffIntensity(rf, r).maxRelToPeak).toBeLessThan(1e-9);
    const ax = applyOp(makeC(lambert, { symmetry: 'axial', gStep: 5 }), { op: 'smooth', width: 8 }).photometry;
    expect(ax.symmetry).toBe('axial');
    expect(flux(ax) / PI1000).toBeCloseTo(1, 2);
  });

  it('узкое ядро (меньше шага сетки) почти ничего не меняет; без сохранения потока — поток свой', () => {
    const p = makeC(beam(30, 40), { cStep: 15, gStep: 5 });
    const r = applyOp(p, { op: 'smooth', width: 1 }).photometry;
    expect(diffIntensity(p, r).maxRelToPeak).toBeLessThan(1e-6);
    const k = applyOp(makeC(beam(0, 0), { cStep: 5, gStep: 2.5 }), { op: 'smooth', width: 10, keepFlux: false }).photometry;
    expect(Math.abs(flux(k) / flux(makeC(beam(0, 0), { cStep: 5, gStep: 2.5 })) - 1)).toBeLessThan(0.02);
    expect(() => applyOp(p, { op: 'smooth', width: 0 })).toThrow(OpError);
    expect(() => applyOp(p, { op: 'smooth', width: 45 })).toThrow(OpError);
  });

  it('скорость: сетка 2,5° × 1°, ширина 10° — быстро', () => {
    const p = makeC(beam(30, 20), { cStep: 2.5, gStep: 1 });
    const t0 = performance.now();
    applyOp(p, { op: 'smooth', width: 10 });
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
