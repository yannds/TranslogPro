/**
 * PageCrewBriefing — Briefings pré-départ équipages
 *
 * Module Crew Briefing : checklist équipements de sécurité obligatoires
 * avant chaque trajet.
 *
 * Accessibilité : WCAG 2.1 AA — aria-checked sur checkboxes, live regions
 * Dark mode : Tailwind dark:
 */

import { useState, type FormEvent } from 'react';
import {
  ShieldCheck, ShieldAlert, ClipboardList, Plus, CheckCircle2,
  XCircle, ChevronDown, ChevronRight, PackagePlus, Sparkles,
} from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPost } from '../../lib/api';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { ErrorAlert } from '../ui/ErrorAlert';
import { FormFooter } from '../ui/FormFooter';
import { inputClass } from '../ui/inputClass';
import { cn } from '../../lib/utils';
import {
  BUS_EQUIPMENT_CATALOG, BUS_EQUIPMENT_CATEGORIES,
  inferEquipmentCategory,
  type BusEquipmentCategory,
} from '../../lib/catalogs/busEquipment';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BriefingRecord {
  id:             string;
  assignmentId:   string;
  tripRef:        string;
  conductedBy:    string;
  completedAt:    string;
  allEquipmentOk: boolean;
  missingCodes:   string[];
}

interface EquipmentType {
  id:          string;
  name:        string;
  code:        string;
  requiredQty: number;
  isMandatory: boolean;
}

type Tab = 'incomplete' | 'history' | 'equipment';

// ─── Formulaire : créer un type d'équipement ─────────────────────────────────

interface EquipmentFormValues {
  name: string; code: string; requiredQty: number; isMandatory: boolean;
}

