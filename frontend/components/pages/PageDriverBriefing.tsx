/**
 * PageDriverBriefing — Briefing pré-départ QHSE côté chauffeur (v2).
 *
 * Refonte 2026-04-24 : charge le BriefingTemplate par défaut du tenant et
 * présente la check-list multi-chapitres (documents, véhicule, sécurité,
 * confort, passagers, itinéraire, urgences, état conducteur). Signature
 * triple méthode (dessin SVG / PIN sha-256 / biométrie WebAuthn) via
 * BriefingSignatureInput. Non bloquant par défaut (politique tenant).
 *
 * Permission : DRIVER_REST_OWN ou BRIEFING_SIGN_OWN (gatées par la nav).
 * Accessibilité WCAG AA · Dark+Light · i18n fr+en (namespace driverBriefing).
 */

import { useMemo, useState, type FormEvent } from 'react';
import { ClipboardCheck, CheckCircle2, ShieldAlert, Clock } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPost } from '../../lib/api';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { ErrorAlert } from '../ui/ErrorAlert';
import { inputClass } from '../ui/inputClass';
import {
  BriefingSignatureInput,
  type BriefingSignatureValue,
} from '../ui/BriefingSignatureInput';

// ─── Types ──────────────────────────────────────────────────────────────

type ItemKind = 'CHECK' | 'QUANTITY' | 'DOCUMENT' | 'ACKNOWLEDGE' | 'INFO';

interface MyAssignment {
  id:       string;
  tripId:   string;
  staffId:  string;
  crewRole: string;
  briefedAt:       string | null;
  trip: {
    id: string;
    reference?: string | null;
    departureScheduled?: string | null;
    status?: string | null;
    route?: {
      name?: string | null;
      origin?:      { name: string } | null;
      destination?: { name: string } | null;
    } | null;
    bus?: { plateNumber: string } | null;
  };
  briefingRecord: { id: string; anomaliesCount?: number; allEquipmentOk: boolean; completedAt: string } | null;
}

interface TemplateItem {
  id:          string;
  code:        string;
  kind:        ItemKind;
  labelFr:     string;
  labelEn:     string;
  helpFr?:     string | null;
  helpEn?:     string | null;
  requiredQty: number;
  isMandatory: boolean;
  isActive:    boolean;
  order:       number;
  autoSource?: string | null;
  evidenceAllowed?: boolean;
}

interface TemplateSection {
  id:       string;
  code:     string;
  titleFr:  string;
  titleEn:  string;
  order:    number;
  isActive: boolean;
  items:    TemplateItem[];
}

interface Template {
  id:       string;
  name:     string;
  sections: TemplateSection[];
}

const ROLE_LABELS: Record<string, string> = {
  DRIVER:            'driverBriefing.roleDriver',
  CO_PILOT:          'driverBriefing.roleCoPilot',
  HOSTESS:           'driverBriefing.roleHostess',
  SECURITY:          'driverBriefing.roleSecurity',
  MECHANIC_ON_BOARD: 'driverBriefing.roleMechanic',
};

