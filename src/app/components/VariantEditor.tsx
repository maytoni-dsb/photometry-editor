import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  cellNumber,
  defaultSuffix,
  lampBeamAngle,
  parseVariantTable,
  rowError,
  templateFromJson,
  templateToJson,
  type VariantRow,
  type VariantTemplate,
} from '../../batch/variants';
import { safeFileName, saveFile } from '../save-file';

interface Props {
  rows: VariantRow[];
  onRows: (r: VariantRow[]) => void;
  name: string;
  onName: (n: string) => void;
  saved: VariantTemplate[];
  onSaved: (t: VariantTemplate[]) => void;
}

type Col = { key: keyof VariantRow; num?: boolean; w: string };
const COLS: Col[] = [
  { key: 'suffix', w: '18%' },
  { key: 'cct', w: '9%' },
  { key: 'flux', num: true, w: '11%' },
  { key: 'factor', num: true, w: '9%' },
  { key: 'cri', w: '7%' },
  { key: 'watts', num: true, w: '9%' },
  { key: 'lamp', w: '30%' },
];

const show = (v: unknown) => (v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v));

/** Таблица вариантов: правка в ячейках, вставка из Excel, шаблоны. */
export function VariantEditor({ rows, onRows, name, onName, saved, onSaved }: Props) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  // текст ячеек, пока их редактируют (числа с запятой и т. п.)
  const [edit, setEdit] = useState<Record<string, string>>({});

  const setCell = (i: number, c: Col, v: string) => {
    setEdit({ ...edit, [`${i}:${c.key}`]: v });
    const next = rows.map((r, j) => {
      if (j !== i) return r;
      const n: VariantRow = { ...r, [c.key]: c.num ? cellNumber(v) : v };
      // суффикс по ЦТ, пока его не задали руками
      if (c.key === 'cct' && (!r.suffix || r.suffix === defaultSuffix(r))) n.suffix = defaultSuffix(n);
      return n;
    });
    onRows(next);
  };

  const addParsed = (text: string) => {
    const parsed = parseVariantTable(text);
    if (!parsed.length) {
      setMsg(t('batch.varPasteNothing'));
      return false;
    }
    onRows([...rows.filter((r) => Object.values(r).some((v) => v != null && v !== '')), ...parsed]);
    setEdit({});
    setMsg(t('batch.varPasted', { n: parsed.length }));
    return true;
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && addParsed(text)) return;
    } catch {
      /* браузер не дал прочитать буфер — вставка вручную */
    }
    setPasteOpen(true);
  };

  const saveTemplate = () => {
    const n = name.trim() || t('batch.varUntitled');
    onSaved([...saved.filter((x) => x.name !== n), { name: n, rows }].sort((a, b) => a.name.localeCompare(b.name)));
    onName(n);
    setMsg(t('batch.varSaved', { name: n }));
  };

  return (
    <div className="variants">
      <div className="row">
        <select
          value=""
          aria-label={t('batch.varSavedList')}
          onChange={(e) => {
            const x = saved.find((s) => s.name === e.target.value);
            if (x) {
              onRows(x.rows);
              onName(x.name);
              setEdit({});
            }
          }}
        >
          <option value="">{saved.length ? t('batch.varOpen') : t('batch.varNone')}</option>
          {saved.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.rows.length})</option>)}
        </select>
        <input type="text" className="grow" placeholder={t('batch.varName')} value={name} onChange={(e) => onName(e.target.value)} />
        <button className="btn small" disabled={!rows.length} onClick={saveTemplate}>{t('batch.recipeSave')}</button>
        {saved.some((s) => s.name === name.trim()) && (
          <button className="link small" onClick={() => onSaved(saved.filter((s) => s.name !== name.trim()))}>{t('batch.recipeDelete')}</button>
        )}
      </div>
      <div className="row">
        <button className="btn small" onClick={() => void pasteFromClipboard()}>{t('batch.varPaste')}</button>
        <button className="btn small" onClick={() => fileRef.current?.click()}>{t('batch.recipeImport')}</button>
        <button
          className="btn small"
          disabled={!rows.length}
          onClick={() => void saveFile(`${safeFileName(name.trim() || t('batch.varUntitled'))}.json`, 'application/json', 'json', () => templateToJson({ name: name.trim(), rows }))}
        >
          {t('batch.recipeExport')}
        </button>
        {rows.length > 0 && <button className="link small" onClick={() => { onRows([]); setEdit({}); }}>{t('batch.varClear')}</button>}
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const x = templateFromJson(await f.text(), f.name.replace(/\.json$/i, ''));
              onRows(x.rows);
              onName(x.name);
              setEdit({});
            } catch {
              setMsg(t('batch.varBadFile'));
            }
          }}
        />
      </div>
      {pasteOpen && (
        <div className="pastebox">
          <textarea
            autoFocus
            rows={5}
            placeholder={t('batch.varPastePlaceholder')}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <div className="row">
            <button className="btn small primary" disabled={!pasteText.trim()} onClick={() => { if (addParsed(pasteText)) { setPasteText(''); setPasteOpen(false); } }}>{t('batch.varAddRows')}</button>
            <button className="link small" onClick={() => setPasteOpen(false)}>{t('batch.stepCancel')}</button>
          </div>
        </div>
      )}
      {msg && <p className="muted small">{msg}</p>}

      <div
        className="table-scroll vtable"
        onPaste={(e) => {
          const text = e.clipboardData.getData('text/plain');
          // несколько ячеек из Excel — добавляем строки; одно значение — обычная вставка в ячейку
          if (/[\t\n]/.test(text.trim())) {
            e.preventDefault();
            addParsed(text);
          }
        }}
      >
        <table className="grid small edit">
          <colgroup>
            {COLS.map((c) => <col key={c.key} style={{ width: c.w }} />)}
            <col style={{ width: 28 }} />
          </colgroup>
          <thead>
            <tr>
              {COLS.map((c) => <th key={c.key}>{t(`batch.var_${c.key}`)}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const err = rowError(r);
              return (
                <tr key={i} className={err ? 'bad' : ''} title={err ? t(`batch.variantErr.${err}`, { suffix: r.suffix }) : ''}>
                  {COLS.map((c) => (
                    <td key={c.key}>
                      <input
                        type="text"
                        inputMode={c.num ? 'decimal' : undefined}
                        value={edit[`${i}:${c.key}`] ?? show(r[c.key])}
                        placeholder={c.key === 'factor' && r.flux != null ? '—' : ''}
                        onChange={(e) => setCell(i, c, e.target.value)}
                        onBlur={() => setEdit((x) => { const n = { ...x }; delete n[`${i}:${c.key}`]; return n; })}
                      />
                    </td>
                  ))}
                  <td><button className="icon" onClick={() => onRows(rows.filter((_, j) => j !== i))} aria-label={t('batch.stepRemove')}>×</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.some((r) => lampBeamAngle(r.lamp) != null) && (
        <p className="warn small">
          {t('batch.varAngleNote', { list: [...new Set(rows.filter((r) => lampBeamAngle(r.lamp) != null).map((r) => `«${r.lamp}»`))].join(', ') })}
        </p>
      )}
      <div className="row">
        <button className="btn small" onClick={() => onRows([...rows, { suffix: '' }])}>{t('batch.varAddRow')}</button>
        <span className="muted small">{t('batch.varNote')}</span>
      </div>
    </div>
  );
}
