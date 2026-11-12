/**
 * Единая внутренняя модель фотометрии.
 *
 * Любой формат читается в эту модель и пишется из неё; все операции работают только с ней.
 * Силы света всегда хранятся в абсолютных канделах. Исходный вид фотометрии
 * (абсолютная / относительная) и потоки ламп запоминаются, чтобы при записи
 * вернуть файл в его исходный вид.
 *
 * Система координат (тип C, как в EULUMDAT):
 *   γ = 0° — надир (вниз), γ = 180° — зенит;
 *   C = 0° — вдоль длины светильника, C = 90° — поперёк (против часовой стрелки при взгляде сверху).
 */

import type { Issue } from './issues';

/** Тип фотометрии по CIE / IES. */
export type PhotometryType = 'C' | 'B' | 'A';

/**
 * Симметрия распределения (для типа C).
 *  - none      — без симметрии, хранятся плоскости C0…C360
 *  - axial     — осевая (вращательная), хранится одна плоскость
 *  - c0c180    — симметрия относительно плоскости C0–C180, хранятся C0…C180  (LDT Isym 2)
 *  - c90c270   — симметрия относительно плоскости C90–C270, хранятся C90…C270 (LDT Isym 3)
 *  - quadrant  — симметрия относительно обеих плоскостей, хранятся C0…C90    (LDT Isym 4)
 *
 * Для типа B используется только none и bilateral (H ≥ 0, I(H) = I(−H)).
 */
export type Symmetry = 'none' | 'axial' | 'c0c180' | 'c90c270' | 'quadrant' | 'bilateral';

/** Комплект ламп (в LDT их может быть несколько, в IES — один). */
export interface LampSet {
  /** Число ламп. Отрицательное в LDT означает абсолютную фотометрию. */
  count: number;
  /**
   * Суммарный поток ламп комплекта, лм. Для абсолютной фотометрии — заявленный поток
   * светильника, если он записан в файле (LDT), иначе null.
   */
  flux: number | null;
  /** Тип / название лампы. */
  type: string;
  /** Цветовая температура, как записана (может быть «3000» или «3000K» и т. п.). */
  cct: string;
  /** Индекс цветопередачи / группа, как записана. */
  cri: string;
  /** Мощность с ПРА, Вт. */
  watts: number | null;
}

/** Размеры в миллиметрах. Для круглой формы width = 0, length = диаметр. */
export interface Dimensions {
  shape: 'rect' | 'circle' | 'point' | 'other';
  length: number;
  width: number;
  height: number;
}

/** Метаданные светильника. */
export interface Metadata {
  manufacturer: string;
  /** Название светильника / серии (IES [LUMINAIRE], LDT строка 9). */
  luminaireName: string;
  /** Артикул (IES [LUMCAT], LDT строка 10). */
  article: string;
  /** Номер протокола измерения (IES [TEST], LDT строка 8). */
  testReport: string;
  testLab: string;
  /** Дата измерения или выпуска, как записана. */
  date: string;
  issueDate: string;
  lampCatalog: string;
  /** Все ключевые слова IES в исходном порядке (включая нестандартные, напр. [_SEARCH_CRI]). */
  keywords: Array<[string, string]>;
}

/** Специфичные для LDT поля, которые нужно сохранить при обратной записи. */
export interface LdtExtras {
  ityp: number;
  /** Высоты светящей части в плоскостях C0, C90, C180, C270, мм. */
  luminousHeights: [number, number, number, number];
  /** Доля потока в нижнюю полусферу, % (как записано). */
  dff: number;
  /** КПД светильника, % (как записано). */
  lorl: number;
  /** Коэффициент пересчёта сил света. */
  conversionFactor: number;
  /** Наклон светильника при измерении, °. */
  measurementTilt: number;
  /** Прямые коэффициенты использования для k = 0.6 … 5 (10 значений). */
  directRatios: number[];
  /** Строка 11 (имя файла), строка 12 (дата / пользователь). */
  fileNameField: string;
  dateUser: string;
}

/** Специфичные для IES поля. */
export interface IesExtras {
  /** Строка версии, например «IESNA:LM-63-2002». Пусто для LM-63-1986. */
  versionLine: string;
  /** TILT: NONE, INCLUDE или имя файла. */
  tilt: string;
  /** Данные TILT=INCLUDE, если были. */
  tiltData?: { geometry: number; angles: number[]; factors: number[] };
  /** Множитель сил света из файла (уже применён к candela). */
  multiplier: number;
  ballastFactor: number;
  /** Второе значение строки балласта: «future use» (2002) или тип генерации файла (2019). */
  fileGenerationType: number;
  /** Исходные единицы размеров: 1 — футы, 2 — метры. */
  units: 1 | 2;
}

export interface SourceInfo {
  format: 'IES' | 'LDT' | 'none';
  fileName: string;
  /** Обнаруженная кодировка исходного файла. */
  encoding: string;
  lineEnding: 'LF' | 'CRLF';
}

export interface Photometry {
  photometryType: PhotometryType;
  symmetry: Symmetry;
  /** Углы хранимых плоскостей: C для типа C, H (горизонтальные) для типа B; по возрастанию. */
  hAngles: number[];
  /** Углы в плоскости: γ для типа C, V (вертикальные) для типа B; по возрастанию. */
  vAngles: number[];
  /** Силы света, кд: candela[iH][iV]. */
  candela: number[][];

  /** Была ли фотометрия в исходном файле абсолютной. */
  absolute: boolean;
  lamps: LampSet[];
  /** Мощность светильника, Вт (IES input watts / мощность первого комплекта LDT). */
  inputWatts: number | null;

  luminaire: Dimensions;
  luminous: Dimensions;
  meta: Metadata;

  ldt?: LdtExtras;
  ies?: IesExtras;
  source: SourceInfo;
}

/** Результат чтения: модель + замечания парсера. */
export interface ParseResult {
  photometry: Photometry;
  issues: Issue[];
}

export function emptyMetadata(): Metadata {
  return {
    manufacturer: '',
    luminaireName: '',
    article: '',
    testReport: '',
    testLab: '',
    date: '',
    issueDate: '',
    lampCatalog: '',
    keywords: [],
  };
}

export function emptyDimensions(): Dimensions {
  return { shape: 'point', length: 0, width: 0, height: 0 };
}

/** Глубокая копия модели (операции не меняют исходник). */
export function clonePhotometry(p: Photometry): Photometry {
  return structuredClone(p);
}

/**
 * Поток ламп (лм), к которому относятся силы света, для относительной фотометрии, иначе null.
 * Это первый комплект: в LDT остальные комплекты — альтернативные лампы.
 */
export function totalLampFlux(p: Photometry): number | null {
  if (p.absolute) return null;
  const f = p.lamps[0]?.flux;
  return f != null && f > 0 ? f : null;
}
