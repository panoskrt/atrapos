import { useEffect } from 'react';
import { confirmPoiDelete } from '../pois/confirmDelete';
import { useEditorStore } from './store';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Ctrl/⌘+Z undo, Ctrl+Y / Ctrl+Shift+Z redo, Delete removes the selected point, Esc deselects.
 *  Ignored while typing so text fields keep their own undo. */
export function useEditorShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const { undo, redo } = useEditorStore.temporal.getState();
      const state = useEditorStore.getState();

      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedPoiId) {
        e.preventDefault();
        const poi = state.pois.find((p) => p.id === state.selectedPoiId);
        if (poi) void confirmPoiDelete(poi, state.poiServer[poi.id]).then((ok) => ok && state.deletePoi(poi.id));
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedId) {
        e.preventDefault();
        state.deletePoint(state.selectedId);
      } else if (e.key === 'Escape') {
        state.select(null);
        state.selectPoi(null);
        if (state.tool === 'poi') state.setTool('select');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
