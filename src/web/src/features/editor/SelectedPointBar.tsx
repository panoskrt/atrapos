import { useState } from 'react';
import { confirmAction } from '../../components/ConfirmDialog';
import { Icon } from '../../components/Icon';
import { toast } from '../../components/Toast';
import { splitRoute } from '../routes/api';
import { syncErrorMessage } from '../sync/api';
import { useEditorStore } from './store';
import styles from './Editor.module.css';

interface Props {
  routeId: string;
  flush: () => Promise<boolean>;
  onReload: () => void;
}

/** Actions for the selected control point: segment mode, trim, split, delete. */
export function SelectedPointBar({ routeId, flush, onReload }: Props) {
  const points = useEditorStore((s) => s.points);
  const selectedId = useEditorStore((s) => s.selectedId);
  const setSegmentMode = useEditorStore((s) => s.setSegmentMode);
  const deletePoint = useEditorStore((s) => s.deletePoint);
  const trimBefore = useEditorStore((s) => s.trimBefore);
  const trimAfter = useEditorStore((s) => s.trimAfter);
  const select = useEditorStore((s) => s.select);
  const [splitting, setSplitting] = useState(false);

  const index = points.findIndex((p) => p.id === selectedId);
  if (index < 0) return null;
  const point = points[index]!;
  const isStart = index === 0;
  const isEnd = index === points.length - 1;
  const inner = !isStart && !isEnd;

  const split = async () => {
    const ok = await confirmAction({
      title: 'Split the route here?',
      body: (
        <p>
          Everything after point {index + 1} becomes a new route, together with the POIs along that part. This can't be
          undone.
        </p>
      ),
      confirmLabel: 'Split route',
      icon: 'scissors',
    });
    if (!ok) return;
    setSplitting(true);
    try {
      if (!(await flush())) throw new Error('Save your changes before splitting the route.');
      const res = await splitRoute(routeId, index);
      toast(`Split done. The second part is "${res.created.name}".`, { link: { to: `/routes/${res.created.id}`, label: 'Open it' } });
      onReload();
    } catch (e) {
      toast(`Couldn't split the route: ${syncErrorMessage(e).message}`, { tone: 'error' });
    } finally {
      setSplitting(false);
    }
  };

  return (
    <div className={styles.pointBar} role="group" aria-label={`Point ${index + 1} of ${points.length}`}>
      <strong>
        Point {index + 1} of {points.length}
      </strong>
      {!isEnd && (
        <div role="group" aria-label="Segment to next point" className={styles.segmented}>
          <button
            type="button"
            aria-pressed={point.mode === 'snap'}
            className={point.mode === 'snap' ? styles.segOn : styles.seg}
            onClick={() => setSegmentMode(point.id, 'snap')}
          >
            Snap
          </button>
          <button
            type="button"
            aria-pressed={point.mode === 'freehand'}
            className={point.mode === 'freehand' ? styles.segOn : styles.seg}
            onClick={() => setSegmentMode(point.id, 'freehand')}
          >
            Freehand
          </button>
        </div>
      )}
      {!isStart && (
        <button type="button" className={styles.pointBarBtnPlain} onClick={() => trimBefore(point.id)} title="Make this point the start">
          Trim before
        </button>
      )}
      {!isEnd && (
        <button type="button" className={styles.pointBarBtnPlain} onClick={() => trimAfter(point.id)} title="Make this point the end">
          Trim after
        </button>
      )}
      {inner && (
        <button type="button" className={styles.pointBarBtnPlain} onClick={() => void split()} disabled={splitting}>
          <Icon name="scissors" size={16} />
          {splitting ? 'Splitting…' : 'Split here'}
        </button>
      )}
      <button type="button" className={styles.pointBarBtn} onClick={() => deletePoint(point.id)}>
        <Icon name="trash" size={16} />
        Delete
      </button>
      <button type="button" className={styles.noticeClose} onClick={() => select(null)} aria-label="Deselect point">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
