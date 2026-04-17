/**
 * DriverLicensePanel — Source unique d'affichage des permis de conduire.
 *
 * Composant partagé qui :
 *   - Fetch les permis d'un staffId (ou de tous les chauffeurs si staffId absent)
 *   - Affiche la liste dans un format cohérent (clickable pour éditer)
 *   - Bouton "Ajouter" → ouvre LicenseFormModal en mode création
 *   - Clic sur une ligne → ouvre LicenseFormModal en mode édition
 *   - Prop readOnly → pas de boutons ni clics (portail chauffeur)
 *
 * Utilisé par :
 *   - PageDriverProfile (onglet Permis)
 *   - PagePersonnel (EditStaffForm)
 *   - PageDriverDocs (readOnly)
 *
 * WCAG 2.1 AA · Dark mode · Responsive · i18n
 */

import { useState } from 'react';
import {
  Shield, Plus, Trash2, Pencil, FileCheck, AlertTriangle,
} from 'lucide-react';
import { useI18n }    from '../../lib/i18n/useI18n';
import { useFetch }   from '../../lib/hooks/useFetch';
import { apiDelete, apiFetch } from '../../lib/api';
import { Badge }      from '../ui/Badge';
import { Button }     from '../ui/Button';
import { Skeleton }   from '../ui/Skeleton';
import { LicenseFormModal, type LicenseValues } from './LicenseFormModal';

// ─── Types ──────────────────────────────────────────────────────────────────

interface LicenseRow {
  id:            string;
  staffId:       string;
  category:      string;
  licenseNo:     string;
  issuedAt:      string;
  expiresAt:     string;
  issuingState?: string | null;
  status:        string;
  fileKey?:      string | null;
  staff?:        { user: { email: string; name?: string | null } };
}

export interface DriverLicensePanelProps {
  tenantId:  string;
  /** Si fourni, affiche les permis d'un seul chauffeur. Sinon, tous les permis du tenant. */
  staffId?:  string;
  /** Nom affiché du chauffeur (pour la modale quand staffId est fourni). */
  staffLabel?: string;
  /** Mode lecture seule — pas de boutons créer/éditer/supprimer. */
  readOnly?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function daysUntil(iso: string): number {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const target = new Date(iso); target.setHours(0, 0, 0, 0);
  return Math.floor((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
  VALID: 'success', EXPIRING: 'warning', EXPIRED: 'danger', SUSPENDED: 'danger',
};

// ─── Component ──────────────────────────────────────────────────────────────

export function DriverLicensePanel({
  tenantId, staffId, staffLabel, readOnly = false,
}: DriverLicensePanelProps) {
  const { t } = useI18n();

  // Fetch selon le mode : un chauffeur ou tous
  const endpoint = staffId
    ? `/api/tenants/${tenantId}/driver-profile/drivers/${staffId}/licenses`
    : `/api/tenants/${tenantId}/driver-profile/licenses`;

  const { data, loading, refetch } = useFetch<LicenseRow[]>(
    tenantId ? endpoint : null,
    [tenantId, staffId],
  );

  const licenses = data ?? [];

  // ── Fetch ALL staff (mode multi-driver) pour peupler le combobox ──
  // Inclut les chauffeurs sans permis — sinon ils n'apparaissent jamais.
  const allStaffRes = useFetch<{ id: string; userId: string; user: { name?: string | null; email: string } }[]>(
    !staffId && tenantId ? `/api/tenants/${tenantId}/staff` : null,
    [tenantId, staffId],
  );

  // ── Modal state ──
  const [showCreate, setShowCreate]    = useState(false);
  const [editing, setEditing]          = useState<LicenseRow | null>(null);
  const [busy, setBusy]                = useState(false);
  const [error, setError]              = useState<string | null>(null);

  // ── Drivers list pour la modale (si staffId connu → 1 seul driver) ──
  const driverOptions = staffId && staffLabel
    ? [{ id: staffId, label: staffLabel }]
    : (allStaffRes.data ?? [])
      .map(s => ({ id: s.id, label: s.user?.name ?? s.user?.email ?? s.id }))
      .sort((a, b) => a.label.localeCompare(b.label));

  // ── Handlers ──
  const handleSubmit = async (v: LicenseValues, file?: File) => {
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      if (editing) {
        // PATCH
        fd.append('licenseNo', v.licenseNo);
        if (v.issuedAt)     fd.append('issuedAt',     v.issuedAt);
        if (v.expiresAt)    fd.append('expiresAt',    v.expiresAt);
        if (v.issuingState) fd.append('issuingState', v.issuingState);
        if (file)           fd.append('file',         file);
        await apiFetch(`/api/tenants/${tenantId}/driver-profile/licenses/${editing.id}`, {
          method: 'PATCH', body: fd,
        });
      } else {
        // POST
        fd.append('staffId',   v.staffId);
        fd.append('category',  v.category);
        fd.append('licenseNo', v.licenseNo);
        fd.append('issuedAt',  v.issuedAt);
        fd.append('expiresAt', v.expiresAt);
        if (v.issuingState) fd.append('issuingState', v.issuingState);
        if (file)           fd.append('file',         file);
        await apiFetch(`/api/tenants/${tenantId}/driver-profile/licenses`, {
          method: 'POST', body: fd,
        });
      }
      setShowCreate(false);
      setEditing(null);
      refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('driverLicense.createError'));
    } finally { setBusy(false); }
  };

  const handleDelete = async (lic: LicenseRow) => {
    if (!window.confirm(`${t('common.delete')} — ${lic.licenseNo} (${lic.category}) ?`)) return;
    try {
      await apiDelete(`/api/tenants/${tenantId}/driver-profile/licenses/${lic.id}`);
      refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('driverLicense.createError'));
    }
  };

