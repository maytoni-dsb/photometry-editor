import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BRAND_FONT, canUseLocalFonts, clearCustomFont, loadFonts, setCustomFonts, setLocalFont, type LoadedFonts } from '../fonts';

/**
 * Подключение шрифта графиков: фирменный Suisse Intl с компьютера (Chrome / Edge)
 * или файлы OTF / TTF; возврат к встроенному Roboto.
 */
export function FontConnect({ fonts, onFonts, compact = false }: { fonts: LoadedFonts | null; onFonts: (f: LoadedFonts) => void; compact?: boolean }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<LoadedFonts | null>, notFound?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (r) onFonts(r);
      else if (notFound) setMsg(notFound);
    } catch (e) {
      const err = e as Error;
      setMsg(err.name === 'NotAllowedError' || err.name === 'SecurityError' ? t('font.denied') : t('font.error', { msg: err.message }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fontconnect">
      {!compact && (
        <p className="fc-state">
          {fonts?.custom ? t('font.current', { name: fonts.family, styles: fonts.styles.join(', ') }) : t('font.builtin')}
        </p>
      )}
      <div className="row">
        {canUseLocalFonts() && (
          <button className="btn small primary" disabled={busy} onClick={() => void run(() => setLocalFont(BRAND_FONT), t('font.notFound', { name: BRAND_FONT }))}>
            {t('font.fromComputer', { name: BRAND_FONT })}
          </button>
        )}
        <button className="btn small" disabled={busy} onClick={() => input.current?.click()}>{t('font.upload')}</button>
        {fonts?.custom && !compact && (
          <button className="link small" disabled={busy} onClick={() => void run(async () => { clearCustomFont(); return loadFonts(); })}>
            {t('font.reset')}
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept=".otf,.ttf,.woff"
          multiple
          hidden
          onChange={(e) => {
            const list = [...(e.target.files ?? [])];
            e.target.value = '';
            if (list.length) void run(async () => setCustomFonts(await Promise.all(list.map(async (f) => new Uint8Array(await f.arrayBuffer())))));
          }}
        />
      </div>
      {!canUseLocalFonts() && !compact && <p className="muted small">{t('font.noLocalApi')}</p>}
      {msg && <p className="error small">{msg}</p>}
    </div>
  );
}
