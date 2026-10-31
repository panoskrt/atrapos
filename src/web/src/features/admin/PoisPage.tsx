import { useState } from 'react';
import { Link } from 'react-router';
import { confirmAction } from '../../components/ConfirmDialog';
import { Spinner } from '../../components/Spinner';
import { toast } from '../../components/Toast';
import { Badge, DataTable, ErrorNote, Facts, Field, Modal, PageHeader, Pager, QueryState, SearchBox, SyncBadge, fieldErrors } from './AdminUi';
import {
  adminApi, syncStates, useAdminItem, useAdminMutation, useAdminPage, useLookups, type AdminPoiDetail, type AdminPoiRow, type SyncState,
} from './api';
import { fmtDate, ownerLabel } from './format';
import { useListParams } from './useListParams';
import styles from './Admin.module.css';

export function PoisPage() {
  const { params, page, set } = useListParams(['q', 'userId', 'routeId', 'syncState', 'deleted']);
  const pois = useAdminPage<AdminPoiRow>('pois', { ...params, page });
  const { poiTypes } = useLookups();
  const [openId, setOpenId] = useState<string | null>(null);
  const typeName = (id: number) => poiTypes.find((t) => t.id === id)?.name ?? String(id);

  return (
    <>
      <PageHeader title="POIs" sub="Points of interest, including the soft-deleted ones the app hides." />
      <div className={styles.toolbar}>
        <SearchBox value={params.q} onChange={(q) => set({ q })} placeholder="Search by name, Suunto key or POI id" />
        <select aria-label="Sync state" value={params.syncState} onChange={(e) => set({ syncState: e.target.value })}>
          <option value="">Any sync state</option>
          {syncStates.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select aria-label="Deleted" value={params.deleted} onChange={(e) => set({ deleted: e.target.value })}>
          <option value="">Including deleted</option>
          <option value="exclude">Not deleted</option>
          <option value="only">Deleted only</option>
        </select>
        {params.userId && <button type="button" className="btn" onClick={() => set({ userId: undefined })}>Owner filter ✕</button>}
        {params.routeId && <button type="button" className="btn" onClick={() => set({ routeId: undefined })}>Route filter ✕</button>}
      </div>
      <QueryState query={pois}>
        {pois.data && (
          <>
            <DataTable
              rows={pois.data.items}
              rowKey={(p) => p.id}
              onRowClick={(p) => setOpenId(p.id)}
              columns={[
                { header: 'Name', cell: (p) => <strong>{p.name}</strong> },
                { header: 'Type', cell: (p) => typeName(p.poiType) },
                { header: 'Owner', cell: (p) => ownerLabel(p.owner, p.userId) },
                { header: 'Route', cell: (p) => p.routeName ?? '–' },
                { header: 'Sync', cell: (p) => <SyncBadge state={p.syncState} /> },
                { header: 'Status', cell: (p) => (p.deletedAt ? <Badge tone="danger">Deleted</Badge> : null) },
                { header: 'Modified', cell: (p) => fmtDate(p.localModifiedAt) },
              ]}
            />
            <Pager data={pois.data} onPage={(p) => set({ page: p })} />
          </>
        )}
      </QueryState>
      {openId && <PoiDialog id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function PoiDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useAdminItem<AdminPoiDetail>(`pois/${id}`);
  return (
    <Modal title={detail.data?.row.name ?? 'POI'} onClose={onClose} wide>
      {detail.isPending && <div className={styles.state}><Spinner size={20} /> Loading…</div>}
      {detail.isError && <p className={styles.error} role="alert">{detail.error.message}</p>}
      {detail.data && <PoiForm key={detail.data.row.localModifiedAt + detail.data.row.syncState} d={detail.data} onClose={onClose} />}
    </Modal>
  );
}

function PoiForm({ d, onClose }: { d: AdminPoiDetail; onClose: () => void }) {
  const { poiTypes, activities } = useLookups();
  const [form, setForm] = useState({
    name: d.row.name,
    description: d.description ?? '',
    poiType: d.row.poiType,
    lat: d.row.lat,
    lon: d.row.lon,
    elevationM: d.row.elevationM as number | null,
    activityId: d.activityId as number | null,
    syncState: d.row.syncState as SyncState,
    deleted: d.row.deletedAt !== null,
  });
  const save = useAdminMutation((body: typeof form) => adminApi.put(`pois/${d.row.id}`, body));
  const unlink = useAdminMutation(() => adminApi.post(`pois/${d.row.id}/unlink-suunto`));
  const remove = useAdminMutation(() => adminApi.delete(`pois/${d.row.id}`));
  const errors = fieldErrors(save.error);
  const busy = save.isPending || unlink.isPending || remove.isPending;

  return (
    <>
      <Facts
        items={[
          ['POI id', <code key="id">{d.row.id}</code>],
          ['Owner', <Link key="o" to={`/admin/users?q=${d.row.userId}`}>{ownerLabel(d.row.owner, d.row.userId)}</Link>],
          ['Route', d.row.routeName ?? 'Standalone'],
          ['Distance along route', d.row.distanceAlongM === null ? '–' : `${Math.round(d.row.distanceAlongM)} m`],
          ['Suunto POI key', d.row.suuntoPoiKey ?? '–'],
          ['Last pushed', fmtDate(d.lastPushedAt)],
          ['Created / modified', `${fmtDate(d.row.createdAt)} / ${fmtDate(d.row.localModifiedAt)}`],
          ['Deleted at', fmtDate(d.row.deletedAt)],
        ]}
      />
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(form, { onSuccess: () => { toast('POI saved.'); onClose(); } });
        }}
      >
        <Field label="Name" error={errors.name}>
          <input value={form.name} maxLength={200} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Description">
          <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <div className={styles.formGrid}>
          <Field label="Type" error={errors.poiType}>
            <select value={form.poiType} onChange={(e) => setForm({ ...form, poiType: Number(e.target.value) })}>
              {poiTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Activity" error={errors.activityId}>
            <select value={form.activityId ?? ''} onChange={(e) => setForm({ ...form, activityId: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">None</option>
              {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Latitude" error={errors.lat}>
            <input type="number" step="any" value={form.lat} onChange={(e) => setForm({ ...form, lat: Number(e.target.value) })} />
          </Field>
          <Field label="Longitude" error={errors.lon}>
            <input type="number" step="any" value={form.lon} onChange={(e) => setForm({ ...form, lon: Number(e.target.value) })} />
          </Field>
          <Field label="Elevation (m)" error={errors.elevationM}>
            <input type="number" step="any" value={form.elevationM ?? ''} onChange={(e) => setForm({ ...form, elevationM: e.target.value === '' ? null : Number(e.target.value) })} />
          </Field>
          <Field label="Sync state" error={errors.syncState}>
            <select value={form.syncState} onChange={(e) => setForm({ ...form, syncState: e.target.value as SyncState })}>
              {syncStates.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
        </div>
        <label className={styles.check}>
          <input type="checkbox" checked={form.deleted} onChange={(e) => setForm({ ...form, deleted: e.target.checked })} />
          Soft-deleted (hidden in the app; untick to restore)
        </label>
        <ErrorNote error={save.error} />
        <div className={styles.formActions}>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={async () => {
            if (!(await confirmAction({
              title: 'Delete this POI permanently?',
              body: 'Unlike deleting in the app, this removes the row entirely, so a POI already on Suunto is no longer tracked and a later push would create a duplicate.',
              confirmLabel: 'Delete permanently', tone: 'danger', icon: 'trash',
            }))) return;
            remove.mutate(undefined, { onSuccess: () => { toast('POI deleted.'); onClose(); }, onError: (e) => toast(e.message, { tone: 'error' }) });
          }}>Delete permanently</button>
          {d.row.suuntoPoiKey && (
            <button type="button" className="btn" disabled={busy} onClick={async () => {
              if (!(await confirmAction({
                title: 'Unlink from Suunto?',
                body: 'The stored Suunto key is forgotten, so the next push creates a new POI instead of updating the old one.',
                confirmLabel: 'Unlink', tone: 'danger', icon: 'unlink',
              }))) return;
              unlink.mutate(undefined, { onSuccess: () => { toast('POI unlinked.'); onClose(); } });
            }}>Unlink Suunto</button>
          )}
          <span className={styles.spacer} />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>Save</button>
        </div>
      </form>
    </>
  );
}
