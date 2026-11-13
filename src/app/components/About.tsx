import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/** «Справка → О программе»: версия, сборка, горячие клавиши. */
export function About({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
  const keys: Array<[string, string]> = [
    [`${mod}O`, t('menu.open')],
    [`${mod}1 … ${mod}6`, t('about.keyTabs')],
    [`${mod}Z`, t('about.keyUndo')],
    [mod === '⌘' ? '⇧⌘Z' : 'Ctrl+Y / Ctrl+Shift+Z', t('about.keyRedo')],
    ['Alt+↓ / Alt+↑', t('about.keyFiles')],
    ['F1', t('menu.about')],
  ];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal about" role="dialog" aria-label={t('menu.about')} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{t('app.title')}</h2>
          <button className="link" onClick={onClose} aria-label={t('style.close')}>×</button>
        </header>
        <div className="modal-body">
          <dl className="kv">
            <div>
              <dt>{t('about.version')}</dt>
              <dd>{__APP_VERSION__}</dd>
            </div>
            <div>
              <dt>{t('about.build')}</dt>
              <dd>{__APP_COMMIT__}</dd>
            </div>
          </dl>
          <p className="muted">{t('app.privacy')}</p>
          <div>
            <h3 className="subh">{t('about.keys')}</h3>
            <dl className="kv">
              {keys.map(([k, v]) => (
                <div key={k}>
                  <dt>{v}</dt>
                  <dd><kbd>{k}</kbd></dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
