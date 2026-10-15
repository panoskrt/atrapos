import { confirmAction } from '../../components/ConfirmDialog';
import type { RouteSummary } from '../routes/api';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Route deletes are local and can't be undone. Anything already on Suunto stays there: its API has no delete. */
export function confirmRouteDelete(routes: readonly RouteSummary[]): Promise<boolean> {
  const onSuunto = routes.filter((r) => r.syncState !== 'localOnly').length;
  const pois = routes.reduce((n, r) => n + r.poiCount, 0);
  const poiText = plural(pois, 'POI', 'POIs');

  if (routes.length === 1) {
    const route = routes[0]!;
    return confirmAction(
      onSuunto
        ? {
            title: 'Delete from this app only?',
            body: (
              <p>
                "{route.name}" and its {poiText} will be removed here. Suunto's API can't delete routes or POIs, so they{' '}
                <strong>stay in your Suunto app and on your watch</strong> until you delete them there.
              </p>
            ),
            facts: [
              ['Route on Suunto', 'Stays'],
              [`${poiText} on Suunto`, 'Stay'],
              ['Local copy', 'Deleted', 'danger'],
            ],
            confirmLabel: 'Delete locally',
            tone: 'danger',
          }
        : {
            title: 'Delete route?',
            body: (
              <p>
                "{route.name}" and its {poiText} will be deleted. They were never pushed to Suunto, so this can't be
                undone.
              </p>
            ),
            confirmLabel: 'Delete',
            tone: 'danger',
          },
    );
  }

  const routeText = plural(routes.length, 'route', 'routes');
  return confirmAction({
    title: `Delete ${routeText}?`,
    body: onSuunto ? (
      <p>
        {routeText} and their {poiText} will be removed from this app. {plural(onSuunto, 'of them is', 'of them are')}{' '}
        in your Suunto app. Suunto's API can't delete routes or POIs, so{' '}
        <strong>{onSuunto === 1 ? 'it stays' : 'they stay'} in the Suunto app and on your watch</strong> until you
        delete {onSuunto === 1 ? 'it' : 'them'} there.
      </p>
    ) : (
      <p>
        {routeText} and their {poiText} will be deleted. None were pushed to Suunto, so this can't be undone.
      </p>
    ),
    facts: [
      ...(onSuunto ? ([['Routes on Suunto', `${onSuunto} stay`]] as [string, string][]) : []),
      ['Local copies', `${routes.length} deleted`, 'danger'],
    ],
    confirmLabel: `Delete ${routeText}`,
    tone: 'danger',
  });
}
