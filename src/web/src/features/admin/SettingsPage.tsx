import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from '../../components/Toast';
import { api } from '../../lib/api';
import { Badge, ErrorNote, PageHeader, QueryState } from './AdminUi';
import { adminApi, adminPath, useAdminMutation, type AdminConfig, type EditableSetting } from './api';
import styles from './Admin.module.css';

export function SettingsPage() {
  const config = useQuery({ queryKey: ['admin', 'config'], queryFn: () => api.get<AdminConfig>(adminPath('config')) });
  const save = useAdminMutation((body: Record<string, unknown>) => adminApi.put<AdminConfig>('config/auth', body));

  return (
    <>
      <PageHeader title="Settings" sub="Configuration of this Atrapos instance." />
      <QueryState query={config}>
        {config.data && (
          <>
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Sign-in allowlists</h2>
              <p className={styles.sub}>
                Only these accounts may sign in. Leave both lists empty to let any Google or Suunto account in. Changes take effect
                immediately, and sessions of accounts that are no longer allowed end within a few minutes. A list saved here overrides
                the one from the configuration files until you reset it.
              </p>
              <AllowlistEditor
                label="Google emails (verified)"
                setting={config.data.allowedGoogleEmails}
                busy={save.isPending}
                onSave={(v) => save.mutate({ googleEmails: v }, { onSuccess: () => toast('Allowlist saved.') })}
                onReset={() => save.mutate({ resetGoogleEmails: true }, { onSuccess: () => toast('Using the configured list.') })}
              />
              <AllowlistEditor
                label="Suunto usernames"
                setting={config.data.allowedSuuntoUsernames}
                busy={save.isPending}
                onSave={(v) => save.mutate({ suuntoUsernames: v }, { onSuccess: () => toast('Allowlist saved.') })}
                onReset={() => save.mutate({ resetSuuntoUsernames: true }, { onSuccess: () => toast('Using the configured list.') })}
              />
              <ErrorNote error={save.error} />
            </section>

            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Administrators</h2>
              <p className={styles.sub}>
                Set in configuration (<code>Admin:GoogleEmails</code>, <code>Admin:SuuntoUsernames</code>, or{' '}
                <code>ADMIN_GOOGLE_EMAILS</code> / <code>ADMIN_SUUNTO_USERNAMES</code> in <code>.env</code>), not editable here.
              </p>
              <dl className={styles.facts}>
                <div><dt>Google emails</dt><dd>{config.data.adminGoogleEmails || '–'}</dd></div>
                <div><dt>Suunto usernames</dt><dd>{config.data.adminSuuntoUsernames || '–'}</dd></div>
              </dl>
            </section>

            <section className={styles.card}>
              <h2 className={styles.cardTitle}>Effective configuration</h2>
              <p className={styles.sub}>Read-only. Changing these needs a restart. Secrets are never shown, only whether they are set.</p>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <tbody>
                    {config.data.entries.map((e) => (
                      <tr key={e.key}>
                        <th scope="row"><code>{e.key}</code></th>
                        <td>
                          {e.secret ? (e.value ? <Badge tone="ok">set</Badge> : <Badge tone="warn">not set</Badge>) : e.value || '–'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </QueryState>
    </>
  );
}

function AllowlistEditor({
  label, setting, busy, onSave, onReset,
}: {
  label: string;
  setting: EditableSetting;
  busy: boolean;
  onSave: (value: string) => void;
  onReset: () => void;
}) {
  const [text, setText] = useState(setting.value);
  useEffect(() => setText(setting.value), [setting.value]);
  return (
    <div className={styles.allowlist}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>
          {label} {setting.overridden ? <Badge tone="accent">Set here</Badge> : <Badge tone="muted">From configuration</Badge>}
        </span>
        <textarea rows={3} value={text} placeholder="One per line or comma-separated. Empty: no restriction." onChange={(e) => setText(e.target.value)} />
      </label>
      <div className={styles.formActions}>
        {setting.overridden && (
          <button type="button" className="btn" disabled={busy} onClick={onReset}>Reset to configured</button>
        )}
        <span className={styles.spacer} />
        <button type="button" className="btn btn-primary" disabled={busy || text === setting.value} onClick={() => onSave(text)}>Save</button>
      </div>
    </div>
  );
}
