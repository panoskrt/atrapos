import { createElement } from 'react';
import { confirmAction } from '../../components/ConfirmDialog';
import type { EditorPoi, PoiServerState } from '../editor/store';

/** Deleting is local and undoable; only a POI that's already on Suunto needs a heads-up, because Suunto's POI API
 *  can't delete it there. */
export async function confirmPoiDelete(poi: Pick<EditorPoi, 'name'>, server: Pick<PoiServerState, 'suuntoPoiKey'> | undefined): Promise<boolean> {
  if (!server?.suuntoPoiKey) return true;
  return confirmAction({
    title: 'Delete POI here only?',
    body: createElement(
      'p',
      null,
      `"${poi.name}" will be removed from this app. Suunto's API can't delete POIs, so it `,
      createElement('strong', null, 'stays in your Suunto app and on your watch'),
      ' until you delete it there.',
    ),
    facts: [
      ['POI on Suunto', 'Stays'],
      ['Route waypoint', 'Removed at next route push'],
      ['Local POI', 'Deleted', 'danger'],
    ],
    confirmLabel: 'Delete locally',
    tone: 'danger',
  });
}

/** Bulk delete from the All POIs page. Local tombstones; POIs already on Suunto stay there. */
export async function confirmPoisDelete(pois: readonly { name: string; suuntoPoiKey: string | null }[]): Promise<boolean> {
  if (pois.length === 1) return confirmPoiDelete(pois[0]!, pois[0]!);
  const onSuunto = pois.filter((p) => p.suuntoPoiKey).length;
  const n = pois.length;
  return confirmAction({
    title: `Delete ${n} POIs?`,
    body: onSuunto
      ? createElement(
          'p',
          null,
          `${n} POIs will be removed from this app. ${onSuunto === 1 ? '1 of them is' : `${onSuunto} of them are`} in your Suunto app. Suunto's API can't delete POIs, so `,
          createElement('strong', null, `${onSuunto === 1 ? 'it stays' : 'they stay'} in the Suunto app and on your watch`),
          ` until you delete ${onSuunto === 1 ? 'it' : 'them'} there.`,
        )
      : createElement('p', null, `${n} POIs will be removed from this app. None of them were pushed to Suunto.`),
    facts: [
      ...(onSuunto ? ([['POIs on Suunto', `${onSuunto} stay`]] as [string, string][]) : []),
      ['Route waypoints', 'Removed at next route push'],
      ['Local POIs', `${n} deleted`, 'danger'],
    ],
    confirmLabel: `Delete ${n} POIs`,
    tone: 'danger',
  });
}
