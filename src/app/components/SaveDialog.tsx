/**
 * «Сохранить как…»: формат (IES, LDT или оба) и источники света — один выбранный, все в одном файле (LDT)
 * или по файлу на каждый источник. Один файл — диалог сохранения; несколько — в выбранную папку (или ZIP).
 */
import JSZip from 'jszip';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { houseIES, houseLDT } from '../../batch/house';
import { duplicateSources, savePlan, sourceSuffix, type IesMode, type LdtMode } from '../../batch/sources';
import { type OpenFile } from '../doc';
import { saveBase } from '../actions';
import { canWriteFolders, writeInto } from '../project-folder';
import { safeFileName, saveFile } from '../save-file';
import { load, save } from '../storage';
import { houseCtx } from '../user';
import { Select } from './Select';

export interface SavedAs {
  name: string;
  handle?: FileSystemFileHandle;
  /** Записан файл целиком (все источники) — можно считать его файлом на диске для «Сохранить». */
  whole: boolean;
}

export function SaveDialog({ file, onClose, onSaved }: { file: OpenFile; onClose: () => void; onSaved: (r: SavedAs) => void }) {
  const { t } = useTranslation();
  const p = file.parse.photometry;
  const n = p.lamps.length;
  const many = n > 1;
  const [fmt, setFmt] = useState(() => load('save-formats', { ies: false, ldt: true }));
  const [iesMode, setIesMode] = useState<IesMode>(() => load<IesMode>('save-ies-mode', 'one'));
  const [ldtMode, setLdtMode] = useState<LdtMode>(() => load<LdtMode>('save-ldt-mode', 'one'));
  const [source, setSource] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => save('save-formats', fmt), [fmt]);
  useEffect(() => save('save-ies-mode', iesMode), [iesMode]);
  useEffect(() => save('save-ldt-mode', ldtMode), [ldtMode]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [busy, onClose]);

  const base = safeFileName(saveBase(file)); // <артикул>[ @ источник].ldt
  const plan = useMemo(() => savePlan(p, base, { ...fmt, iesMode, ldtMode, source }), [p, base, fmt, iesMode, ldtMode, source]);
  const names = plan.map((x) => `${safeFileName(x.base)}.${x.fmt}`);
  const clash = new Set(names).size < names.length;
  const needSource = many && ((fmt.ies && iesMode === 'one') || (fmt.ldt && ldtMode === 'one'));

  const run = async () => {
    if (!plan.length) return;
    setBusy(true);
    setErr(null);
    const ctx = houseCtx();
    const text = (i: number, name = names[i]) => (plan[i].fmt === 'ies' ? houseIES(plan[i].photometry, ctx, { lineEnding: p.source.lineEnding }) : houseLDT(plan[i].photometry, ctx, name));
    try {
      if (plan.length === 1) {
        const r = await saveFile(names[0], 'text/plain', plan[0].fmt, (n) => text(0, n));
        if (r) {
          const whole = !many || (plan[0].fmt === 'ldt' && ldtMode === 'all');
          onSaved(r === true ? { name: names[0], whole } : { name: r.name, handle: r.handle, whole });
          onClose();
        }
        return;
      }
      if (canWriteFolders()) {
        let dir: FileSystemDirectoryHandle;
        try {
          dir = await (window as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'readwrite', id: 'photometry-save' });
        } catch (e) {
          if ((e as Error).name === 'AbortError') return;
          throw e;
        }
        for (let i = 0; i < plan.length; i++) await writeInto(dir, '', names[i], text(i));
        onClose();
        return;
      }
      const zip = new JSZip();
      plan.forEach((_, i) => zip.file(names[i], text(i)));
      const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
      if (await saveFile(`${base}.zip`, 'application/zip', 'zip', () => bytes)) onClose();
    } catch (e) {
      setErr(t('error.save', { name: file.name, msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const radio = <T extends string>(value: T, cur: T, set: (v: T) => void, label: string, disabled = false) => (
    <label className={`radio${disabled ? ' off' : ''}`}>
      <input type="radio" checked={cur === value} disabled={disabled} onChange={() => set(value)} />
      {label}
    </label>
  );
  const srcLabel = (k: number) => {
    const l = p.lamps[k];
    return [`${k + 1}.`, l.type, l.flux != null ? `${Math.round(l.flux)} ${t('unit.lm')}` : '', l.cct ? `${l.cct.replace(/k$/i, '')} K` : ''].filter(Boolean).join(' · ') + ` → «${sourceSuffix(p, k)}»`;
  };

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal savedlg" role="dialog" aria-label={t('save.title')} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{t('save.title')}</h2>
          <button className="link" onClick={onClose} aria-label={t('style.close')}>×</button>
        </header>
        <div className="modal-body">
          <div className="savegrid">
            <span className="tlbl">{t('save.format')}</span>
            <span className="ttoggles">
              {(['ies', 'ldt'] as const).map((k) => (
                <button key={k} className={fmt[k] ? 'on' : ''} aria-pressed={fmt[k]} onClick={() => setFmt({ ...fmt, [k]: !fmt[k] })}>{k.toUpperCase()}</button>
              ))}
            </span>
            {many && (
              <>
                <span className="tlbl">IES</span>
                <span className="radios">
                  {radio<IesMode>('one', iesMode, setIesMode, t('save.oneFile'), !fmt.ies)}
                  {radio<IesMode>('each', iesMode, setIesMode, t('save.eachFile'), !fmt.ies)}
                </span>
                <span className="tlbl">LDT</span>
                <span className="radios">
                  {radio<LdtMode>('one', ldtMode, setLdtMode, t('save.oneFile'), !fmt.ldt)}
                  {radio<LdtMode>('all', ldtMode, setLdtMode, t('save.allInOne'), !fmt.ldt)}
                  {radio<LdtMode>('each', ldtMode, setLdtMode, t('save.eachFile'), !fmt.ldt)}
                </span>
                <span className="tlbl">{t('save.source')}</span>
                <Select value={String(source)} onChange={(e) => setSource(Number(e.target.value))} disabled={!needSource} aria-label={t('save.source')}>
                  {p.lamps.map((_, k) => <option key={k} value={k}>{srcLabel(k)}</option>)}
                </Select>
              </>
            )}
          </div>
          <div className="savelist small">
            <div className="muted">{plan.length > 1 ? t('save.filesMany', { n: plan.length }) : plan.length ? t('save.filesOne') : t('save.noFormat')}</div>
            <ul>{names.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
          {clash && <p className="error small">{t('save.clash')}</p>}
          {!clash && duplicateSources(p).size > 0 && <p className="warn small">{t('passport.dupSources', { list: [...duplicateSources(p)].map((k) => k + 1).join(', ') })}</p>}
          {err && <p className="error small">{err}</p>}
        </div>
        <footer>
          <span className="grow" />
          <button className="btn" onClick={onClose} disabled={busy}>{t('save.cancel')}</button>
          <button className="gsbtn" onClick={() => void run()} disabled={busy || !plan.length || clash}>{plan.length > 1 ? (canWriteFolders() ? t('save.toFolder') : t('save.toZip')) : t('save.save')}</button>
        </footer>
      </div>
    </div>
  );
}
