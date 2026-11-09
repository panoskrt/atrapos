import L from 'leaflet';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import styles from './Editor.module.css';

/** A map overlay that collapses to a single icon button. The map tools and location search share it, so they look
 *  and behave the same: collapsed at first, the button toggles the content beside it and stays put. */
export function MapPanel({ icon, name, children }: { icon: IconName; name: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const ref = useRef<HTMLDivElement>(null);
  // The panel is inside the map's container: without this, a click in it (or Enter, which clicks Search) is also
  // a map click and adds a route point, a drag pans the map and scrolling the results zooms it.
  useEffect(() => {
    L.DomEvent.disableClickPropagation(ref.current!);
    L.DomEvent.disableScrollPropagation(ref.current!);
  }, []);
  return (
    <div ref={ref} className={`${styles.mapPanel} ${expanded ? styles.mapPanelOpen : ''}`}>
      <button
        type="button"
        className={styles.mapPanelToggle}
        aria-label={`${expanded ? 'Hide' : 'Show'} ${name}`}
        title={`${expanded ? 'Hide' : 'Show'} ${name}`}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded(!expanded)}
      >
        <Icon name={icon} />
      </button>
      <div id={contentId} className={styles.mapPanelContent} hidden={!expanded}>
        {children}
      </div>
    </div>
  );
}
