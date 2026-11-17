import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchUsers, getUser } from '../user';

/**
 * Выбор пользователя (оператора) из списка public/users.txt. Пустой список — имя вводится вручную.
 * При первом входе закрыть без выбора нельзя.
 */
export function UserDialog({ required, onPick, onClose }: { required: boolean; onPick: (name: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<string[] | null>(null);
  const [name, setName] = useState(getUser());
  useEffect(() => {
    void fetchUsers().then((u) => {
      setUsers(u);
      if (!name && u.length) setName(u[0]);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !required && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [required, onClose]);
  const ok = name.trim() !== '';
  const pick = () => ok && onPick(name.trim());
  return (
    <div className="modal-backdrop" onClick={() => !required && onClose()}>
      <div className="modal userdlg" role="dialog" aria-label={t('user.title')} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{t('user.title')}</h2>
          {!required && <button className="link" onClick={onClose} aria-label={t('style.close')}>×</button>}
        </header>
        <div className="modal-body">
          <p className="muted small">{t('user.note')}</p>
          {users == null ? (
            <p className="muted small">…</p>
          ) : users.length ? (
            <ul className="userlist" role="listbox" aria-label={t('user.title')}>
              {users.map((u) => (
                <li key={u}>
                  <button role="option" aria-selected={u === name} className={u === name ? 'on' : ''} onClick={() => setName(u)} onDoubleClick={() => onPick(u)}>
                    {u}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p className="small">{t('user.empty')}</p>
              <input className="textin" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && pick()} placeholder={t('user.placeholder')} />
            </>
          )}
        </div>
        <footer>
          <span className="grow" />
          <button className="gsbtn" disabled={!ok} onClick={pick}>{t('user.ok')}</button>
        </footer>
      </div>
    </div>
  );
}
