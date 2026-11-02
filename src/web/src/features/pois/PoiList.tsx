import { Icon } from '../../components/Icon';
import { formatDistance, formatElevation } from '../editor/geo';
import { useEditorStore } from '../editor/store';
import { usePoiTypes } from '../import/api';
import { syncStateLabel, type SyncState } from '../routes/api';
import type { PoiLocation } from './placement';
import { humanizeType, poiGlyph } from './poiTypes';
import styles from './Pois.module.css';

const syncTone: Record<SyncState, string> = {
  localOnly: styles.toneMuted!,
  synced: styles.toneOk!,
  localChanges: styles.toneWarn!,
  remoteNewer: styles.toneDanger!,
  conflict: styles.toneDanger!,
  error: styles.toneDanger!,
};

/** The route's POIs in route order (off-route ones last). Picking one selects it and pans the map. */
export function PoiList({
  locations,
  onFocus,
  suuntoConnected,
}: {
  locations: Map<string, PoiLocation>;
  onFocus: (lon: number, lat: number) => void;
  suuntoConnected: boolean;
}) {
  const pois = useEditorStore((s) => s.pois);
  const selectedPoiId = useEditorStore((s) => s.selectedPoiId);
  const selectPoi = useEditorStore((s) => s.selectPoi);
  const setTool = useEditorStore((s) => s.setTool);
  const tool = useEditorStore((s) => s.tool);
  const server = useEditorStore((s) => s.poiServer);
  const types = usePoiTypes(suuntoConnected);
  const typeName = (id: number) => humanizeType(types.data?.find((t) => t.id === id)?.name ?? 'POI');

  const sorted = [...pois].sort((a, b) => {
    const da = locations.get(a.id)?.alongM ?? Infinity;
    const db = locations.get(b.id)?.alongM ?? Infinity;
    return da - db || a.name.localeCompare(b.name);
  });

  return (
    <>
      <div className={styles.listHead}>
        <span className={styles.label}>{pois.length === 0 ? 'No POIs yet' : 'Along this route'}</span>
        <button
          type="button"
          className={tool === 'poi' ? `btn ${styles.addOn}` : 'btn'}
          aria-pressed={tool === 'poi'}
          onClick={() => setTool(tool === 'poi' ? 'select' : 'poi')}
        >
          <Icon name="pinPlus" size={16} />
          {tool === 'poi' ? 'Click the map…' : 'Add POI'}
        </button>
      </div>

      {pois.length === 0 ? (
        <p className={styles.muted}>
          Choose Add POI and click the map. Clicks near the route snap onto it.
        </p>
      ) : (
        <ul className={styles.list}>
          {sorted.map((p) => {
            const loc = locations.get(p.id);
            const state = server[p.id]?.syncState ?? 'localOnly';
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className={p.id === selectedPoiId ? styles.rowOn : styles.row}
                  onClick={() => {
                    selectPoi(p.id);
                    onFocus(p.lon, p.lat);
                  }}
                >
                  {suuntoConnected && (
                    <span className={styles.badge} aria-hidden="true">
                      <svg viewBox="0 0 16 16" width="16" height="16">
                        <path d={poiGlyph(p.poiType)} />
                      </svg>
                    </span>
                  )}
                  <span className={styles.rowText}>
                    <strong>{p.name}</strong>
                    <span className={styles.muted}>
                      {suuntoConnected && `${typeName(p.poiType)} · `}
                      {loc?.alongM != null ? formatDistance(loc.alongM) : 'off route'}
                      {p.ele !== null && ` · ${formatElevation(p.ele)}`}
                    </span>
                  </span>
                  {suuntoConnected && (
                    <span className={syncTone[state]}>
                      <span className={styles.dot} />
                      {state === 'localOnly' ? 'Not pushed' : syncStateLabel[state]}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {suuntoConnected && (
        <p className={styles.muted}>
          Each POI is pushed to Suunto as a standalone POI and, when it's on the route, added as a waypoint to the route
          on the next route push.
        </p>
      )}
    </>
  );
}
