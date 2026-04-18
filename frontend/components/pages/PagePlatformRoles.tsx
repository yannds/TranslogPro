/**
 * PagePlatformRoles — Rôles plateforme (read-only).
 *
 * Affiche les 3 rôles système plateforme (SUPER_ADMIN, SUPPORT_L1, SUPPORT_L2)
 * et leurs permissions courantes. Volontairement non-éditable : le jeu de
 * permissions est versionné dans le seed (prisma/seeds/iam.seed.ts) et
 * modifié via revue de code + re-run du seed. Évite toute dérive d'escalade
 * de privilèges par un SA qui se donnerait des perms à la volée.
 *
 * Endpoint : GET /api/platform/iam/roles
 * Permission : data.platform.iam.read.global
 */
import { useMemo, useState } from 'react';
import { Shield, ChevronDown, ChevronRight } from 'lucide-react';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { Badge } from '../ui/Badge';

interface RolePermission { permission: string }
interface PlatformRole {
  id:          string;
  name:        string;
  isSystem:    boolean;
  permissions: RolePermission[];
  _count:      { users: number };
}

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/20',
  SUPPORT_L1:  'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/20',
  SUPPORT_L2:  'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/20',
};

function groupPermissions(perms: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const p of perms) {
    // Forme : scope.module.action.level → on groupe par "scope.module"
    const parts = p.split('.');
    const key = parts.length >= 2 ? `${parts[0]}.${parts[1]}` : 'misc';
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  }
  for (const k of Object.keys(groups)) groups[k].sort();
  return groups;
}

function RoleCard({ role, defaultOpen }: { role: PlatformRole; defaultOpen: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const permStrings = role.permissions.map(p => p.permission);
  const grouped = useMemo(() => groupPermissions(permStrings), [permStrings]);
  const roleColor = ROLE_COLORS[role.name] ?? 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/20';

  return (
    <section
      className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
      aria-labelledby={`role-${role.id}-title`}
    >
      <header className="flex items-center justify-between gap-3 p-4 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-semibold font-mono ${roleColor}`}>
            {role.name}
          </span>
          <h2 id={`role-${role.id}-title`} className="text-sm text-slate-700 dark:text-slate-300 truncate">
            {role._count.users} {t('platformRoles.userCount')}
          </h2>
          {role.isSystem && (
            <Badge variant="default" size="sm">{t('platformRoles.systemRole')}</Badge>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded px-1"
          aria-expanded={open}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {permStrings.length} {t('platformRoles.permissionsLabel')}
        </button>
      </header>

      {open && (
        <div className="p-4 space-y-3">
          {Object.keys(grouped).sort().map(groupKey => (
            <div key={groupKey}>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                {groupKey}
              </p>
              <ul role="list" className="flex flex-wrap gap-1.5">
                {grouped[groupKey].map(p => (
                  <li
                    key={p}
                    className="inline-flex items-center font-mono text-[11px] px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300"
                  >
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {permStrings.length === 0 && (
            <p className="text-xs italic text-slate-400">{t('platformRoles.noPermissions')}</p>
          )}
        </div>
      )}
    </section>
  );
}

export function PagePlatformRoles() {
  const { t } = useI18n();
  const { data: roles, loading, error } = useFetch<PlatformRole[]>('/api/platform/iam/roles');

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Shield size={24} className="text-indigo-500 dark:text-indigo-400" />
          {t('platformRoles.title')}
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
          {t('platformRoles.subtitle')}
        </p>
      </div>

      <aside className="rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-3 text-xs text-amber-800 dark:text-amber-300">
        {t('platformRoles.readOnlyNotice')}
      </aside>

      {loading && (
        <div className="animate-pulse space-y-3">
          <div className="h-20 rounded-2xl bg-slate-100 dark:bg-slate-900" />
          <div className="h-20 rounded-2xl bg-slate-100 dark:bg-slate-900" />
          <div className="h-20 rounded-2xl bg-slate-100 dark:bg-slate-900" />
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {!loading && !error && (
        <div className="space-y-4">
          {(roles ?? []).map((role, idx) => (
            <RoleCard key={role.id} role={role} defaultOpen={idx === 0} />
          ))}
          {(roles ?? []).length === 0 && (
            <p className="text-sm text-slate-400 italic">{t('platformRoles.emptyMessage')}</p>
          )}
        </div>
      )}
    </div>
  );
}