function EquipmentTypeForm({ onSubmit, onCancel, busy, error }: {
  onSubmit: (f: EquipmentFormValues) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [f, setF] = useState<EquipmentFormValues>({
    name: '', code: '', requiredQty: 1, isMandatory: true,
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}
    >
      <ErrorAlert error={error} />
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <label htmlFor="eq-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Nom <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="eq-name" type="text" required value={f.name}
            onChange={e => setF(p => ({ ...p, name: e.target.value }))}
            className={inputClass} disabled={busy} placeholder="Gilet de sécurité" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="eq-code" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Code <span aria-hidden className="text-red-500">*</span>
          </label>
          <input id="eq-code" type="text" required value={f.code}
            onChange={e => setF(p => ({ ...p, code: e.target.value.toUpperCase() }))}
            className={cn(inputClass, 'font-mono')} disabled={busy} placeholder="VEST" maxLength={32} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="eq-qty" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Quantité requise
          </label>
          <input id="eq-qty" type="number" min={1} value={f.requiredQty}
            onChange={e => setF(p => ({ ...p, requiredQty: Math.max(1, Number(e.target.value)) }))}
            className={inputClass} disabled={busy} />
        </div>
        <label className="col-span-2 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input type="checkbox" checked={f.isMandatory}
            onChange={e => setF(p => ({ ...p, isMandatory: e.target.checked }))}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            disabled={busy} />
          Équipement obligatoire (bloque le départ si manquant)
        </label>
      </div>
      <FormFooter onCancel={onCancel} busy={busy} submitLabel="Créer" pendingLabel="Création…" />
    </form>
  );
}

// ─── Formulaire : créer un briefing pré-départ ────────────────────────────────

interface AssignmentOption { id: string; tripId: string; staffId: string }
interface BriefingFormValues {
  assignmentId: string;
  checkedItems: Record<string, { qty: number; ok: boolean }>;
  notes: string;
}

function BriefingForm({
  assignments, equipment, conductedById, onSubmit, onCancel, busy, error,
}: {
  assignments: AssignmentOption[];
  equipment:   EquipmentType[];
  conductedById: string;
  onSubmit: (dto: {
    assignmentId: string;
    conductedById: string;
    checkedItems: { equipmentTypeId: string; qty: number; ok: boolean }[];
    briefingNotes?: string;
  }) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [values, setValues] = useState<BriefingFormValues>(() => ({
    assignmentId: assignments[0]?.id ?? '',
    checkedItems: Object.fromEntries(
      equipment.map(e => [e.id, { qty: e.requiredQty, ok: true }]),
    ),
    notes: '',
  }));

  const updateItem = (id: string, patch: Partial<{ qty: number; ok: boolean }>) =>
    setValues(p => ({
      ...p,
      checkedItems: { ...p.checkedItems, [id]: { ...p.checkedItems[id], ...patch } },
    }));

  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit({
          assignmentId:  values.assignmentId,
          conductedById,
          checkedItems:  equipment.map(eq => ({
            equipmentTypeId: eq.id,
            qty:             values.checkedItems[eq.id]?.qty ?? 0,
            ok:              values.checkedItems[eq.id]?.ok  ?? false,
          })),
          briefingNotes: values.notes || undefined,
        });
      }}
    >
      <ErrorAlert error={error} />

      <div className="space-y-1.5">
        <label htmlFor="br-assignment" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Affectation équipage <span aria-hidden className="text-red-500">*</span>
        </label>
        <select id="br-assignment" required value={values.assignmentId}
          onChange={e => setValues(p => ({ ...p, assignmentId: e.target.value }))}
          className={inputClass} disabled={busy || assignments.length === 0}>
          {assignments.length === 0 && <option value="">Aucune affectation disponible</option>}
          {assignments.map(a => (
            <option key={a.id} value={a.id}>
              Trajet {a.tripId.slice(0, 8)} · Staff {a.staffId.slice(0, 8)}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-3">
        <legend className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Checklist équipements</legend>
        {equipment.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun équipement configuré — importez le catalogue UE ou créez-en un.</p>
        ) : (() => {
          // Groupement par catégorie inférée depuis le code.
          const grouped = new Map<BusEquipmentCategory, EquipmentType[]>();
          equipment.forEach(eq => {
            const cat = inferEquipmentCategory(eq.code);
            if (!grouped.has(cat)) grouped.set(cat, []);
            grouped.get(cat)!.push(eq);
          });
          return (
            <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
              {BUS_EQUIPMENT_CATEGORIES.map(cat => {
                const items = grouped.get(cat.id) ?? [];
                if (items.length === 0) return null;
                return (
                  <section key={cat.id} aria-label={cat.label}>
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                      {cat.label}
                    </h4>
                    <ul className="space-y-1">
                      {items.map(eq => {
                        const item = values.checkedItems[eq.id] ?? { qty: eq.requiredQty, ok: true };
                        return (
                          <li
                            key={eq.id}
                            className="flex items-center gap-3 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50"
                          >
                            <label className="flex items-center gap-2 flex-1 min-w-0 text-sm text-slate-800 dark:text-slate-200 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={item.ok}
                                onChange={e => updateItem(eq.id, { ok: e.target.checked })}
                                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 shrink-0"
                                disabled={busy}
                                aria-label={`Conformité ${eq.name}`}
                              />
                              <span className="font-medium truncate">{eq.name}</span>
                              {eq.isMandatory && <Badge variant="warning" size="sm">Obligatoire</Badge>}
                            </label>
                            <label className="flex items-center gap-1 text-xs text-slate-500 shrink-0">
                              <span>Qté</span>
                              <input
                                type="number" min={0} value={item.qty}
                                onChange={e => updateItem(eq.id, { qty: Math.max(0, Number(e.target.value)) })}
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
          );
        })()}
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor="br-notes" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          Notes
        </label>
        <textarea id="br-notes" rows={2} value={values.notes}
          onChange={e => setValues(p => ({ ...p, notes: e.target.value }))}
          className={inputClass} disabled={busy}
          placeholder="Observations (optionnel)" />
      </div>

      <FormFooter onCancel={onCancel} busy={busy} submitLabel="Enregistrer le briefing" pendingLabel="Enregistrement…" />
    </form>
  );
}

// ─── Indicateur de conformité ─────────────────────────────────────────────────

function ConformityIndicator({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
      <CheckCircle2 className="w-4 h-4" aria-hidden />
      Conforme
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400 text-xs font-medium">
      <XCircle className="w-4 h-4" aria-hidden />
      Non conforme
    </span>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export function PageCrewBriefing() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const myUserId = user?.id ?? '';

  const [tab, setTab]           = useState<Tab>('incomplete');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showBriefing, setShowBriefing]         = useState(false);
  const [showEquipmentForm, setShowEquipmentForm] = useState(false);
  const [busy, setBusy]         = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const base = `/api/tenants/${tenantId}/crew-briefing`;

  const { data: incomplete, loading: loadingIncomplete, refetch: refetchIncomplete } = useFetch<BriefingRecord[]>(
    `${base}/briefings/incomplete`,
    [tenantId],
  );
  const { data: history, loading: loadingHistory, refetch: refetchHistory } = useFetch<BriefingRecord[]>(
    tab === 'history' ? `${base}/briefings/history?limit=50` : null,
    [tenantId, tab],
  );
  const { data: equipment, loading: loadingEquipment, refetch: refetchEquipment } = useFetch<EquipmentType[]>(
    tab === 'equipment' || showBriefing ? `${base}/equipment-types` : null,
    [tenantId, tab, showBriefing],
  );

  // Fetch trips minimaux pour proposer des assignments au briefing
  const { data: trips } = useFetch<{ id: string }[]>(
    showBriefing ? `/api/tenants/${tenantId}/trips` : null,
    [tenantId, showBriefing],
  );

  const { data: assignmentsRaw } = useFetch<{ id: string; tripId: string; staffId: string }[]>(
    showBriefing && trips && trips.length > 0
      ? `/api/tenants/${tenantId}/trips/${trips[0].id}/crew`
      : null,
    [tenantId, showBriefing, trips?.[0]?.id],
  );

  // Seed catalogue standard — ne crée que les items manquants (idempotent côté UI)
  const [seedProgress, setSeedProgress] = useState<{ done: number; total: number } | null>(null);
  const handleSeedCatalog = async () => {
    if (!equipment) return;
    const existingCodes = new Set(equipment.map(e => e.code));
    const toCreate = BUS_EQUIPMENT_CATALOG.filter(i => !existingCodes.has(i.code));
    if (toCreate.length === 0) {
      setActionError('Catalogue déjà à jour — aucun équipement manquant.');
      return;
    }
    setBusy(true); setActionError(null);
    setSeedProgress({ done: 0, total: toCreate.length });
    try {
      for (let i = 0; i < toCreate.length; i += 1) {
        const item = toCreate[i];
        await apiPost(`${base}/equipment-types`, {
          name:        item.name,
          code:        item.code,
          requiredQty: item.requiredQty,
          isMandatory: item.isMandatory,
        });
        setSeedProgress({ done: i + 1, total: toCreate.length });
      }
      refetchEquipment();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Erreur pendant le seed');
    } finally {
      setBusy(false);
      setSeedProgress(null);
    }
  };

  // Grouper par catégorie pour l'affichage catalogue
  const equipmentByCategory = (() => {
    const groups = new Map<BusEquipmentCategory, EquipmentType[]>();
    (equipment ?? []).forEach(eq => {
      const cat = inferEquipmentCategory(eq.code);
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(eq);
    });
    return groups;
  })();

  // Handlers CRUD
  const handleCreateEquipment = async (f: EquipmentFormValues) => {
    setBusy(true); setActionError(null);
    try {
      await apiPost(`${base}/equipment-types`, f);
      setShowEquipmentForm(false);
      refetchEquipment();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Erreur lors de la création');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateBriefing = async (dto: {
    assignmentId: string; conductedById: string;
    checkedItems: { equipmentTypeId: string; qty: number; ok: boolean }[];
    briefingNotes?: string;
  }) => {
    setBusy(true); setActionError(null);
    try {
      await apiPost(`${base}/briefings`, dto);
      setShowBriefing(false);
      refetchIncomplete();
      refetchHistory();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Erreur lors de l\'enregistrement');
    } finally {
      setBusy(false);
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'incomplete', label: 'Non conformes' },
    { id: 'history',    label: 'Historique' },
    { id: 'equipment',  label: 'Équipements' },
  ];

  const incompleteCount = incomplete?.length ?? 0;

  return (
    <main className="p-6 space-y-6" role="main" aria-label="Briefings équipages pré-départ">
      {/* ── En-tête ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Briefings Équipages</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Checklist sécurité pré-départ — gilets, lampes, trousse, cales, sangles, triangles, cric
          </p>
        </div>
        <Button
          onClick={() => { setShowBriefing(true); setActionError(null); }}
          aria-label="Créer un nouveau briefing pré-départ"
        >
          <Plus className="w-4 h-4 mr-2" aria-hidden />
          Nouveau briefing
        </Button>
      </div>

      {/* ── KPIs ── */}
      <section aria-label="Indicateurs briefings">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <article
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-center gap-4"
            aria-label={`Briefings non conformes: ${incompleteCount}`}
          >
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 shrink-0" aria-hidden>
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Non conformes</p>
              {loadingIncomplete ? <Skeleton className="h-7 w-8 mt-1" /> : (
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{incompleteCount}</p>
              )}
            </div>
          </article>

          <article
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-center gap-4"
            aria-label={`Briefings historique: chargement`}
          >
            <div className="p-3 rounded-lg bg-teal-50 dark:bg-teal-900/20 text-teal-500 shrink-0" aria-hidden>
              <ClipboardList className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Historique</p>
              {loadingHistory ? <Skeleton className="h-7 w-8 mt-1" /> : (
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{history?.length ?? '—'}</p>
              )}
            </div>
          </article>

          <article
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-center gap-4"
            aria-label={`Équipements configurés: ${equipment?.length ?? '—'}`}
          >
            <div className="p-3 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0" aria-hidden>
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Types équipements</p>
              {loadingEquipment ? <Skeleton className="h-7 w-8 mt-1" /> : (
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{equipment?.length ?? '—'}</p>
              )}
            </div>
          </article>
        </div>
      </section>

      {/* ── Tabs ── */}
      <nav aria-label="Sections briefings" role="tablist">
        <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
          {tabs.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              aria-controls={`tabpanel-briefing-${t.id}`}
              id={`tab-briefing-${t.id}`}
              onClick={() => setTab(t.id)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                tab === t.id
                  ? 'border-teal-600 text-teal-600 dark:border-teal-400 dark:text-teal-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
              )}
            >
              {t.label}
              {t.id === 'incomplete' && incompleteCount > 0 && (
                <span
                  className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold"
                  aria-label={`${incompleteCount} non conformes`}
                >
                  {incompleteCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* ── Non conformes ── */}
      {tab === 'incomplete' && (
        <section
          id="tabpanel-briefing-incomplete"
          role="tabpanel"
          aria-labelledby="tab-briefing-incomplete"
          aria-live="polite"
        >
          <Card>
            <CardHeader
              heading="Briefings non conformes"
              description="Trajets dont au moins un équipement obligatoire est manquant"
            />
            <CardContent className="p-0">
              {loadingIncomplete ? (
                <div className="p-6 space-y-3" aria-busy="true">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : !incomplete || incomplete.length === 0 ? (
                <div className="flex flex-col items-center py-16 text-slate-500 dark:text-slate-400" role="status">
                  <CheckCircle2 className="w-12 h-12 mb-3 text-emerald-500" aria-hidden />
                  <p className="font-medium">Tous les briefings sont conformes</p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
                  {incomplete.map(b => (
                    <li key={b.id}>
                      <button
                        className="w-full text-left px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500"
                        onClick={() => setExpanded(expanded === b.id ? null : b.id)}
                        aria-expanded={expanded === b.id}
                        aria-controls={`briefing-detail-${b.id}`}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{b.tripRef}</p>
                            <p className="text-xs text-slate-500 mt-0.5">Par {b.conductedBy} — {new Date(b.completedAt).toLocaleString('fr-FR')}</p>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <Badge variant="danger" size="sm">{b.missingCodes.length} manquant(s)</Badge>
                            {expanded === b.id
                              ? <ChevronDown className="w-4 h-4 text-slate-400" aria-hidden />
                              : <ChevronRight className="w-4 h-4 text-slate-400" aria-hidden />
                            }
                          </div>
                        </div>
                      </button>
                      {expanded === b.id && (
                        <div
                          id={`briefing-detail-${b.id}`}
                          className="px-6 pb-4 bg-red-50/50 dark:bg-red-900/10 border-t border-red-100 dark:border-red-900/30"
                        >
                          <p className="text-xs font-semibold text-red-700 dark:text-red-400 mt-3 mb-2 uppercase tracking-wide">
                            Équipements manquants :
                          </p>
                          <ul className="flex flex-wrap gap-2" aria-label="Équipements manquants">
                            {b.missingCodes.map(code => (
                              <li key={code}>
                                <Badge variant="danger" size="sm">{code}</Badge>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Historique ── */}
      {tab === 'history' && (
        <section id="tabpanel-briefing-history" role="tabpanel" aria-labelledby="tab-briefing-history">
          <Card>
            <CardHeader heading="Historique des briefings" description="50 derniers briefings enregistrés" />
            <CardContent className="p-0">
              {loadingHistory ? (
                <div className="p-6 space-y-3" aria-busy="true">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : !history || history.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 py-12 text-center">
                  Aucun briefing dans l'historique
                </p>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
                  {history.map(b => (
                    <li key={b.id} className="flex items-center justify-between px-6 py-3">
                      <div>
                        <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{b.tripRef}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Par {b.conductedBy} — {new Date(b.completedAt).toLocaleString('fr-FR')}
                        </p>
                      </div>
                      <ConformityIndicator ok={b.allEquipmentOk} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Équipements ── */}
      {tab === 'equipment' && (
        <section id="tabpanel-briefing-equipment" role="tabpanel" aria-labelledby="tab-briefing-equipment" className="space-y-4">
          <Card>
            <CardHeader
              heading="Catalogue des équipements"
              description={`${equipment?.length ?? 0} équipements configurés — référence UNECE R107 / UE 2019/2144`}
              action={
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleSeedCatalog}
                    disabled={busy || loadingEquipment}
                    loading={busy && !!seedProgress}
                    aria-label="Importer le catalogue de référence européen"
                  >
                    <Sparkles className="w-4 h-4 mr-1" aria-hidden />
                    {seedProgress
                      ? `Import ${seedProgress.done}/${seedProgress.total}`
                      : 'Importer le catalogue UE'}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => { setShowEquipmentForm(true); setActionError(null); }}
                    aria-label="Ajouter un type d'équipement personnalisé"
                  >
                    <Plus className="w-4 h-4 mr-1" aria-hidden /> Équipement
                  </Button>
                </div>
              }
            />
            <CardContent className="p-0">
              <ErrorAlert error={actionError} className="mx-6 my-3" />
              {loadingEquipment ? (
                <div className="p-6 space-y-3" aria-busy="true">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : !equipment || equipment.length === 0 ? (
                <div className="px-6 py-12 text-center" role="status">
                  <PackagePlus className="w-10 h-10 mx-auto mb-3 text-slate-300 dark:text-slate-600" aria-hidden />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Aucun équipement configuré
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Utilisez « Importer le catalogue UE » pour seeder {BUS_EQUIPMENT_CATALOG.length} équipements standards
                    ou créez un équipement personnalisé.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {BUS_EQUIPMENT_CATEGORIES.map(cat => {
                    const items = equipmentByCategory.get(cat.id) ?? [];
                    if (items.length === 0) return null;
                    return (
                      <section key={cat.id} aria-labelledby={`cat-${cat.id}`}>
                        <header className="px-6 py-2 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                          <div>
                            <h3 id={`cat-${cat.id}`} className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                              {cat.label}
                            </h3>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">{cat.description}</p>
                          </div>
                          <Badge variant="default" size="sm">{items.length}</Badge>
                        </header>
                        <ul className="divide-y divide-slate-100 dark:divide-slate-800" role="list">
                          {items.map(eq => (
                            <li key={eq.id} className="flex items-center justify-between px-6 py-3">
                              <div>
                                <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{eq.name}</p>
                                <p className="text-xs text-slate-500 font-mono">{eq.code}</p>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-xs text-slate-500 tabular-nums">
                                  Qté : {eq.requiredQty}
                                </span>
                                {eq.isMandatory
                                  ? <Badge variant="warning" size="sm">Obligatoire</Badge>
                                  : <Badge variant="default" size="sm">Optionnel</Badge>
                                }
                              </div>
                            </li>
                          ))}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Catégories non-présentes : informations catalogue référentiel */}
          <Card>
            <CardHeader
              heading="Catégories de référence UE"
              description="Vue d'ensemble des familles d'équipements couverts par le catalogue standard"
            />
            <CardContent>
              <ul role="list" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {BUS_EQUIPMENT_CATEGORIES.map(cat => {
                  const totalInCat = BUS_EQUIPMENT_CATALOG.filter(i => i.category === cat.id).length;
                  const doneInCat  = equipmentByCategory.get(cat.id)?.length ?? 0;
                  return (
                    <li
                      key={cat.id}
                      className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 bg-white dark:bg-slate-900"
                    >
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{cat.label}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{cat.description}</p>
                      <p className="text-xs text-slate-500 mt-2 tabular-nums">
                        <span className={cn(
                          'font-semibold',
                          doneInCat > 0 ? 'text-teal-600 dark:text-teal-400' : 'text-slate-400',
                        )}>{doneInCat}</span>
                        <span className="text-slate-400"> / {totalInCat} configurés</span>
                      </p>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}

      {/* ── Modal : Nouveau type d'équipement ── */}
      <Dialog
        open={showEquipmentForm}
        onOpenChange={o => { if (!o) setShowEquipmentForm(false); }}
        title="Nouveau type d'équipement"
        description="Définissez un équipement de sécurité obligatoire pour les briefings pré-départ."
        size="md"
      >
        {showEquipmentForm && (
          <EquipmentTypeForm
            onSubmit={handleCreateEquipment}
            onCancel={() => setShowEquipmentForm(false)}
            busy={busy}
            error={actionError}
          />
        )}
      </Dialog>

      {/* ── Modal : Nouveau briefing ── */}
      <Dialog
        open={showBriefing}
        onOpenChange={o => { if (!o) setShowBriefing(false); }}
        title="Nouveau briefing pré-départ"
        description="Checklist des équipements obligatoires pour un membre d'équipage affecté."
        size="xl"
      >
        {showBriefing && (
          <BriefingForm
            assignments={assignmentsRaw ?? []}
            equipment={equipment ?? []}
            conductedById={myUserId}
            onSubmit={handleCreateBriefing}
            onCancel={() => setShowBriefing(false)}
            busy={busy}
            error={actionError}
          />
        )}
      </Dialog>
    </main>
  );
}
