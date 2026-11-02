import { Link } from 'react-router';
import { confirmAction } from '../../components/ConfirmDialog';
import { toast } from '../../components/Toast';
import { Badge, DataTable, PageHeader, Pager, QueryState, SearchBox } from './AdminUi';
import { adminApi, routeSources, useAdminMutation, useAdminPage, type AdminSourceFile } from './api';
import { fmtBytes, fmtDate } from './format';
import { useListParams } from './useListParams';
import styles from './Admin.module.css';

export function SourceFilesPage() {
  const { params, page, set } = useListParams(['q', 'routeId']);
  const files = useAdminPage<AdminSourceFile>('source-files', { ...params, page });
  const remove = useAdminMutation((id: string) => adminApi.delete(`source-files/${id}`));

  return (
    <>
      <PageHeader title="Source files" sub="The original GPX and FIT uploads kept for imported routes. They make up most of the database size." />
      <div className={styles.toolbar}>
        <SearchBox value={params.q} onChange={(q) => set({ q })} placeholder="Search by file name" />
        {params.routeId && <button type="button" className="btn" onClick={() => set({ routeId: undefined })}>Route filter ✕</button>}
      </div>
      <QueryState query={files}>
        {files.data && (
          <>
            <DataTable
              rows={files.data.items}
              rowKey={(f) => f.id}
              columns={[
                { header: 'File', cell: (f) => <strong>{f.fileName}</strong> },
                { header: 'Kind', cell: (f) => <Badge>{routeSources.find((s) => s.id === f.kind)?.label ?? f.kind}</Badge> },
                { header: 'Route', cell: (f) => (f.routeName ? <Link to={`/admin/routes?q=${f.routeId}`}>{f.routeName}</Link> : '–') },
                { header: 'Size', cell: (f) => fmtBytes(f.sizeBytes), className: styles.num },
                { header: 'Uploaded', cell: (f) => fmtDate(f.uploadedAt) },
                {
                  header: 'Actions',
                  cell: (f) => (
                    <span className={styles.rowActions}>
                      <a className="btn" href={`/api/admin/source-files/${f.id}/download`} download>Download</a>
                      <button type="button" className="btn btn-danger" disabled={remove.isPending} onClick={async () => {
                        if (await confirmAction({ title: 'Delete this file?', body: 'The stored original is removed permanently; the route is unaffected.', confirmLabel: 'Delete file', tone: 'danger', icon: 'trash' }))
                          remove.mutate(f.id, { onSuccess: () => toast('File deleted.') });
                      }}>Delete</button>
                    </span>
                  ),
                },
              ]}
            />
            <Pager data={files.data} onPage={(p) => set({ page: p })} />
          </>
        )}
      </QueryState>
    </>
  );
}
