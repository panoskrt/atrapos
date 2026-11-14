import { useState } from 'react';
import { Link } from 'react-router';
import { confirmAction } from '../../components/ConfirmDialog';
import { toast } from '../../components/Toast';
import { Badge, DataTable, ErrorNote, Facts, Field, Modal, Pager, QueryState, SearchBox, PageHeader, fieldErrors } from './AdminUi';
import { adminApi, useAdminMutation, useAdminPage, type AdminUser } from './api';
import { fmtDate, ownerLabel, shortId } from './format';
import { useListParams } from './useListParams';
import styles from './Admin.module.css';

export function UsersPage() {
  const { params, page, set } = useListParams(['q']);
  const users = useAdminPage<AdminUser>('users', { ...params, page });
  const [editing, setEditing] = useState<AdminUser | null>(null);

  return (
    <>
      <PageHeader title="Users" sub="App accounts, created when someone signs in with Google or Suunto." />
      <div className={styles.toolbar}>
        <SearchBox value={params.q} onChange={(q) => set({ q })} placeholder="Search by username, Google id or user id" />
      </div>
      <QueryState query={users}>
        {users.data && (
          <>
            <DataTable
              rows={users.data.items}
              rowKey={(u) => u.id}
              onRowClick={setEditing}
              columns={[
                { header: 'Account', cell: (u) => <strong>{ownerLabel(u.suuntoUsername, u.id)}</strong> },
                {
                  header: 'Sign-in',
                  cell: (u) => (
                    <span className={styles.badges}>
                      {u.googleAccount && <Badge tone="accent">Google</Badge>}
                      {u.suuntoUsername && <Badge>Suunto</Badge>}
                    </span>
                  ),
                },
                { header: 'Suunto', cell: (u) => (u.suuntoConnected ? <Badge tone="ok">Connected</Badge> : <Badge tone="muted">Not connected</Badge>) },
                { header: 'Routes', cell: (u) => <Link to={`/admin/routes?userId=${u.id}`} onClick={(e) => e.stopPropagation()}>{u.routeCount}</Link>, className: styles.num },
                { header: 'POIs', cell: (u) => <Link to={`/admin/pois?userId=${u.id}`} onClick={(e) => e.stopPropagation()}>{u.poiCount}</Link>, className: styles.num },
                { header: 'Created', cell: (u) => fmtDate(u.createdAt) },
              ]}
            />
            <Pager data={users.data} onPage={(p) => set({ page: p })} />
          </>
        )}
      </QueryState>
      {editing && <UserDialog user={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function UserDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [form, setForm] = useState({
    defaultMap: user.defaultMap,
    units: user.units,
    theme: user.theme,
    design: user.design,
    menuPosition: user.menuPosition,
  });
  const save = useAdminMutation((body: typeof form) => adminApi.put<AdminUser>(`users/${user.id}`, body));
  const disconnect = useAdminMutation(() => adminApi.post(`users/${user.id}/disconnect-suunto`));
  const remove = useAdminMutation(() => adminApi.delete(`users/${user.id}`));
  const errors = fieldErrors(save.error);
  const busy = save.isPending || disconnect.isPending || remove.isPending;

  return (
    <Modal title={ownerLabel(user.suuntoUsername, user.id)} onClose={onClose}>
      <Facts
        items={[
          ['User id', <code key="id">{user.id}</code>],
          ['Suunto username', user.suuntoUsername ?? '–'],
          ['Google account', user.googleAccount ? 'Yes' : 'No'],
          ['Suunto connected', user.suuntoConnected ? 'Yes' : 'No'],
          ['Last Suunto refresh', fmtDate(user.lastSuuntoRefreshAt)],
          ['Created', fmtDate(user.createdAt)],
          ['Routes / POIs', `${user.routeCount} / ${user.poiCount}`],
        ]}
      />
      <h3 className={styles.sectionTitle}>Preferences</h3>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(form, { onSuccess: () => { toast('User saved.'); onClose(); } });
        }}
      >
        <div className={styles.formGrid}>
          <Field label="Default map" error={errors.defaultMap}>
            <select value={form.defaultMap} onChange={(e) => setForm({ ...form, defaultMap: e.target.value })}>
              <option value="osm">OpenStreetMap</option>
              <option value="topo">OpenTopoMap</option>
              <option value="cyclosm">CyclOSM</option>
            </select>
          </Field>
          <Field label="Units" error={errors.units}>
            <select value={form.units} onChange={(e) => setForm({ ...form, units: e.target.value })}>
              <option value="metric">Metric</option>
              <option value="imperial">Imperial</option>
            </select>
          </Field>
          <Field label="Appearance" error={errors.theme}>
            <select value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </Field>
          <Field label="Design" error={errors.design}>
            <select value={form.design} onChange={(e) => setForm({ ...form, design: e.target.value })}>
              <option value="classic">Classic</option>
              <option value="alpine">Alpine</option>
              <option value="soft">Soft</option>
            </select>
          </Field>
          <Field label="Menu position" error={errors.menuPosition}>
            <select value={form.menuPosition} onChange={(e) => setForm({ ...form, menuPosition: e.target.value })}>
              <option value="left">Left</option>
              <option value="top">Top</option>
            </select>
          </Field>
        </div>
        <ErrorNote error={save.error} />
        <div className={styles.formActions}>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={async () => {
            if (!(await confirmAction({
              title: 'Delete this user?',
              body: 'The account and everything it owns is removed permanently. This cannot be undone.',
              facts: [
                ['Routes', `${user.routeCount} deleted`, 'danger'],
                ['POIs', `${user.poiCount} deleted`, 'danger'],
                ['Source files and sync log', 'Deleted', 'danger'],
                ['Already on Suunto', 'Stays'],
              ],
              confirmLabel: 'Delete user',
              tone: 'danger',
              icon: 'trash',
            }))) return;
            remove.mutate(undefined, { onSuccess: () => { toast('User deleted.'); onClose(); }, onError: (e) => toast(e.message, { tone: 'error' }) });
          }}>Delete user</button>
          {user.suuntoConnected && (
            <button type="button" className="btn" disabled={busy} onClick={async () => {
              if (!(await confirmAction({
                title: 'Disconnect Suunto for this user?',
                body: 'Their stored Suunto tokens are removed. They keep their routes and POIs and can connect again.',
                confirmLabel: 'Disconnect',
                tone: 'danger',
                icon: 'unlink',
              }))) return;
              disconnect.mutate(undefined, { onSuccess: () => { toast('Suunto disconnected.'); onClose(); } });
            }}>Disconnect Suunto</button>
          )}
          <span className={styles.spacer} />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>Save</button>
        </div>
      </form>
      <p className={styles.hint}>Id {shortId(user.id)}… · identity fields are read-only: they come from sign-in.</p>
    </Modal>
  );
}
