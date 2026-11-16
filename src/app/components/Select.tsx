import { Children, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Выпадающий список в оформлении меню верхней панели (тот же список-«карточка», пункты, галочка).
 * Пишется как обычный <select>: дочерние <option value>…</option>, onChange получает { target: { value } }.
 * Список рисуется поверх страницы (портал, position: fixed) — его не обрезают карточки и таблицы.
 * Клавиатура: Enter / пробел / ↓ — открыть, ↑ ↓ — выбор, Enter — подтвердить, Esc — закрыть.
 */

interface Opt {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

interface Props {
  value: string | number;
  onChange: (e: { target: { value: string } }) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  title?: string;
}

function optionsOf(children: ReactNode): Opt[] {
  const out: Opt[] = [];
  Children.toArray(children).forEach((c) => {
    if (!isValidElement(c)) return;
    const el = c as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>;
    if (el.type === 'option') out.push({ value: String(el.props.value ?? ''), label: el.props.children, disabled: el.props.disabled });
  });
  return out;
}

export function Select({ value, onChange, children, disabled, className, title, ...rest }: Props) {
  const opts = optionsOf(children);
  const v = String(value);
  const cur = opts.find((o) => o.value === v);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const h = Math.min(320, opts.length * 28 + 10);
    const up = r.bottom + h + 8 > window.innerHeight && r.top > h + 8;
    setPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, width: r.width, up });
  };
  useLayoutEffect(() => {
    if (open) place();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || list.current?.contains(t)) return;
      setOpen(false);
    };
    const reflow = (e: Event) => {
      if (list.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', reflow, true);
    window.addEventListener('resize', reflow);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', reflow, true);
      window.removeEventListener('resize', reflow);
    };
  }, [open]);

  const pick = (o: Opt) => {
    if (o.disabled) return;
    setOpen(false);
    btn.current?.focus();
    // и повторный выбор того же пункта (например, вида 3D после поворота мышью)
    onChange({ target: { value: o.value } });
  };

  const openList = () => {
    if (disabled) return;
    setHi(Math.max(0, opts.findIndex((o) => o.value === v)));
    setOpen(true);
  };

  const move = (d: number) => {
    let i = hi;
    for (let k = 0; k < opts.length; k++) {
      i = (i + d + opts.length) % opts.length;
      if (!opts[i].disabled) break;
    }
    setHi(i);
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`sel${open ? ' open' : ''}${className ? ` ${className}` : ''}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={rest['aria-label']}
        title={title}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            openList();
          } else if (open) {
            if (e.key === 'Escape') {
              e.preventDefault();
              setOpen(false);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              move(e.key === 'ArrowDown' ? 1 : -1);
            } else if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (opts[hi]) pick(opts[hi]);
            } else if (e.key === 'Tab') setOpen(false);
          }
        }}
      >
        <span className="sel-label">{cur?.label ?? ''}</span>
        <svg className="sel-caret" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={list}
            role="listbox"
            className="sel-drop"
            style={{ left: pos.left, top: pos.up ? undefined : pos.top, bottom: pos.up ? window.innerHeight - pos.top : undefined, minWidth: pos.width }}
          >
            {opts.map((o, i) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === v}
                disabled={o.disabled}
                className={`mitem${i === hi ? ' hi' : ''}`}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(o)}
              >
                <span className="mcheck">{o.value === v ? '✓' : ''}</span>
                <span className="mlabel">{o.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
