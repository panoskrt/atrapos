import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { confirmAction } from '../../components/ConfirmDialog';
import { Spinner } from '../../components/Spinner';
import { toast } from '../../components/Toast';
import { api } from '../../lib/api';
import { DataTable, Facts, Modal, PageHeader, Pager, QueryState, SearchBox, Badge } from './AdminUi';
import { adminApi, adminPath, useAdminMutation, useAdminPage, type AdminErrorLog, type AdminSyncLog } from './api';
import { fmtDate, ownerLabel } from './format';
import { useListParams } from './useListParams';
import styles from './Admin.module.css';

function PurgeControl({ path, label }: { path: string; label: string }) {
  const [days, setDays] = useState(90);
  const purge = useAdminMutation(() => adminApi.post<{ deleted: number }>(`${path}/purge`, { olderThanDays: days }));
  return (
    <div className={styles.purge}>
      <label>
        Older than
        <input type="number" min={0} max={3650} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Days" /> days
      </label>
      <button type="button" className="btn btn-danger" disabled={purge.isPending} onClick={async () => {
        if (!(await confirmAction({
          title: `Delete ${label}?`,
          body: days === 0 ? `Every ${label} entry is removed permanently.` : `Entries older than ${days} days are removed permanently.`,
          confirmLabel: 'Delete entries', tone: 'danger', icon: 'trash',
        }))) return;
        purge.mutate(undefined, {
          onSuccess: (r) => toast(`${r.deleted} entries deleted.`),
          onError: (e) => toast(e.message, { tone: 'error' }),
        });
      }}>Purge</button>
    </div>
  );
}

export function SyncLogPage() {
  const { params, page, set } = useListParams(['q', 'userId', 'entity', 'operation']);
  const log = useAdminPage<AdminSyncLog>('sync-log', { ...params, page });
  const remove = useAdminMutation((id: number) => adminApi.delete(`sync-log/${id}`));

  return (
    <>
      <PageHeader title="Sync log" sub="Audit trail of operations against the Suunto API." actions={<PurgeControl path="sync-log" label="sync log" />} />
      <div className={styles.toolbar}>
        <SearchBox value={params.q} onChange={(q) => set({ q })} placeholder="Search message or entity id" />
        <select aria-label="Entity" value={params.entity} onChange={(e) => set({ entity: e.target.value })}>
          <option value="">Any entity</option>
          <option value="route">Route</option>
          <option value="poi">POI</option>
          <option value="account">Account</option>
        </select>
        <input aria-label="Operation" placeholder="Operation (e.g. conflict)" defaultValue={params.operation}
          onBlur={(e) => set({ operation: e.target.value.trim() })} onKeyDown={(e) => e.key === 'Enter' && set({ operation: e.currentTarget.value.trim() })} />
        {params.userId && <button type="button" className="btn" onClick={() => set({ userId: undefined })}>User filter ✕</button>}
      </div>
      <QueryState query={log}>
        {log.data && (
          <>
            <DataTable
              rows={log.data.items}
              rowKey={(l) => l.id}
              columns={[
                { header: 'When', cell: (l) => fmtDate(l.at) },
                { header: 'User', cell: (l) => ownerLabel(l.owner, l.userId) },
                { header: 'Entity', cell: (l) => <Badge>{l.entity}</Badge> },
                { header: 'Operation', cell: (l) => l.operation },
                { header: 'Status', cell: (l) => l.httpStatus ?? '–', className: styles.num },
                { header: 'Message', cell: (l) => <span className={styles.wrap}>{l.message ?? '–'}</span> },
                {
                  header: '',
                  cell: (l) => (
                    <button type="button" className="btn btn-icon" aria-label="Delete entry" disabled={remove.isPending}
                      onClick={() => remove.mutate(l.id, { onSuccess: () => toast('Entry deleted.') })}>✕</button>
                  ),
                },
              ]}
            />
            <Pager data={log.data} onPage={(p) => set({ page: p })} />
          </>
        )}
      </QueryState>
    </>
  );
}

export function ErrorLogPage() {
  const { params, page, set } = useListParams(['q', 'userId', 'status']);
  const log = useAdminPage<AdminErrorLog>('error-logs', { ...params, page });
  const [openId, setOpenId] = useState<number | null>(null);

  return (
    <>
      <PageHeader title="Error log" sub="Exceptions the app caught, newest first." actions={<PurgeControl path="error-logs" label="error log" />} />
      <div className={styles.toolbar}>
        <SearchBox value={params.q} onChange={(q) => set({ q })} placeholder="Search message, operation, exception or user" />
        <input type="number" aria-label="HTTP status" placeholder="HTTP status" defaultValue={params.status}
          onBlur={(e) => set({ status: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && set({ status: e.currentTarget.value })} />
        {params.userId && <button type="button" className="btn" onClick={() => set({ userId: undefined })}>User filter ✕</button>}
      </div>
      <QueryState query={log}>
        {log.data && (
          <>
            <DataTable
              rows={log.data.items}
              rowKey={(l) => l.id}
              onRowClick={(l) => setOpenId(l.id)}
              columns={[
                { header: 'When', cell: (l) => fmtDate(l.at) },
                { header: 'Operation', cell: (l) => <code>{l.operation}</code> },
                { header: 'User', cell: (l) => l.username ?? '–' },
                { header: 'Status', cell: (l) => (l.httpStatus ? <Badge tone={l.httpStatus >= 500 ? 'danger' : 'warn'}>{l.httpStatus}</Badge> : '–') },
                { header: 'Exception', cell: (l) => l.exceptionType?.split('.').pop() ?? '–' },
                { header: 'Message', cell: (l) => <span className={styles.clip}>{l.message}</span> },
              ]}
            />
            <Pager data={log.data} onPage={(p) => set({ page: p })} />
          </>
        )}
      </QueryState>
      {openId !== null && <ErrorDialog id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function ErrorDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ['admin', `error-logs/${id}`],
    queryFn: () => api.get<{ row: AdminErrorLog; stackTrace: string | null }>(adminPath(`error-logs/${id}`)),
  });
  const remove = useAdminMutation(() => adminApi.delete(`error-logs/${id}`));
  return (
    <Modal title="Error" onClose={onClose} wide>
      {detail.isPending && <div className={styles.state}><Spinner size={20} /> Loading…</div>}
      {detail.isError && <p className={styles.error} role="alert">{detail.error.message}</p>}
      {detail.data && (
        <>
          <Facts items={[
            ['When', fmtDate(detail.data.row.at)],
            ['Operation', <code key="o">{detail.data.row.operation}</code>],
            ['User', detail.data.row.username ?? '–'],
            ['Request', detail.data.row.requestPath ?? '–'],
            ['Status', detail.data.row.httpStatus ?? '–'],
            ['Exception', detail.data.row.exceptionType ?? '–'],
          ]} />
          <p className={styles.wrap}>{detail.data.row.message}</p>
          {detail.data.stackTrace && <pre className={styles.pre}>{detail.data.stackTrace}</pre>}
          <div className={styles.formActions}>
            <button type="button" className="btn btn-danger" disabled={remove.isPending}
              onClick={() => remove.mutate(undefined, { onSuccess: () => { toast('Entry deleted.'); onClose(); } })}>Delete entry</button>
            <span className={styles.spacer} />
            <button type="button" className="btn" onClick={onClose}>Close</button>
          </div>
        </>
      )}
    </Modal>
  );
}