export function PageDriverBriefing() {
  const { t }        = useI18n();
  const { user }     = useAuth();
  const tenantId     = user?.tenantId ?? '';
  const myUserId     = user?.id ?? '';
  const base         = `/api/tenants/${tenantId}/crew-briefing`;

  const { data: assignments, loading: loadingAssignments, refetch: refetchAssignments } =
    useFetch<MyAssignment[]>(tenantId ? `/api/tenants/${tenantId}/crew-assignments/my` : null, [tenantId]);

  const { data: template, loading: loadingTemplate } =
    useFetch<Template | null>(tenantId ? `${base}/templates/default` : null, [tenantId]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, { passed: boolean; qty: number; notes?: string }>>({});
  const [signature, setSignature] = useState<BriefingSignatureValue | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = useMemo(() => (assignments ?? []).filter(a => !a.briefingRecord), [assignments]);
  const done    = useMemo(() => (assignments ?? []).filter(a =>  a.briefingRecord), [assignments]);
  const selected = assignments?.find(a => a.id === selectedId) ?? null;

  const activeSections = useMemo(
    () => (template?.sections ?? []).filter(s => s.isActive).sort((a, b) => a.order - b.order),
    [template],
  );

  const openChecklist = (a: MyAssignment) => {
    setSelectedId(a.id);
    setSignature(null);
    setNotes('');
    setError(null);
    // Pré-cocher les items auto-calculés (le backend recalculera de toute façon).
    const init: Record<string, { passed: boolean; qty: number; notes?: string }> = {};
    for (const sec of template?.sections ?? []) {
      for (const item of sec.items.filter(i => i.isActive)) {
        init[item.id] = {
          passed: item.kind === 'INFO', // INFO auto-calc côté serveur, présumé OK ici
          qty:    item.kind === 'QUANTITY' ? item.requiredQty : 1,
        };
      }
    }
    setChecks(init);
  };

  const closeChecklist = () => {
    setSelectedId(null);
    setChecks({});
    setSignature(null);
    setNotes('');
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || !template || !signature?.isReady) {
      setError(t('driverBriefing.errSignatureRequired'));
      return;
    }
    setBusy(true); setError(null);
    try {
      const items = Object.entries(checks).map(([itemId, c]) => ({
        itemId,
        passed: c.passed,
        qty:    c.qty,
        notes:  c.notes,
      }));
      await apiPost(`${base}/briefings/v2`, {
        assignmentId:  selected.id,
        templateId:    template.id,
        conductedById: myUserId, // chauffeur se brief lui-même (scope=own)
        items,
        driverSignature: {
          method:           signature.method,
          blob:             signature.blob,
          acknowledgedById: myUserId,
        },
        briefingNotes: notes || undefined,
      });
      await refetchAssignments();
      closeChecklist();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  };

  if (loadingAssignments || loadingTemplate) {
    return <div className="p-6"><Skeleton className="h-40 w-full" /></div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <ClipboardCheck className="w-6 h-6 text-blue-600 dark:text-blue-400" aria-hidden="true" />
          {t('driverBriefing.pageTitle')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('driverBriefing.pageSubtitle')}
        </p>
      </header>

      {/* À signer */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('driverBriefing.toSign')} <Badge variant="default">{pending.length}</Badge>
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('driverBriefing.toSignDesc')}</p>
        </CardHeader>
        <CardContent>
          {pending.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400" role="status">
              {t('driverBriefing.noPending')}
            </p>
          )}
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {pending.map(a => (
              <li key={a.id} className="py-3 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                    {a.trip.route?.origin?.name ?? '?'} → {a.trip.route?.destination?.name ?? '?'}
                    {a.trip.reference && <span className="ml-2 text-xs text-gray-500">#{a.trip.reference}</span>}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2 mt-0.5">
                    <Clock className="w-3 h-3" aria-hidden="true" />
                    {a.trip.departureScheduled && new Date(a.trip.departureScheduled).toLocaleString()}
                    {' · '}{t(ROLE_LABELS[a.crewRole] ?? 'driverBriefing.roleDriver')}
                    {a.trip.bus?.plateNumber && ` · ${a.trip.bus.plateNumber}`}
                  </p>
                </div>
                <Button size="sm" onClick={() => openChecklist(a)}>
                  {t('driverBriefing.doBriefing')}
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Récents */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('driverBriefing.recentBriefings')}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">{t('driverBriefing.recentDesc')}</p>
        </CardHeader>
        <CardContent>
          {done.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">—</p>
          )}
          <ul className="divide-y divide-gray-200 dark:divide-gray-700">
            {done.map(a => {
              const ok = (a.briefingRecord?.anomaliesCount ?? 0) === 0 && a.briefingRecord?.allEquipmentOk !== false;
              return (
                <li key={a.id} className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {a.trip.route?.origin?.name ?? '?'} → {a.trip.route?.destination?.name ?? '?'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {a.briefingRecord && new Date(a.briefingRecord.completedAt).toLocaleString()}
                    </p>
                  </div>
                  {ok ? (
                    <Badge variant="success">
                      <CheckCircle2 className="w-3 h-3 mr-1" aria-hidden="true" /> {t('driverBriefing.compliant')}
                    </Badge>
                  ) : (
                    <Badge variant="warning">
                      <ShieldAlert className="w-3 h-3 mr-1" aria-hidden="true" /> {t('driverBriefing.nonCompliant')}
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {/* Dialog checklist */}
      <Dialog
        open={!!selected}
        onOpenChange={(v) => { if (!v && !busy) closeChecklist(); }}
        title={t('driverBriefing.checklistTitle')}
        description={t('driverBriefing.checklistDesc')}
        size="lg"
      >
        {selected && template && (
          <form onSubmit={submit} className="p-6 space-y-5">
            {activeSections.length === 0 && (
              <p className="text-sm text-amber-700 dark:text-amber-300">{t('driverBriefing.noTemplate')}</p>
            )}

            {activeSections.map(sec => (
              <fieldset key={sec.id} className="rounded-md border border-gray-200 dark:border-gray-700 p-3">
                <legend className="px-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {sec.titleFr}
                </legend>
                <ul className="space-y-2 mt-2">
                  {sec.items.filter(i => i.isActive).sort((a, b) => a.order - b.order).map(item => (
                    <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
                      <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checks[item.id]?.passed ?? false}
                          onChange={e => setChecks(c => ({
                            ...c,
                            [item.id]: { ...c[item.id], passed: e.target.checked, qty: c[item.id]?.qty ?? item.requiredQty },
                          }))}
                          aria-label={item.labelFr}
                          disabled={item.kind === 'INFO'}
                          className="w-4 h-4"
                        />
                        <span className="truncate">
                          {item.labelFr}
                          {item.isMandatory && <span className="ml-1 text-red-600 dark:text-red-400">*</span>}
                        </span>
                        {item.kind === 'INFO' && (
                          <Badge variant="default">{t('driverBriefing.autoComputed')}</Badge>
                        )}
                      </label>
                      {item.kind === 'QUANTITY' && (
                        <input
                          type="number" min="0"
                          value={checks[item.id]?.qty ?? item.requiredQty}
                          onChange={e => setChecks(c => ({
                            ...c,
                            [item.id]: { ...c[item.id], qty: parseInt(e.target.value, 10) || 0 },
                          }))}
                          className={`${inputClass} w-20`}
                          aria-label={`${item.labelFr} — qty`}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </fieldset>
            ))}

            <div>
              <label htmlFor="notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('driverBriefing.observations')}
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                className={inputClass}
                placeholder={t('driverBriefing.obsPlaceholder')}
              />
            </div>

            <div className="rounded-md border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-900/40">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
                {t('driverBriefing.signatureTitle')}
              </p>
              <BriefingSignatureInput onChange={setSignature} />
            </div>

            {error && <ErrorAlert error={error} />}

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
              <Button type="button" variant="outline" onClick={closeChecklist} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={busy || !signature?.isReady} data-testid="briefing-submit">
                {busy ? t('driverBriefing.saving') : t('driverBriefing.signBriefing')}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
