import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from './Select';
import { fullPlanes } from '../../core/index';
import type { OpenFile } from '../doc';
import { load, save } from '../storage';

type Unit = 'cd' | 'cdklm';

/** Таблица сил света в сетке файла: строки — γ (V), столбцы — плоскости C (H). */
/** Ячейка в правке: столбец (индекс хранимой плоскости), строка, текст. */
interface Editing {
  i: number;
  j: number;
  text: string;
}

export function IntensityTable({ file, onEdit }: { file: OpenFile; onEdit?: (i: number, j: number, cd: number) => void }) {
  const { t, i18n } = useTranslation();
  const [unit, setUnit] = useState<Unit>(() => load<Unit>('table-unit', 'cdklm'));
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const p = file.parse.photometry;
  const isB = p.photometryType === 'B';
  const canExpand = !isB && p.symmetry !== 'none' && p.symmetry !== 'axial';
  const factor = unit === 'cdklm' ? 1000 / file.summary.referenceFlux : 1;

  const cols = useMemo(() => {
    if (full && canExpand) return fullPlanes(p).map((pl) => ({ h: pl.c, values: pl.values, i: -1 }));
    return p.hAngles.map((h, i) => ({ h, values: p.candela[i], i }));
  }, [p, full, canExpand]);

  let max = -Infinity;
  for (const c of cols) for (const v of c.values) max = Math.max(max, v);

  const fmt = (v: number) => (v * factor).toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hName = isB ? 'H' : 'C';
  const vName = isB ? 'V' : 'γ';

  const commit = () => {
    if (!editing || !onEdit) return;
    const x = Number(editing.text.replace(/[\s\u00a0]/g, '').replace(',', '.'));
    setEditing(null);
    if (!Number.isFinite(x) || x < 0) return;
    const cd = x / factor;
    if (Math.abs(cd - p.candela[editing.i][editing.j]) > 1e-9) onEdit(editing.i, editing.j, cd);
  };

  const copy = async () => {
    const plain = (v: number) => (v * factor).toLocaleString(i18n.language, { maximumFractionDigits: 4, useGrouping: false });
    const lines = [[`${vName} \\ ${hName}`, ...cols.map((c) => String(c.h))].join('\t')];
    p.vAngles.forEach((g, j) => lines.push([String(g), ...cols.map((c) => plain(c.values[j]))].join('\t')));
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* буфер обмена недоступен */
    }
  };

  return (
    <div className="table-view">
      <div className="toolbar">
        <label>
          {t('table.unit')}{' '}
          <Select value={unit} onChange={(e) => { setUnit(e.target.value as Unit); save('table-unit', e.target.value); }}>
            <option value="cdklm">{t('unit.cdklm')}</option>
            <option value="cd">{t('unit.cd')}</option>
          </Select>
        </label>
        {canExpand && (
          <label className="check">
            <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> {t('table.full')}
          </label>
        )}
        <button className="btn" onClick={() => void copy()}>{copied ? t('table.copied') : t('table.copy')}</button>
        <span className="muted">
          {t('table.size', { rows: p.vAngles.length, cols: cols.length })} · {t('table.maxNote')} · {full && canExpand ? t('table.editFullOff') : t('table.editHint')}
        </span>
      </div>
      <div className="table-scroll big">
        <table className="grid numbers">
          <thead>
            <tr>
              <th className="corner">{vName} \ {hName}</th>
              {cols.map((c) => <th key={c.h}>{c.h}°</th>)}
            </tr>
          </thead>
          <tbody>
            {p.vAngles.map((g, j) => (
              <tr key={g}>
                <th>{g}°</th>
                {cols.map((c) => {
                  const v = c.values[j];
                  if (editing && editing.i === c.i && editing.j === j) {
                    return (
                      <td key={c.h} className="editing">
                        <input
                          autoFocus
                          value={editing.text}
                          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setEditing({ ...editing, text: '0' });
                          }}
                          onBlur={commit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commit();
                            if (e.key === 'Escape') setEditing(null);
                          }}
                        />
                      </td>
                    );
                  }
                  return (
                    <td
                      key={c.h}
                      className={v === max ? 'peak' : v === 0 ? 'zero' : undefined}
                      onDoubleClick={() => onEdit && c.i >= 0 && setEditing({ i: c.i, j, text: (v * factor).toLocaleString(i18n.language, { maximumFractionDigits: 4, useGrouping: false }) })}
                    >
                      {fmt(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
