/**
 * Замечания парсера и проверки файлов.
 * Текст не хранится в замечании: только код и параметры, а сообщение
 * собирается на нужном языке функцией formatIssue (ru / en / de).
 */

export type Severity = 'error' | 'warning' | 'info';

export type IssueCode =
  // разбор
  | 'empty-file'
  | 'bad-number'
  | 'header-incomplete'
  | 'value-count-short'
  | 'value-count-long'
  | 'isym-all-planes'
  | 'isym-single-plane'
  | 'ldt-ityp-invalid'
  | 'ldt-isym-invalid'
  | 'lamp-count-zero'
  | 'ies-no-version'
  | 'ies-duplicate-keyword'
  | 'ies-tilt-file'
  | 'ies-tilt-include'
  | 'ies-unknown-type'
  | 'ies-irregular-horizontal'
  | 'angles-not-ascending'
  | 'angles-duplicate'
  | 'encoding-fallback'
  // проверка данных
  | 'negative-candela'
  | 'pole-spread-nadir'
  | 'pole-spread-zenith'
  | 'truncated-at-90'
  | 'flux-mismatch'
  | 'multiplier-not-one'
  | 'ldt-conversion-factor'
  | 'typeb-light-outside'
  | 'article-missing'
  | 'article-swapped'
  | 'article-mismatch'
  | 'pair-mismatch-scale'
  | 'pair-mismatch-shape'
  | 'resampled-c-planes'
  | 'converted-type-b';

export interface Issue {
  code: IssueCode;
  severity: Severity;
  params?: Record<string, string | number>;
}

export function issue(code: IssueCode, severity: Severity, params?: Record<string, string | number>): Issue {
  return params ? { code, severity, params } : { code, severity };
}

export type Lang = 'ru' | 'en' | 'de';

type Templates = Record<IssueCode, string>;

const ru: Templates = {
  'empty-file': 'Файл пустой',
  'bad-number': 'Не удалось прочитать число «{value}» ({where})',
  'header-incomplete': 'Заголовок файла неполный: {where}',
  'value-count-short': 'Значений силы света меньше, чем заявлено: {found} вместо {expected} (файл обрезан?). Недостающие приняты за 0',
  'value-count-long': 'Значений силы света больше, чем заявлено: {found} вместо {expected}. Лишние отброшены',
  'isym-all-planes': 'Заявлена симметрия Isym {isym}, но записаны все {planes} плоскостей. Файл прочитан как несимметричный',
  'isym-single-plane': 'Isym 0, но записана одна плоскость. Файл прочитан как осесимметричный',
  'ldt-ityp-invalid': 'Недопустимый тип светильника Ityp = {value} (допустимо 0–3)',
  'ldt-isym-invalid': 'Недопустимый тип симметрии Isym = {value} (допустимо 0–4)',
  'lamp-count-zero': 'Число ламп равно 0',
  'ies-no-version': 'Нет строки версии IESNA — файл прочитан как LM-63-1986',
  'ies-duplicate-keyword': 'Ключевое слово [{keyword}] встречается несколько раз',
  'ies-tilt-file': 'TILT ссылается на внешний файл «{file}» — данные наклона не загружены',
  'ies-tilt-include': 'Файл содержит данные TILT=INCLUDE',
  'ies-unknown-type': 'Неизвестный тип фотометрии {value}',
  'ies-irregular-horizontal': 'Нестандартный диапазон горизонтальных углов {first}…{last}°',
  'angles-not-ascending': 'Углы {axis} идут не по возрастанию',
  'angles-duplicate': 'Повторяющиеся углы {axis}: {value}°',
  'encoding-fallback': 'Файл не в UTF-8, прочитан как Windows-1252',
  'negative-candela': 'Отрицательные значения силы света: {count}',
  'pole-spread-nadir': 'Сила света в надире (γ = 0°) различается между C-плоскостями на {percent}%',
  'pole-spread-zenith': 'Сила света в зените (γ = 180°) различается между C-плоскостями на {percent}%',
  'truncated-at-90': 'Измерение заканчивается на γ = 90°, но там ещё {percent}% от максимума — свет выше горизонта не измерен',
  'flux-mismatch': 'Заявленный поток {stated} лм расходится с рассчитанным {computed} лм на {percent}%',
  'multiplier-not-one': 'Множитель сил света равен {value}',
  'ldt-conversion-factor': 'Коэффициент пересчёта сил света (строка 24) равен {value} — силы света умножены на него',
  'typeb-light-outside': 'На границе измеренной области типа B ещё {percent}% от максимума — свет за её пределами потерян при пересчёте',
  'article-missing': 'Артикул не заполнен',
  'article-swapped': 'Поля перепутаны: артикул «{article}» записан в поле названия, а в поле артикула — «{other}»',
  'article-mismatch': 'Артикул в файле «{article}» не совпадает с именем файла «{file}»',
  'pair-mismatch-scale': 'Пара файлов: форма КСС совпадает, но масштаб разный — поток {a} и {b} лм, макс. сила света {pa} и {pb} кд ({percent}%)',
  'pair-mismatch-shape': 'Пара файлов: форма КСС различается, отклонение до {percent}% от максимума (поток {a} и {b} лм)',
  'resampled-c-planes': 'C-плоскости неравномерные — для LDT пересчитаны на шаг {step}°',
  'converted-type-b': 'Фотометрия типа B пересчитана в тип C (шаг C {cStep}°, γ {gStep}°)',
};

