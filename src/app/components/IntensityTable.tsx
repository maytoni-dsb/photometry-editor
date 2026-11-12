import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fullPlanes } from '../../core/index';
import type { OpenFile } from '../doc';
import { load, save } from '../storage';

type Unit = 'cd' | 'cdklm';

/** Таблица сил света в сетке файла: строки — γ (V), столбцы — плоскости C (H). */
export function IntensityTable({ file }: { file: OpenFile }) {
  const { t, i18n } = useTranslation();
  const [unit, setUnit] = useState<Unit>(() => load<Unit>('table-unit', 'cdklm'));
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);
  const p = file.parse.photometry;
  const isB = p.photometryType === 'B';
  const canExpand = !isB && p.symmetry !== 'none' && p.symmetry !== 'axial';
  const factor = unit === 'cdklm' ? 1000 / file.summary.referenceFlux : 1;

  const cols = useMemo(() => {
    if (full && canExpand) return fullPlanes(p).map((pl) => ({ h: pl.c, values: pl.values }));
    return p.hAngles.map((h, i) => ({ h, values: p.candela[i] }));
  }, [p, full, canExpand]);

  let max = -Infinity;
  for (const c of cols) for (const v of c.values) max = Math.max(max, v);

  const fmt = (v: number) => (v * factor).toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hName = isB ? 'H' : 'C';
  const vName = isB ? 'V' : 'γ';

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
          <select value={unit} onChange={(e) => { setUnit(e.target.value as Unit); save('table-unit', e.target.value); }}>
            <option value="cdklm">{t('unit.cdklm')}</option>
            <option value="cd">{t('unit.cd')}</option>
          </select>
        </label>
        {canExpand && (
          <label className="check">
            <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> {t('table.full')}
          </label>
        )}
        <button className="btn" onClick={() => void copy()}>{copied ? t('table.copied') : t('table.copy')}</button>
        <span className="muted">
          {t('table.size', { rows: p.vAngles.length, cols: cols.length })} · {t('table.maxNote')}
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
                  return <td key={c.h} className={v === max ? 'peak' : v === 0 ? 'zero' : undefined}>{fmt(v)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
