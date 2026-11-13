/**
 * Рецепт — сохраняемая цепочка операций над телом (этап 5).
 *
 * Шаг рецепта — то же описание OpSpec, что у операций этапа 4 и в истории файла.
 * Рецепт хранится в браузере и выгружается / загружается файлом JSON:
 *   { "type": "photometry-editor/recipe", "version": 1, "name": "…", "steps": [ {op: …}, … ] }
 */

import { applyOp, OpError, type Issue, type OpSpec, type Photometry } from '../core/index';

export const RECIPE_TYPE = 'photometry-editor/recipe';

export interface Recipe {
  name: string;
  steps: OpSpec[];
}

/** Ошибка формата рецепта: code — ключ перевода batch.recipeErr.<code>. */
export class RecipeError extends Error {
  constructor(
    public code: 'not-json' | 'not-recipe' | 'bad-step',
    public params: Record<string, string | number> = {},
  ) {
    super(code);
  }
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const oneOf = <T extends string>(x: unknown, list: readonly T[]): x is T => typeof x === 'string' && (list as readonly string[]).includes(x);

/** Проверяет и нормализует один шаг. Лишние поля отбрасываются. */
export function parseStep(x: unknown, index = 0): OpSpec {
  const bad = (): never => {
    throw new RecipeError('bad-step', { n: index + 1, step: JSON.stringify(x)?.slice(0, 80) ?? String(x) });
  };
  if (!x || typeof x !== 'object') return bad();
  const s = x as Record<string, unknown>;
  switch (s.op) {
    case 'normalize':
      if (!oneOf(s.mode, ['flux', 'cdklm', 'peak', 'factor'] as const)) return bad();
      if (s.mode === 'cdklm') return { op: 'normalize', mode: 'cdklm' };
      if (!isNum(s.value) || s.value <= 0) return bad();
      return { op: 'normalize', mode: s.mode, value: s.value };
    case 'mirror':
      if (!oneOf(s.plane, ['c0c180', 'c90c270', 'updown'] as const)) return bad();
      return { op: 'mirror', plane: s.plane };
    case 'rotate':
      if (!oneOf(s.axis, ['x', 'y', 'z'] as const) || !isNum(s.angle)) return bad();
      return { op: 'rotate', axis: s.axis, angle: s.angle };
    case 'symmetrize':
      if (!oneOf(s.symmetry, ['none', 'axial', 'c0c180', 'c90c270', 'quadrant'] as const)) return bad();
      return { op: 'symmetrize', symmetry: s.symmetry };
    case 'regrid': {
      if (!isNum(s.cStep) || !isNum(s.gStep) || s.cStep <= 0 || s.gStep <= 0) return bad();
      const gRange = s.gRange == null ? undefined : oneOf(s.gRange, ['keep', 'lower', 'full'] as const) ? s.gRange : bad();
      return gRange ? { op: 'regrid', cStep: s.cStep, gStep: s.gStep, gRange } : { op: 'regrid', cStep: s.cStep, gStep: s.gStep };
    }
    case 'smooth':
      if (!isNum(s.width) || s.width <= 0 || s.width > 30) return bad();
      return s.keepFlux === false ? { op: 'smooth', width: s.width, keepFlux: false } : { op: 'smooth', width: s.width };
    default:
      return bad();
  }
}

export function recipeToJson(r: Recipe): string {
  return JSON.stringify({ type: RECIPE_TYPE, version: 1, name: r.name, steps: r.steps }, null, 2);
}

/** Читает рецепт из JSON (файл или localStorage). Принимает и голый массив шагов. */
export function recipeFromJson(text: string, fallbackName = ''): Recipe {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new RecipeError('not-json');
  }
  if (Array.isArray(data)) return { name: fallbackName, steps: data.map(parseStep) };
  const o = data as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || !Array.isArray(o.steps) || (o.type != null && o.type !== RECIPE_TYPE)) throw new RecipeError('not-recipe');
  return { name: typeof o.name === 'string' ? o.name : fallbackName, steps: o.steps.map(parseStep) };
}

export interface RecipeRun {
  photometry: Photometry;
  issues: Issue[];
}

/** Ошибка шага рецепта при обработке конкретного файла. */
export class StepError extends Error {
  constructor(
    public step: number,
    public reason: unknown,
  ) {
    super(`step ${step + 1}`);
  }
}

/** Применяет шаги по порядку. Ошибка шага — StepError с номером шага и исходной ошибкой (обычно OpError). */
export function applyRecipe(p: Photometry, steps: OpSpec[]): RecipeRun {
  let cur = p;
  const issues: Issue[] = [];
  steps.forEach((s, i) => {
    try {
      const r = applyOp(cur, s);
      cur = r.photometry;
      issues.push(...r.issues);
    } catch (e) {
      throw new StepError(i, e);
    }
  });
  // одинаковые замечания разных шагов (например, пересчёт типа B) — один раз
  const seen = new Set<string>();
  return {
    photometry: cur,
    issues: issues.filter((x) => {
      const k = x.code + JSON.stringify(x.params ?? {});
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }),
  };
}

export { OpError };
