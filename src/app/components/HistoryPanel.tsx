import { useTranslation } from 'react-i18next';
import type { OpenFile } from '../doc';

/** История изменений файла: щелчок по шагу возвращает к нему (Ctrl+Z / Ctrl+Y — отмена и повтор). */
export function HistoryPanel({ file, onJump }: { file: OpenFile; onJump: (i: number) => void }) {
  const { t } = useTranslation();
  const timeline = [...file.past.map((x) => x.label), file.label, ...file.future.map((x) => x.label)];
  const cur = file.past.length;
  return (
    <aside className="side-history">
      <fieldset className="history">
        <legend>{t('ops.history')}</legend>
        <ol>
          {timeline.map((label, i) => (
            <li key={i} className={i === cur ? 'cur' : i > cur ? 'undone' : ''}>
              <button className="link" onClick={() => onJump(i)} disabled={i === cur}>
                {label || (file.derived ? t('ops.created') : t('ops.original'))}
              </button>
            </li>
          ))}
        </ol>
        <p className="muted small">{t('ops.historyNote')}</p>
      </fieldset>
    </aside>
  );
}
