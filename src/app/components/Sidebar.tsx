import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fontMeasure } from '../../charts/fonts';
import { buildPolar } from '../../charts/polar';
import { renderSvg } from '../../charts/render-svg';
import { approxTextWidth } from '../../charts/scene';
import { defaultPlanes } from '../../charts/series';
import type { ChartStyle } from '../../charts/style';
import type { ChartSettings } from '../App';
import { isModified, type OpenFile } from '../doc';
import type { FolderEntry, FolderState } from '../folder';
import { screenFamily, type LoadedFonts } from '../fonts';

interface Props {
  files: OpenFile[];
  activeId: string | null;
  folder: FolderState | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCloseAll: () => void;
  onOpenEntry: (e: FolderEntry) => void;
  onOpenFiles: () => void;
  onConnectFolder: () => void;
  onGrant: () => void;
  onDisconnect: () => void;
  settings: ChartSettings;
  style: ChartStyle;
  fonts: LoadedFonts | null;
}

function FileRow({ f, active, onSelect, onClose, label, liRef }: { f: OpenFile; active: boolean; onSelect: () => void; onClose: () => void; label?: string; liRef?: React.Ref<HTMLLIElement> }) {
  const { t } = useTranslation();
  const worst = f.issues[0]?.severity;
  const fmt = f.parse.photometry.source.format;
  return (
    <li ref={liRef} className={active ? 'active' : ''}>
      <button className="file-item" onClick={onSelect} title={label ?? f.name}>
        <span className={`fmt fmt-${fmt.toLowerCase()}`}>{fmt === 'none' ? '∑' : fmt}</span>
        <span className="fname">{label ?? f.name}</span>
        {f.disk && <span className={`diskmark ${f.disk}`} title={t(`files.disk_${f.disk}`)}>{f.disk === 'removed' ? '⊘' : '↻'}</span>}
        {isModified(f) && <span className="modmark" title={t('files.modified')}>●</span>}
        {worst && worst !== 'info' && <span className={`dot ${worst}`} title={t('files.issues', { count: f.issues.length })} />}
      </button>
      <button className="close" aria-label={t('files.close')} onClick={onClose}>×</button>
    </li>
  );
}

/** Исходная КСС выбранного файла — всегда видна под списком файлов. */
function MiniPolar({ file, settings, style, fonts }: { file: OpenFile; settings: ChartSettings; style: ChartStyle; fonts: LoadedFonts | null }) {
  const { t } = useTranslation();
  const orig = file.past[0] ?? file;
  const p = orig.parse.photometry;
  const measure = useMemo(() => (fonts ? fontMeasure(fonts.set) : approxTextWidth), [fonts]);
  const svg = useMemo(() => {
    const planes = settings.planes ?? defaultPlanes(p);
    const scene = buildPolar(p, orig.summary, { ...settings, planes, width: settings.width, title: '' }, style, measure);
    return renderSvg(scene, { screenFamily: screenFamily(fonts) });
  }, [p, orig.summary, settings, style, measure, fonts]);
  return (
    <div className="minipolar">
      <div className="minihead">
        <span>{t('files.miniTitle')}</span>
        {isModified(file) && !file.derived && <span className="muted small">{t('files.miniOriginal')}</span>}
      </div>
      <div className="paper" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}

export function Sidebar(props: Props) {
  const { files, activeId, folder, onSelect, onClose, onCloseAll, onOpenEntry, onOpenFiles, onConnectFolder, onGrant, onDisconnect } = props;
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const [folderOpen, setFolderOpen] = useState(true);
  const activeRef = useRef<HTMLLIElement | null>(null);

  const loose = files.filter((f) => !f.folderPath);
  const byPath = useMemo(() => new Map(files.filter((f) => f.folderPath).map((f) => [f.folderPath!, f])), [files]);
  const entries = useMemo(() => {
    if (!folder) return [];
    const q = filter.trim().toLowerCase();
    return q ? folder.entries.filter((e) => e.path.toLowerCase().includes(q)) : folder.entries;
  }, [folder, filter]);
  const active = files.find((f) => f.id === activeId) ?? null;

  // выбранный файл папки — в зоне видимости списка (Alt+↓ / Alt+↑)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <span>{t('files.title')}</span>
        <div className="row">
          <button className="btn small" onClick={onOpenFiles}>{t('files.openFiles')}</button>
          <button className="btn small" onClick={onConnectFolder}>{t('files.connectFolder')}</button>
        </div>
      </div>

      <div className="sidebar-lists">
        {folder && (
          <section className="fgroup">
            <div className="fgroup-head">
              <button className="fgroup-toggle" onClick={() => setFolderOpen(!folderOpen)} aria-expanded={folderOpen}>
                <span className="caret">{folderOpen ? '▾' : '▸'}</span>
                <span className="folder-ico" aria-hidden="true">▤</span>
                <b title={folder.name}>{folder.name}</b>
                <span className="muted">{folder.entries.length}</span>
              </button>
              <span className={`livebadge ${folder.live && !folder.needsPermission ? 'on' : ''}`} title={t(folder.live ? 'files.liveHint' : 'files.snapshotHint')}>
                {folder.live && !folder.needsPermission ? t('files.live') : t('files.snapshot')}
              </span>
              <button className="close vis" aria-label={t('files.disconnect')} title={t('files.disconnect')} onClick={onDisconnect}>×</button>
            </div>
            {folder.needsPermission ? (
              <div className="fgroup-note">
                <p className="muted small">{t('files.needPermission')}</p>
                <button className="btn small primary" onClick={onGrant}>{t('files.grant')}</button>
              </div>
            ) : (
              folderOpen && (
                <>
                  {folder.entries.length > 12 && (
                    <input type="text" className="ffilter" placeholder={t('files.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
                  )}
                  <ul className="filelist">
                    {entries.map((e) => {
                      const f = byPath.get(e.path);
                      if (f) {
                        return (
                          <FileRow key={e.path} liRef={f.id === activeId ? activeRef : undefined} f={f} label={e.path} active={f.id === activeId} onSelect={() => onSelect(f.id)} onClose={() => onClose(f.id)} />
                        );
                      }
                      const ext = /\.ldt$/i.test(e.name) ? 'ldt' : 'ies';
                      return (
                        <li key={e.path} className="idle">
                          <button className="file-item" onClick={() => onOpenEntry(e)} title={e.path}>
                            <span className={`fmt fmt-${ext}`}>{ext.toUpperCase()}</span>
                            <span className="fname">{e.path}</span>
                          </button>
                        </li>
                      );
                    })}
                    {!entries.length && <li className="muted small empty-li">{folder.entries.length ? t('files.noMatch') : t('files.folderEmpty')}</li>}
                  </ul>
                </>
              )
            )}
          </section>
        )}

        {loose.length > 0 && (
          <section className="fgroup">
            <div className="fgroup-head">
              <span className="fgroup-title">{folder ? t('files.opened') : t('files.openedAll')} <span className="muted">{loose.length}</span></span>
              <button className="link small" onClick={onCloseAll}>{t('files.closeAll')}</button>
            </div>
            <ul className="filelist">
              {loose.map((f) => (
                <FileRow key={f.id} liRef={f.id === activeId ? activeRef : undefined} f={f} active={f.id === activeId} onSelect={() => onSelect(f.id)} onClose={() => onClose(f.id)} />
              ))}
            </ul>
          </section>
        )}

        {!folder && !loose.length && <p className="muted small sidebar-empty">{t('files.emptyHint')}</p>}
      </div>

      {active && <MiniPolar file={active} settings={props.settings} style={props.style} fonts={props.fonts} />}
    </aside>
  );
}
