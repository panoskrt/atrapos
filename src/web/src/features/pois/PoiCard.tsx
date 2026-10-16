import { useEffect, useId, useState } from 'react';
import { Icon } from '../../components/Icon';
import { useMe } from '../auth/useMe';
import { formatDistance, formatElevation, locateOnLine, type Coord } from '../editor/geo';
import { syncStateLabel } from '../routes/api';
import { useEditorStore, type EditorPoi } from '../editor/store';
import { usePoiTypes } from '../import/api';
import { confirmPoiDelete } from './confirmDelete';
import type { PoiLocation } from './placement';
import { COMMON_POI_TYPES, humanizeType, poiGlyph } from './poiTypes';
import styles from './Pois.module.css';

/** "Move onto route" is offered for POIs closer than this to the line. */
const MOVE_ONTO_ROUTE_MAX_M = 2000;

interface Props {
  line: Coord[];
  cumulative: number[];
  locations: Map<string, PoiLocation>;
}

/** Editor for the selected POI, floating over the map. */
export function PoiCard({ line, cumulative, locations }: Props) {
  const me = useMe();
  const suuntoConnected = me.data?.suuntoConnected ?? false;
  const poi = useEditorStore((s) => s.pois.find((p) => p.id === s.selectedPoiId));
  if (!poi) return null;
  // Keyed so the draft text fields reset when another POI is selected.
  return (
    <PoiCardFor
      key={poi.id}
      poi={poi}
      line={line}
      cumulative={cumulative}
      location={locations.get(poi.id)}
      suuntoConnected={suuntoConnected}
    />
  );
}

function PoiCardFor({
  poi,
  line,
  cumulative,
  location,
  suuntoConnected,
}: {
  poi: EditorPoi;
  line: Coord[];
  cumulative: number[];
  location?: PoiLocation;
  suuntoConnected: boolean;
}) {
  const updatePoi = useEditorStore((s) => s.updatePoi);
  const deletePoi = useEditorStore((s) => s.deletePoi);
  const selectPoi = useEditorStore((s) => s.selectPoi);
  const server = useEditorStore((s) => s.poiServer[poi.id]);
  const types = usePoiTypes(suuntoConnected);
  const nameId = useId();
  const typeId = useId();
  const descId = useId();

  // Text edits are drafts until blur/Enter, so a typed name is one undo step, not one per keystroke.
  const [name, setName] = useState(poi.name);
  const [description, setDescription] = useState(poi.description);
  useEffect(() => setName(poi.name), [poi.name]);
  useEffect(() => setDescription(poi.description), [poi.description]);
  // Read the element's value, not state: blur can fire before React re-renders with the last keystroke.
  const commitName = (value: string) => {
    const v = value.trim();
    if (v && v !== poi.name) updatePoi(poi.id, { name: v });
  };
  const commitDescription = (value: string) => {
    if (value !== poi.description) updatePoi(poi.id, { description: value });
  };

  const onRoute = location?.alongM != null;
  const offset = location?.offsetM ?? null;

  const moveOntoRoute = () => {
    const loc = locateOnLine(line, cumulative, poi);
    if (loc) updatePoi(poi.id, { lon: loc.point[0], lat: loc.point[1], ele: loc.point[2] ?? poi.ele });
  };

  const all = (types.data ?? []).map((t) => ({ id: t.id, label: humanizeType(t.name) }));
  const common = COMMON_POI_TYPES.map((id) => all.find((t) => t.id === id)).filter((t) => !!t);
  const rest = all.filter((t) => !COMMON_POI_TYPES.includes(t.id)).sort((a, b) => a.label.localeCompare(b.label));

  return (
    <section className={styles.card} aria-label={`Edit POI ${poi.name}`}>
      <div className={styles.cardHead}>
        {suuntoConnected && (
          <span className={styles.badge} aria-hidden="true">
            <svg viewBox="0 0 16 16" width="16" height="16">
              <path d={poiGlyph(poi.poiType)} />
            </svg>
          </span>
        )}
        <h2 className={`display ${styles.cardTitle}`}>Edit POI</h2>
        <button type="button" className={styles.iconBtn} onClick={() => selectPoi(null)} aria-label="Close POI editor">
          <Icon name="close" size={18} />
        </button>
      </div>

      <label htmlFor={nameId} className={styles.label}>
        Name
      </label>
      <input
        id={nameId}
        className={styles.input}
        value={name}
        maxLength={200}
        onChange={(e) => setName(e.target.value)}
        onBlur={(e) => commitName(e.currentTarget.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur(), e.preventDefault())}
      />

      {suuntoConnected && (
        <>
          <label htmlFor={typeId} className={styles.label}>
            Suunto POI type (watch icon)
          </label>
          <select id={typeId} className={styles.input} value={poi.poiType} onChange={(e) => updatePoi(poi.id, { poiType: Number(e.target.value) })}>
            {all.length === 0 && <option value={poi.poiType}>Type {poi.poiType}</option>}
            <optgroup label="Common">
              {common.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="All types">
              {rest.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          </select>
        </>
      )}

      <label htmlFor={descId} className={styles.label}>
        Description
      </label>
      <textarea
        id={descId}
        className={styles.textarea}
        rows={2}
        maxLength={4000}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={(e) => commitDescription(e.currentTarget.value)}
      />

      <dl className={styles.facts}>
        <div>
          <dt>{onRoute ? 'On route at' : 'Off route'}</dt>
          <dd>{onRoute ? formatDistance(location!.alongM!) : offset !== null ? `${formatDistance(offset)} away` : 'No route yet'}</dd>
        </div>
        <div>
          <dt>Elevation</dt>
          <dd>{poi.ele !== null ? formatElevation(poi.ele) : '–'}</dd>
        </div>
      </dl>
      {!onRoute && offset !== null && offset <= MOVE_ONTO_ROUTE_MAX_M && (
        <button type="button" className="btn" onClick={moveOntoRoute}>
          Move onto route
        </button>
      )}

      {suuntoConnected && (
        <div className={styles.syncBox}>
          <div>
            <span>Suunto POI</span>
            <strong>{server ? syncStateLabel[server.syncState] : 'Not saved yet'}</strong>
          </div>
          <div>
            <span>Waypoint in route</span>
            <strong>{onRoute ? 'With the next route push' : 'Off route: POI only'}</strong>
          </div>
        </div>
      )}

      <button
        type="button"
        className={styles.deleteBtn}
        onClick={async () => {
          if (await confirmPoiDelete(poi, server)) deletePoi(poi.id);
        }}
      >
        <Icon name="trash" size={16} />
        Delete POI
      </button>
    </section>
  );
}
