/**
 * PageDriverBriefing — Briefing pré-départ côté chauffeur
 *
 * Vue ciblée chauffeur : liste de MES affectations (endpoint /crew-assignments/my),
 * checklist équipements obligatoires, signature du briefing.
 *
 * Permission d'accès : DRIVER_REST_OWN (gatée par la nav).
 * Pas d'administration du catalogue, pas d'historique tenant — uniquement l'acte
 * de signer ma propre checklist pour une affectation que le responsable m'a attribuée.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { ClipboardCheck, CheckCircle2, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPost } from '../../lib/api';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { inputClass } from '../ui/inputClass';
import {
  BUS_EQUIPMENT_CATEGORIES,
  inferEquipmentCategory,
  type BusEquipmentCategory,
} from '../../lib/catalogs/busEquipment';

interface MyAssignment {
  id:             string;
  tripId:         string;
  staffId:        string;
  crewRole:       string;
  briefedAt:      string | null;
  trip:           { id: string; reference?: string | null; departureAt?: string | null };
  briefingRecord: { id: string; allEquipmentOk: boolean; completedAt: string } | null;
}

interface EquipmentType {
  id:          string;
  name:        string;
  code:        string;
  requiredQty: number;
  isMandatory: boolean;
}

export function PageDriverBriefing() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const myUserId = user?.id ?? '';

  const base = `/api/tenants/${tenantId}/crew-briefing`;

  const { data: assignments, loading: loadingAssignments, refetch: refetchAssignments } =
    useFetch<MyAssignment[]>(tenantId ? `/api/tenants/${tenantId}/crew-assignments/my` : null, [tenantId]);

  const { data: equipment, loading: loadingEquipment } =
    useFetch<EquipmentType[]>(tenantId ? `${base}/equipment-types` : null, [tenantId]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, { qty: number; ok: boolean }>>({});
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = useMemo(
    () => (assignments ?? []).filter(a => !a.briefingRecord),
    [assignments],
  );
  const done = useMemo(
    () => (assignments ?? []).filter(a => a.briefingRecord),
    [assignments],
  );

  const selected = assignments?.find(a => a.id === selectedId) ?? null;

  const openChecklist = (a: MyAssignment) => {
    setSelectedId(a.id);
    setChecked(
      Object.fromEntries(
        (equipment ?? []).map(e => [e.id, { qty: e.requiredQty, ok: true }]),
      ),
    );
    setNotes('');
    setError(null);
  };

  const closeChecklist = () => {
    setSelectedId(null);
    setChecked({});
    setNotes('');
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || !equipment) return;
    setBusy(true); setError(null);
    try {
      await apiPost(`${base}/briefings`, {
        assignmentId: selected.id,
        conductedById: myUserId,
        checkedItems: equipment.map(eq => ({
          equipmentTypeId: eq.id,
          qty:             checked[eq.id]?.qty ?? 0,
          ok:              checked[eq.id]?.ok  ?? false,
        })),
        briefingNotes: notes || undefined,
      });
      closeChecklist();
      refetchAssignments();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('driverBriefing.errorSave'));
    } finally {
      setBusy(false);
    }
  };

  // Groupement équipements par catégorie
  const equipmentByCategory = useMemo(() => {
    const grouped = new Map<BusEquipmentCategory, EquipmentType[]>();
    (equipment ?? []).forEach(eq => {
      const cat = inferEquipmentCategory(eq.code);
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(eq);
    });
    return grouped;
  }, [equipment]);

  return (
    <main className="p-6 space-y-6" role="main" aria-label="Mon briefing pré-départ">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('driverBriefing.pageTitle')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          {t('driverBriefing.pageSubtitle')}
        </p>
      </header>

      {/* ── Affectations à briefer ── */}
      <Card>
        <CardHeader
          heading={t('driverBriefing.toSign')}
          description={t('driverBriefing.toSignDesc')}
        />
        <CardContent className="p-0">
          {loadingAssignments ? (
            <div className="p-6 space-y-3" aria-busy="true">
              {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : pending.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-slate-500 dark:text-slate-400" role="status">
              <CheckCircle2 className="w-10 h-10 mb-3 text-emerald-500" aria-hidden />
              <p className="font-medium">{t('driverBriefing.noPending')}</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
              {pending.map(a => (
                <li key={a.id} className="flex items-center justify-between px-6 py-4 gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">
                      {t('driverBriefing.tripLabel')} {a.trip?.reference ?? a.tripId.slice(0, 8)}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {t('driverBriefing.role')} : {a.crewRole}
                      {a.trip?.departureAt && ` — ${t('driverBriefing.departure')} ${new Date(a.trip.departureAt).toLocaleString('fr-FR')}`}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => openChecklist(a)}
                    disabled={loadingEquipment || !equipment || equipment.length === 0}
                  >
                    <ClipboardCheck className="w-4 h-4 mr-1.5" aria-hidden />
                    {t('driverBriefing.doBriefing')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── Historique personnel ── */}
      {done.length > 0 && (
        <Card>
          <CardHeader heading={t('driverBriefing.recentBriefings')} description={t('driverBriefing.recentDesc')} />
          <CardContent className="p-0">
            <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
              {done.map(a => (
                <li key={a.id} className="flex items-center justify-between px-6 py-3">
                  <div>
                    <p className="font-medium text-sm text-slate-900 dark:text-slate-100">
                      {t('driverBriefing.tripLabel')} {a.trip?.reference ?? a.tripId.slice(0, 8)}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {a.briefingRecord && new Date(a.briefingRecord.completedAt).toLocaleString('fr-FR')}
                    </p>
                  </div>
                  {a.briefingRecord?.allEquipmentOk ? (
                    <Badge variant="success" size="sm">{t('driverBriefing.compliant')}</Badge>
                  ) : (
                    <Badge variant="danger" size="sm">{t('driverBriefing.nonCompliant')}</Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── Checklist inline ── */}
      {selected && (
        <Card>
          <CardHeader
            heading={`${t('driverBriefing.checklistTitle')} — ${t('driverBriefing.tripLabel')} ${selected.trip?.reference ?? selected.tripId.slice(0, 8)}`}
            description={t('driverBriefing.checklistDesc')}
            action={
              <Button size="sm" variant="outline" onClick={closeChecklist} disabled={busy}>
                {t('driverBriefing.cancelBtn')}
              </Button>
            }
          />
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <ErrorAlert error={error} />

              {loadingEquipment ? (
                <Skeleton className="h-32 w-full" />
              ) : !equipment || equipment.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg">
                  <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden />
                  {t('driverBriefing.noEquipment')}
                </div>
              ) : (
                <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
                  {BUS_EQUIPMENT_CATEGORIES.map(cat => {
                    const items = equipmentByCategory.get(cat.id) ?? [];
                    if (items.length === 0) return null;
                    return (
                      <section key={cat.id} aria-label={cat.label}>
                        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                          {cat.label}
                        </h4>
                        <ul className="space-y-1" role="list">
                          {items.map(eq => {
                            const item = checked[eq.id] ?? { qty: eq.requiredQty, ok: true };
                            return (
                              <li
                                key={eq.id}
                                className="flex items-center gap-3 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50"
                              >
                                <label className="flex items-center gap-2 flex-1 min-w-0 text-sm text-slate-800 dark:text-slate-200 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={item.ok}
                                    onChange={e => setChecked(p => ({
                                      ...p, [eq.id]: { ...item, ok: e.target.checked },
                                    }))}
                                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 shrink-0"
                                    disabled={busy}
                                    aria-label={`Conformité ${eq.name}`}
                                  />
                                  <span className="font-medium truncate">{eq.name}</span>
                                  {eq.isMandatory && <Badge variant="warning" size="sm">{t('driverBriefing.mandatory')}</Badge>}
                                </label>
                                <label className="flex items-center gap-1 text-xs text-slate-500 shrink-0">
                                  <span>Qté</span>
                                  <input
                                    type="number" min={0} value={item.qty}
                                    onChange={e => setChecked(p => ({
                                      ...p, [eq.id]: { ...item, qty: Math.max(0, Number(e.target.value)) },
                                    }))}
                                    className="w-16 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-900 dark:text-slate-100"
                                    disabled={busy}
                                    aria-label={`Quantité contrôlée de ${eq.name}`}
                                  />
                                  <span className="text-slate-400">/ {eq.requiredQty}</span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="drv-br-notes" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t('driverBriefing.observations')}
                </label>
                <textarea
                  id="drv-br-notes" rows={2} value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className={inputClass} disabled={busy}
                  placeholder={t('driverBriefing.obsPlaceholder')}
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeChecklist} disabled={busy}>
                  {t('driverBriefing.cancelBtn')}
                </Button>
                <Button type="submit" disabled={busy || !equipment || equipment.length === 0}>
                  {busy ? t('driverBriefing.saving') : t('driverBriefing.signBriefing')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
