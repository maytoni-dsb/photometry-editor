/** Ядро: форматы, модель, проверки. Без интерфейса — используется и в браузере, и в тестах. */

export * from './model';
export * from './issues';
export * from './angles';
export * from './flux';
export { parseIES, writeIES, type WriteIesOptions } from './ies';
export { parseLDT, writeLDT, type WriteLdtOptions, type WriteLdtResult } from './ldt';
export { typeBToC, intensityB, cgToHV } from './typeb';
export { diffIntensity, type DiffResult } from './compare';
export { validatePhotometry, comparePair, checkArticle, articleFromFileName } from './validate';

import { parseIES } from './ies';
import { parseLDT } from './ldt';
import type { ParseResult } from './model';

/** Читает файл по расширению или содержимому. */
export function parseFile(bytes: Uint8Array, fileName: string): ParseResult {
  if (/\.ldt$/i.test(fileName)) return parseLDT(bytes, fileName);
  if (/\.ies$/i.test(fileName)) return parseIES(bytes, fileName);
  const head = new TextDecoder().decode(bytes.slice(0, 200));
  return /IESNA|TILT=/i.test(head) ? parseIES(bytes, fileName) : parseLDT(bytes, fileName);
}
export { summarize, referenceFlux, type PhotometrySummary, type ReferenceFluxKind } from './summary';
export {
  applyOp,
  normalize,
  mirror,
  rotate,
  symmetrize,
  regrid,
  smooth,
  sumBodies,
  compactSymmetry,
  naturalSteps,
  rotatedDirection,
  rotationMatrix,
  OpError,
  type OpSpec,
  type OpResult,
  type SumComponent,
  type RotationStep,
  type RotationAxis,
  type NormalizeMode,
  type MirrorPlane,
  type GammaRange,
} from './ops';
