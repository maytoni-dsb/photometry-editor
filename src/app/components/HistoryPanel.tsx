import { useTranslation } from 'react-i18next';
import type { OpenFile } from '../doc';

/**
 * История изменений файла — во всю высоту рабочей области. Щелчок по строке возвращает к шагу
 * (Ctrl+Z / Ctrl+Y — отмена и повтор). Внизу: удалить текущее состояние, новый файл из текущего состояния.
 */
export function HistoryPanel({ file, onJump, onDelete, onFork }: { file: OpenFile; onJump: (i: number) => void; onDelete: () => void; onFork: () => void }) {
  const { t } = useTranslation();
  const timeline = [...file.past.map((x) => x.label), file.label, ...file.future.map((x) => x.label)];
  const cur = file.past.length;
  return (
    <aside className="side-history">
      <h3>{t('ops.history')}</h3>
      <ul className="hrows">
        {timeline.map((label, i) => (
          <li key={i} className={i === cur ? 'cur' : i > cur ? 'undone' : ''}>
            <button onClick={() => onJump(i)} disabled={i === cur} aria-current={i === cur ? 'step' : undefined}>
              {label || (file.derived ? t('ops.created') : t('ops.original'))}
            </button>
          </li>
        ))}
      </ul>
      <div className="hactions">
        <button className="iconbtn" onClick={onDelete} disabled={!file.past.length} title={t('ops.deleteState')} aria-label={t('ops.deleteState')}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button className="iconbtn" onClick={onFork} title={t('ops.forkState')} aria-label={t('ops.forkState')}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M13.5 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8.5z M13.5 3v5.5H19" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M12 11.5v6M9 14.5h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
