import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Числовое поле как в «Расчёте освещения»: стрелки слева, единица измерения внутри поля справа.
 * Стрелки, ↑ / ↓ (с Shift — ×10) и колесо мыши (когда поле в фокусе) меняют значение на шаг.
 * Принимает и запятую, и точку; показывает десятичный разделитель языка интерфейса.
 * Правая кнопка мыши — значение по умолчанию (`def`, иначе 0 в пределах min…max).
 */

interface Props {
  value: string | number | null | undefined;
  onChange: (text: string) => void;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Ширина поля, px или CSS. */
  width?: number | string;
  'aria-label'?: string;
  title?: string;
  /** Значение по умолчанию для правой кнопки мыши (нет — 0, ограниченный min / max). */
  def?: number | string;
  /** Единица сразу за числом («45°», «897,7 лм»), а не у правого края — компактнее (панель «Операций»). */
  inlineUnit?: boolean;
}

const UP = (
  <svg viewBox="0 0 8 5" width="8" height="5" aria-hidden="true">
    <path d="M0 5 4 0 8 5z" fill="currentColor" />
  </svg>
);
const DOWN = (
  <svg viewBox="0 0 8 5" width="8" height="5" aria-hidden="true">
    <path d="M0 0h8L4 5z" fill="currentColor" />
  </svg>
);

export const parseNum = (s: string | number | null | undefined): number => {
  if (typeof s === 'number') return s;
  if (s == null) return NaN;
  const t = s.replace(/[\s ]/g, '').replace(',', '.');
  return t === '' ? NaN : Number(t);
};

const decimalsOf = (x: number) => {
  const s = String(x);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
};

export function NumField({ value, onChange, unit, step = 1, min, max, placeholder, disabled, className, width, title, def, inlineUnit, ...rest }: Props) {
  const { i18n } = useTranslation();
  const comma = i18n.language !== 'en';
  const ref = useRef<HTMLInputElement>(null);
  const text = value == null ? '' : typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value;
  const shown = comma ? text.replace('.', ',') : text.replace(',', '.');

  const bump = (dir: number, mult = 1) => {
    if (disabled) return;
    let x = parseNum(text);
    if (!Number.isFinite(x)) x = parseNum(placeholder ?? '');
    if (!Number.isFinite(x)) x = 0;
    const st = step * mult;
    let y = x + dir * st;
    if (min != null) y = Math.max(min, y);
    if (max != null) y = Math.min(max, y);
    const d = Math.max(decimalsOf(st), decimalsOf(x) > 6 ? 0 : decimalsOf(x));
    onChange(String(Math.round(y * 10 ** d) / 10 ** d));
  };
  const reset = (e: React.MouseEvent) => {
    e.preventDefault();
    if (disabled) return;
    let d: number | string = def ?? 0;
    if (typeof d === 'number') {
      if (min != null) d = Math.max(min, d);
      if (max != null) d = Math.min(max, d);
      d = String(Math.round(d * 1e6) / 1e6);
    }
    onChange(d);
  };
  const bumpRef = useRef(bump);
  bumpRef.current = bump;

  // колесо — только когда поле в фокусе (как у числовых полей браузера), без прокрутки страницы
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (document.activeElement !== el) return;
      e.preventDefault();
      bumpRef.current(e.deltaY < 0 ? 1 : -1, e.shiftKey ? 10 : 1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <span className={`numf${inlineUnit ? ' inlu' : ''}${disabled ? ' off' : ''}${className ? ` ${className}` : ''}`} style={width != null ? { width } : undefined} title={title} onContextMenu={reset}>
      <span className="spin">
        <button type="button" tabIndex={-1} disabled={disabled} onClick={() => bump(1)} aria-label="+">
          {UP}
        </button>
        <button type="button" tabIndex={-1} disabled={disabled} onClick={() => bump(-1)} aria-label="−">
          {DOWN}
        </button>
      </span>
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={shown}
        placeholder={placeholder != null && comma ? placeholder.replace('.', ',') : placeholder}
        disabled={disabled}
        aria-label={rest['aria-label']}
        style={unit && !inlineUnit ? { paddingRight: `${12 + unit.length * 6.5}px` } : undefined}
        onChange={(e) => onChange(e.target.value.replace(comma ? '.' : ',', comma ? ',' : '.'))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            bump(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey ? 10 : 1);
          }
        }}
      />
      {unit && !inlineUnit && <span className="unit">{unit}</span>}
      {unit && inlineUnit && (
        <span className="unit inl" aria-hidden="true">
          <span className="ghost">{shown}</span>
          <span className="u">
            {unit.length > 1 ? '\u2009' : ''}
            {unit}
          </span>
        </span>
      )}
    </span>
  );
}
