import { useEffect, useState } from 'react';

/** Тёмная тема сейчас: выбрана явно или системная. */
export function isDarkTheme(): boolean {
  const th = document.documentElement.dataset.theme;
  if (th === 'dark') return true;
  if (th === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/** Тёмная тема — с обновлением при переключении темы и смене системной. */
export function useDarkTheme(): boolean {
  const [dark, setDark] = useState(isDarkTheme);
  useEffect(() => {
    const upd = () => setDark(isDarkTheme());
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener('change', upd);
    const mo = new MutationObserver(upd);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq?.removeEventListener('change', upd);
      mo.disconnect();
    };
  }, []);
  return dark;
}
