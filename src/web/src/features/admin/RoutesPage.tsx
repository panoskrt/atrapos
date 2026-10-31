import { useState } from 'react';
import { Link } from 'react-router';
import { confirmAction } from '../../components/ConfirmDialog';
import { Spinner } from '../../components/Spinner';
import { toast } from '../../components/Toast';
import {
  Badge, DataTable, ErrorNote, Facts, Field, Modal, PageHeader, Pager, QueryState, SearchBox, SyncBadge, fieldErrors,
} from './AdminUi';
import {
  adminApi, routeSources, syncStates, useAdminItem, useAdminMutation, useAdminPage, useLookups,
  type AdminRouteDetail, type AdminRouteRow, type SyncState,
} from './api';
import { fmtBytes, fmtDate, fmtKm, ownerLabel } from './format';
import { useListParams } from './useListParams';
import styles from './Admin.module.css';

export function RoutesPage() {
  const { params, page, set } = useListParams(['q', 'userId', 'syncState', 'source']);
  const routes = useAdminPage<AdminRouteRow>('routes', { ...params, page });
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Routes" sub="Every route of every user." />
      <div className={styles.toolbar}>
        <SearchBox value={params.q} onChange={(q) => set({ q })} placeholder="Search by name, Suunto id or route id" />
        <select aria-label="Sync state" value={params.syncState} onChange={(e) => set({ syncState: e.target.value })}>
          <option value="">Any sync state</option>
          {syncStates.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select aria-label="Source" value={params.source} onChange={(e) => set({ source: e.target.value })}>
          <option value="">Any source</option>
          {routeSources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        {params.userId && (
          <button type="button" className="btn" onClick={() => set({ userId: undefined })}>Owner filter ✕</button>
        )}
      </div>
      <QueryState query={routes}>
        {routes.data && (
          <>
            <DataTable
              rows={routes.data.items}
              rowKey={(r) => r.id}
              onRowClick={(r) => setOpenId(r.id)}
              columns={[
                { header: 'Name', cell: (r) => <strong>{r.name}</strong> },
                { header: 'Owner', cell: (r) => ownerLabel(r.owner, r.userId) },
                { header: 'Source', cell: (r) => <Badge>{routeSources.find((s) => s.id === r.source)?.label ?? r.source}</Badge> },
                { header: 'Sync', cell: (r) => <SyncBadge state={r.syncState} /> },
                { header: 'Distance', cell: (r) => fmtKm(r.distanceM), className: styles.num },
                { header: 'Ascent', cell: (r) => `${Math.round(r.ascentM)} m`, className: styles.num },
                { header: 'POIs', cell: (r) => r.poiCount, className: styles.num },
                { header: 'Modified', cell: (r) => fmtDate(r.localModifiedAt) },
              ]}
            />
            <Pager data={routes.data} onPage={(p) => set({ page: p })} />
          </>
        )}
      </QueryState>
      {openId && <RouteDialog id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function RouteDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useAdminItem<AdminRouteDetail>(`routes/${id}`);
  return (
    <Modal title={detail.data?.row.name ?? 'Route'} onClose={onClose} wide>
      {detail.isPending && <div className={styles.state}><Spinner size={20} /> Loading…</div>}
      {detail.isError && <p className={styles.error} role="alert">{detail.error.message}</p>}
      {detail.data && <RouteForm key={detail.data.row.localModifiedAt + detail.data.row.syncState} d={detail.data} onClose={onClose} />}
    </Modal>
  );
}

function RouteForm({ d, onClose }: { d: AdminRouteDetail; onClose: () => void }) {
  const { activities, profiles } = useLookups();
  const [form, setForm] = useState({
    name: d.row.name,
    description: d.description ?? '',
    activityIds: d.activityIds,
    turnWaypointsEnabled: d.turnWaypointsEnabled,
    routingProfile: d.routingProfile,
    simplifyToleranceM: d.simplifyToleranceM,
    syncState: d.row.syncState as SyncState,
  });
  const save = useAdminMutation((body: typeof form) => adminApi.put(`routes/${d.row.id}`, body));
  const unlink = useAdminMutation(() => adminApi.post(`routes/${d.row.id}/unlink-suunto`));
  const remove = useAdminMutation(() => adminApi.delete(`routes/${d.row.id}`));
  const removeFile = useAdminMutation((fileId: string) => adminApi.delete(`source-files/${fileId}`));
  const errors = fieldErrors(save.error);
  const busy = save.isPending || unlink.isPending || remove.isPending;

  return (
    <>
      <Facts
        items={[
          ['Route id', <code key="id">{d.row.id}</code>],
          ['Owner', <Link key="o" to={`/admin/users?q=${d.row.userId}`}>{ownerLabel(d.row.owner, d.row.userId)}</Link>],
          ['Length', `${fmtKm(d.row.distanceM)} · +${Math.round(d.row.ascentM)} m / −${Math.round(d.row.descentM)} m`],
          ['Geometry', `${d.geometryPoints} points · ${d.controlPointCount} control points · ${d.hasElevation ? 'with' : 'no'} elevation`],
          ['Suunto route id', d.row.suuntoRouteId ?? '–'],
          ['Suunto revision', d.suuntoRevision ?? '–'],
          ['Last pushed', fmtDate(d.lastPushedAt)],
          ['Created / modified', `${fmtDate(d.row.createdAt)} / ${fmtDate(d.row.localModifiedAt)}`],
          ['POIs', <Link key="p" to={`/admin/pois?q=&routeId=${d.row.id}`}>{d.row.poiCount}</Link>],
        ]}
      />
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(form, { onSuccess: () => { toast('Route saved.'); onClose(); } });
        }}
      >
        <Field label="Name" error={errors.name}>
          <input value={form.name} maxLength={200} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Description">
          <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <fieldset className={styles.fieldset}>
          <legend>Activities</legend>
          <div className={styles.checks}>
            {activities.map((a) => (
              <label key={a.id} className={styles.check}>
                <input
                  type="checkbox"
                  checked={form.activityIds.includes(a.id)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      activityIds: e.target.checked ? [...form.activityIds, a.id] : form.activityIds.filter((x) => x !== a.id),
                    })
                  }
                />
                {a.name}
              </label>
            ))}
          </div>
          {errors.activityIds && <span className={styles.fieldError} role="alert">{errors.activityIds}</span>}
        </fieldset>
        <div className={styles.formGrid}>
          <Field label="Routing profile" error={errors.routingProfile}>
            <select value={form.routingProfile} onChange={(e) => setForm({ ...form, routingProfile: e.target.value })}>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Simplify tolerance (m)" error={errors.simplifyToleranceM}>
            <input type="number" min={0} max={1000} step="any" value={form.simplifyToleranceM}
              onChange={(e) => setForm({ ...form, simplifyToleranceM: Number(e.target.value) })} />
          </Field>
          <Field label="Sync state" error={errors.syncState} hint="Changing the content of a synced route marks it “Local changes” unless you pick a state.">
            <select value={form.syncState} onChange={(e) => setForm({ ...form, syncState: e.target.value as SyncState })}>
              {syncStates.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
          <label className={styles.check}>
            <input type="checkbox" checked={form.turnWaypointsEnabled} onChange={(e) => setForm({ ...form, turnWaypointsEnabled: e.target.checked })} />
            Turn-by-turn waypoints on push
          </label>
        </div>
        <ErrorNote error={save.error} />
        <div className={styles.formActions}>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={async () => {
            if (!(await confirmAction({
              title: 'Delete this route?',
              body: 'The route, its POIs and its source files are removed permanently. A copy already pushed to Suunto stays there.',
              confirmLabel: 'Delete route', tone: 'danger', icon: 'trash',
            }))) return;
            remove.mutate(undefined, { onSuccess: () => { toast('Route deleted.'); onClose(); }, onError: (e) => toast(e.message, { tone: 'error' }) });
          }}>Delete</button>
          {d.row.suuntoRouteId && (
            <button type="button" className="btn" disabled={busy} onClick={async () => {
              if (!(await confirmAction({
                title: 'Unlink from Suunto?',
                body: 'The stored Suunto id and revision are forgotten, so the next push creates a new route on Suunto instead of updating the old one.',
                confirmLabel: 'Unlink', tone: 'danger', icon: 'unlink',
              }))) return;
              unlink.mutate(undefined, { onSuccess: () => { toast('Route unlinked.'); onClose(); } });
            }}>Unlink Suunto</button>
          )}
          <span className={styles.spacer} />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>Save</button>
        </div>
      </form>
      {d.sourceFiles.length > 0 && (
        <>
          <h3 className={styles.sectionTitle}>Source files</h3>
          <ul className={styles.fileList}>
            {d.sourceFiles.map((f) => (
              <li key={f.id}>
                <span>{f.fileName} · {fmtBytes(f.sizeBytes)} · {fmtDate(f.uploadedAt)}</span>
                <a className="btn" href={`/api/admin/source-files/${f.id}/download`} download>Download</a>
                <button type="button" className="btn btn-danger" disabled={removeFile.isPending} onClick={async () => {
                  if (await confirmAction({ title: 'Delete this file?', body: 'The stored original is removed permanently; the route is unaffected.', confirmLabel: 'Delete file', tone: 'danger', icon: 'trash' }))
                    removeFile.mutate(f.id, { onSuccess: () => toast('File deleted.') });
                }}>Delete</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
