import { useStore } from 'zustand';
import { Icon, type IconName } from '../../components/Icon';
import { baseLayers, type BaseLayerId } from './baseLayers';
import { confirmPoiDelete } from '../pois/confirmDelete';
import { useEditorStore } from './store';
import styles from './Editor.module.css';

function ToolButton({
  icon,
  label,
  onClick,
  pressed,
  disabled,
  tone,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  tone?: 'poi' | 'danger';
}) {
  return (
    <button
      type="button"
      className={`${styles.toolBtn} ${pressed ? styles.toolBtnOn : ''} ${tone ? styles[`tool_${tone}`] : ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
    >
      <Icon name={icon} />
    </button>
  );
}

export function MapToolbar({
  onFit,
  onLocate,
  onReverse,
  canFit,
}: {
  onFit: () => void;
  onLocate: () => void;
  onReverse: () => void;
  canFit: boolean;
}) {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const drawMode = useEditorStore((s) => s.drawMode);
  const setDrawMode = useEditorStore((s) => s.setDrawMode);
  const selectedId = useEditorStore((s) => s.selectedId);
  const deletePoint = useEditorStore((s) => s.deletePoint);
  const selectedPoi = useEditorStore((s) => s.pois.find((p) => p.id === s.selectedPoiId));
  const deletePoi = useEditorStore((s) => s.deletePoi);
  const poiServer = useEditorStore((s) => (s.selectedPoiId ? s.poiServer[s.selectedPoiId] : undefined));
  const { undo, redo, pastStates, futureStates } = useStore(useEditorStore.temporal);

  return (
    <div role="toolbar" aria-label="Map tools" className={styles.toolbar}>
      <ToolButton icon="cursor" label="Select and drag points" pressed={tool === 'select'} onClick={() => setTool('select')} />
      <ToolButton icon="routePlus" label="Extend route (click the map)" pressed={tool === 'extend'} onClick={() => setTool('extend')} />
      <ToolButton icon="pinPlus" label="Add POI (click the map)" tone="poi" pressed={tool === 'poi'} onClick={() => setTool('poi')} />
      <span className={styles.toolSep} />
      <div role="group" aria-label="Drawing mode" className={styles.segmented}>
        <button
          type="button"
          aria-pressed={drawMode === 'snap'}
          className={drawMode === 'snap' ? styles.segOn : styles.seg}
          onClick={() => setDrawMode('snap')}
          title="New segments follow OSM trails and roads"
        >
          Snap to trail
        </button>
        <button
          type="button"
          aria-pressed={drawMode === 'freehand'}
          className={drawMode === 'freehand' ? styles.segOn : styles.seg}
          onClick={() => setDrawMode('freehand')}
          title="New segments are straight lines"
        >
          Freehand
        </button>
      </div>
      <span className={styles.toolSep} />
      <ToolButton icon="undo" label="Undo (Ctrl+Z)" disabled={pastStates.length === 0} onClick={() => undo()} />
      <ToolButton icon="redo" label="Redo (Ctrl+Y)" disabled={futureStates.length === 0} onClick={() => redo()} />
      <ToolButton
        icon="trash"
        label={selectedPoi ? 'Delete selected POI (Delete)' : 'Delete selected point (Delete)'}
        tone="danger"
        disabled={!selectedId && !selectedPoi}
        onClick={async () => {
          if (selectedPoi) {
            if (await confirmPoiDelete(selectedPoi, poiServer)) deletePoi(selectedPoi.id);
          } else if (selectedId) {
            deletePoint(selectedId);
          }
        }}
      />
      <ToolButton icon="reverse" label="Reverse route direction" disabled={!canFit} onClick={onReverse} />
      <span className={styles.toolSep} />
      <ToolButton icon="fit" label="Fit route in view" disabled={!canFit} onClick={onFit} />
      <ToolButton icon="locate" label="Go to my location" onClick={onLocate} />
    </div>
  );
}

export function LayerSwitcher({ value, onChange }: { value: BaseLayerId; onChange: (id: BaseLayerId) => void }) {
  return (
    <div role="group" aria-label="Base map" className={styles.layers}>
      {baseLayers.map((l) => (
        <button
          key={l.id}
          type="button"
          aria-pressed={l.id === value}
          className={l.id === value ? styles.layerOn : styles.layer}
          onClick={() => onChange(l.id)}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
