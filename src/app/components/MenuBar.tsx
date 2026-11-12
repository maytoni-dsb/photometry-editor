import { useEffect, useRef, useState } from 'react';

/**
 * Классическое меню приложения («Файл», «Вид»…).
 * Открывается щелчком; пока одно меню открыто, соседние открываются наведением.
 * Esc или щелчок мимо закрывают. Пункты с подменю раскрываются вправо.
 */

export type MenuItem =
  | 'sep'
  | {
      label: string;
      shortcut?: string;
      disabled?: boolean;
      checked?: boolean;
      onClick?: () => void;
      submenu?: MenuItem[];
    };

export interface Menu {
  id: string;
  label: string;
  items: MenuItem[];
}

function Items({ items, onDone }: { items: MenuItem[]; onDone: () => void }) {
  const [sub, setSub] = useState<number | null>(null);
  return (
    <div className="mdrop" role="menu">
      {items.map((it, i) => {
        if (it === 'sep') return <div key={i} className="msep" role="separator" />;
        const hasSub = !!it.submenu?.length && !it.disabled;
        return (
          <div key={i} className="mitem-wrap" onMouseEnter={() => setSub(hasSub ? i : null)}>
            <button
              type="button"
              role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={it.checked}
              aria-haspopup={hasSub || undefined}
              className="mitem"
              disabled={it.disabled}
              onClick={() => {
                if (hasSub) {
                  setSub(sub === i ? null : i);
                  return;
                }
                onDone();
                it.onClick?.();
              }}
            >
              <span className="mcheck">{it.checked ? '✓' : ''}</span>
              <span className="mlabel">{it.label}</span>
              {it.shortcut && <span className="mkey">{it.shortcut}</span>}
              {hasSub && <span className="marrow">›</span>}
            </button>
            {hasSub && sub === i && (
              <div className="msub">
                <Items items={it.submenu!} onDone={onDone} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function MenuBar({ menus }: { menus: Menu[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <nav className="menubar" ref={ref} role="menubar">
      {menus.map((m) => (
        <div key={m.id} className="mtop-wrap">
          <button
            type="button"
            className={open === m.id ? 'mtop open' : 'mtop'}
            aria-haspopup="menu"
            aria-expanded={open === m.id}
            onClick={() => setOpen(open === m.id ? null : m.id)}
            onMouseEnter={() => open && setOpen(m.id)}
          >
            {m.label}
          </button>
          {open === m.id && <Items items={m.items} onDone={() => setOpen(null)} />}
        </div>
      ))}
    </nav>
  );
}