  // ── Expiry alert ──
  const expiringCount = licenses.filter(l => daysUntil(l.expiresAt) < 30).length;

  // ── Render ──
  return (
    <div className="space-y-3">
      {/* Alert banner */}
      {expiringCount > 0 && (
        <div
          className="flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
          role="alert"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden />
          <span>
            {expiringCount === 1
              ? t('licensePanel.oneExpiring')
              : t('licensePanel.manyExpiring', { count: String(expiringCount) })}
          </span>
        </div>
      )}

      {/* Header bar */}
      {!readOnly && (
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('licensePanel.title')}
          </p>
          <Button
            type="button"
            size="sm"
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); setShowCreate(true); setError(null); }}
          >
            <Plus className="w-4 h-4 mr-1" aria-hidden />
            {t('licensePanel.add')}
          </Button>
        </div>
      )}

      {readOnly && licenses.length > 0 && (
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('licensePanel.title')}
        </p>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-2" aria-busy="true">
          {[1, 2].map(i => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      )}

      {/* Empty state */}
      {!loading && licenses.length === 0 && (
        <div className="py-8 text-center text-slate-500 dark:text-slate-400" role="status">
          <Shield className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-600" aria-hidden />
          <p className="text-sm">{t('licensePanel.empty')}</p>
        </div>
      )}

      {/* License list */}
      {!loading && licenses.length > 0 && (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden" role="list">
          {licenses.map(lic => {
            const days = daysUntil(lic.expiresAt);
            const isClickable = !readOnly;

            return (
              <li
                key={lic.id}
                className={
                  'flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-900 ' +
                  (isClickable
                    ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors'
                    : '')
                }
                onClick={isClickable ? () => { setEditing(lic); setError(null); } : undefined}
                role={isClickable ? 'button' : undefined}
                tabIndex={isClickable ? 0 : undefined}
                onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditing(lic); setError(null); } } : undefined}
                aria-label={isClickable ? `${t('common.edit')} — ${lic.licenseNo}` : undefined}
              >
                {/* Left: info */}
                <div className="min-w-0 flex-1">
                  {/* Staff name (only in multi-driver mode) */}
                  {!staffId && lic.staff && (
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {lic.staff.user.name ?? lic.staff.user.email}
                    </p>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-mono font-medium text-slate-900 dark:text-slate-100">
                      {lic.licenseNo}
                    </span>
                    <Badge variant="outline" size="sm">Cat. {lic.category}</Badge>
                    {lic.issuingState && (
                      <span className="text-xs text-slate-500 dark:text-slate-400">{lic.issuingState}</span>
                    )}
                    {lic.fileKey && (
                      <FileCheck className="w-3.5 h-3.5 text-green-500" aria-label={t('licensePanel.scanAttached')} />
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {t('driverLicense.issuedAt')}: {formatDate(lic.issuedAt)}
                    {' · '}
                    {t('driverLicense.expiresAt')}: {formatDate(lic.expiresAt)}
                  </p>
                </div>

                {/* Right: status + actions */}
                <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                  <Badge
                    variant={STATUS_VARIANT[lic.status] ?? 'default'}
                    size="sm"
                  >
                    {lic.status === 'EXPIRED'
                      ? t('licensePanel.expired')
                      : lic.status === 'EXPIRING'
                        ? `J-${Math.max(0, days)}`
                        : t('licensePanel.valid')}
                  </Badge>

                  {!readOnly && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setEditing(lic); setError(null); }}
                        className="p-1.5 rounded text-slate-400 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
                        aria-label={`${t('common.edit')} — ${lic.licenseNo}`}
                        title={t('common.edit')}
                      >
                        <Pencil className="w-3.5 h-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDelete(lic); }}
                        className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        aria-label={`${t('common.delete')} — ${lic.licenseNo}`}
                        title={t('common.delete')}
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden />
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Error */}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* ── LicenseFormModal (create / edit) ── */}
      <LicenseFormModal
        open={showCreate || !!editing}
        onClose={() => { setShowCreate(false); setEditing(null); setError(null); }}
        title={editing ? t('driverLicense.editTitle') : t('driverLicense.modalTitle')}
        drivers={driverOptions}
        lockStaff={!!staffId}
        existingFileKey={editing?.fileKey ?? null}
        licenseId={editing?.id}
        tenantId={tenantId}
        initial={editing ? {
          staffId:      editing.staffId,
          category:     editing.category,
          licenseNo:    editing.licenseNo,
          issuedAt:     editing.issuedAt ? editing.issuedAt.slice(0, 10) : '',
          expiresAt:    editing.expiresAt ? editing.expiresAt.slice(0, 10) : '',
          issuingState: editing.issuingState ?? '',
        } : staffId ? { staffId } : undefined}
        busy={busy}
        error={error}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