const en: Templates = {
  'empty-file': 'File is empty',
  'bad-number': 'Cannot read number "{value}" ({where})',
  'header-incomplete': 'File header is incomplete: {where}',
  'value-count-short': 'Fewer intensity values than declared: {found} instead of {expected} (truncated file?). Missing values set to 0',
  'value-count-long': 'More intensity values than declared: {found} instead of {expected}. Extra values dropped',
  'isym-all-planes': 'Symmetry Isym {isym} declared, but all {planes} planes are stored. Read as non-symmetric',
  'isym-single-plane': 'Isym 0 but only one plane stored. Read as rotationally symmetric',
  'ldt-ityp-invalid': 'Invalid luminaire type Ityp = {value} (allowed 0–3)',
  'ldt-isym-invalid': 'Invalid symmetry Isym = {value} (allowed 0–4)',
  'lamp-count-zero': 'Number of lamps is 0',
  'ies-no-version': 'No IESNA version line — read as LM-63-1986',
  'ies-duplicate-keyword': 'Keyword [{keyword}] appears more than once',
  'ies-tilt-file': 'TILT refers to external file "{file}" — tilt data not loaded',
  'ies-tilt-include': 'File contains TILT=INCLUDE data',
  'ies-unknown-type': 'Unknown photometric type {value}',
  'ies-irregular-horizontal': 'Non-standard horizontal angle range {first}…{last}°',
  'angles-not-ascending': '{axis} angles are not ascending',
  'angles-duplicate': 'Duplicate {axis} angle: {value}°',
  'encoding-fallback': 'File is not UTF-8, read as Windows-1252',
  'negative-candela': 'Negative intensity values: {count}',
  'pole-spread-nadir': 'Intensity at nadir (γ = 0°) differs between C-planes by {percent}%',
  'pole-spread-zenith': 'Intensity at zenith (γ = 180°) differs between C-planes by {percent}%',
  'truncated-at-90': 'Measurement ends at γ = 90° while intensity there is still {percent}% of peak — upward light not measured',
  'flux-mismatch': 'Stated flux {stated} lm differs from computed {computed} lm by {percent}%',
  'multiplier-not-one': 'Candela multiplier is {value}',
  'ldt-conversion-factor': 'Intensity conversion factor (line 24) is {value} — intensities multiplied by it',
  'typeb-light-outside': 'Intensity at the edge of the type B range is still {percent}% of peak — light outside is lost in conversion',
  'article-missing': 'Article number is empty',
  'article-swapped': 'Fields swapped: article "{article}" is in the name field, the article field holds "{other}"',
  'article-mismatch': 'Article "{article}" does not match file name "{file}"',
  'pair-mismatch-scale': 'File pair: same distribution shape but different scale — flux {a} vs {b} lm, peak {pa} vs {pb} cd ({percent}%)',
  'pair-mismatch-shape': 'File pair: distribution shape differs by up to {percent}% of peak (flux {a} vs {b} lm)',
  'resampled-c-planes': 'Irregular C-planes resampled to {step}° step for LDT',
  'converted-type-b': 'Type B photometry converted to type C (C step {cStep}°, γ step {gStep}°)',
};

const de: Templates = {
  'empty-file': 'Datei ist leer',
  'bad-number': 'Zahl „{value}“ nicht lesbar ({where})',
  'header-incomplete': 'Dateikopf unvollständig: {where}',
  'value-count-short': 'Weniger Lichtstärkewerte als angegeben: {found} statt {expected} (Datei abgeschnitten?). Fehlende Werte = 0',
  'value-count-long': 'Mehr Lichtstärkewerte als angegeben: {found} statt {expected}. Überzählige verworfen',
  'isym-all-planes': 'Symmetrie Isym {isym} angegeben, aber alle {planes} Ebenen gespeichert. Als unsymmetrisch gelesen',
  'isym-single-plane': 'Isym 0, aber nur eine Ebene gespeichert. Als rotationssymmetrisch gelesen',
  'ldt-ityp-invalid': 'Ungültiger Leuchtentyp Ityp = {value} (zulässig 0–3)',
  'ldt-isym-invalid': 'Ungültige Symmetrie Isym = {value} (zulässig 0–4)',
  'lamp-count-zero': 'Anzahl der Lampen ist 0',
  'ies-no-version': 'Keine IESNA-Versionszeile — als LM-63-1986 gelesen',
  'ies-duplicate-keyword': 'Schlüsselwort [{keyword}] kommt mehrfach vor',
  'ies-tilt-file': 'TILT verweist auf externe Datei „{file}“ — Neigungsdaten nicht geladen',
  'ies-tilt-include': 'Datei enthält TILT=INCLUDE-Daten',
  'ies-unknown-type': 'Unbekannter Photometrietyp {value}',
  'ies-irregular-horizontal': 'Ungewöhnlicher Bereich der Horizontalwinkel {first}…{last}°',
  'angles-not-ascending': '{axis}-Winkel nicht aufsteigend',
  'angles-duplicate': 'Doppelter {axis}-Winkel: {value}°',
  'encoding-fallback': 'Datei ist kein UTF-8, als Windows-1252 gelesen',
  'negative-candela': 'Negative Lichtstärkewerte: {count}',
  'pole-spread-nadir': 'Lichtstärke im Nadir (γ = 0°) weicht zwischen C-Ebenen um {percent}% ab',
  'pole-spread-zenith': 'Lichtstärke im Zenit (γ = 180°) weicht zwischen C-Ebenen um {percent}% ab',
  'truncated-at-90': 'Messung endet bei γ = 90°, dort aber noch {percent}% des Maximums — Licht nach oben nicht gemessen',
  'flux-mismatch': 'Angegebener Lichtstrom {stated} lm weicht vom berechneten {computed} lm um {percent}% ab',
  'multiplier-not-one': 'Lichtstärkefaktor ist {value}',
  'ldt-conversion-factor': 'Umrechnungsfaktor der Lichtstärken (Zeile 24) ist {value} — Lichtstärken damit multipliziert',
  'typeb-light-outside': 'Am Rand des Typ-B-Bereichs noch {percent}% des Maximums — Licht außerhalb geht bei der Umrechnung verloren',
  'article-missing': 'Artikelnummer fehlt',
  'article-swapped': 'Felder vertauscht: Artikel „{article}“ steht im Namensfeld, im Artikelfeld steht „{other}“',
  'article-mismatch': 'Artikel „{article}“ passt nicht zum Dateinamen „{file}“',
  'pair-mismatch-scale': 'Dateipaar: gleiche Verteilungsform, aber anderer Maßstab — Lichtstrom {a} und {b} lm, Maximum {pa} und {pb} cd ({percent}%)',
  'pair-mismatch-shape': 'Dateipaar: Verteilungsform weicht um bis zu {percent}% des Maximums ab (Lichtstrom {a} und {b} lm)',
  'resampled-c-planes': 'Ungleichmäßige C-Ebenen für LDT auf {step}°-Schritt umgerechnet',
  'converted-type-b': 'Photometrie Typ B in Typ C umgerechnet (C-Schritt {cStep}°, γ-Schritt {gStep}°)',
};

const templates: Record<Lang, Templates> = { ru, en, de };

export function formatIssue(i: Issue, lang: Lang = 'ru'): string {
  const t = templates[lang][i.code];
  return t.replace(/\{(\w+)\}/g, (_, k: string) => String(i.params?.[k] ?? `{${k}}`));
}
