/**
 * PageQhse — QHSE & Accidents : rapports, litiges, procédures
 *
 * 4 onglets : Accidents · Litiges · Procédures · Configuration (sévérités + hôpitaux).
 * Toutes les listes utilisent DataTableMaster (règle projet — pas de tableau ad-hoc).
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertOctagon, Gavel, ClipboardCheck, Plus, Users,
  Building2, Palette, Trash2, Pencil, Power, PlayCircle, CheckSquare, Square, FileText,
} from 'lucide-react';
import { useAuth }                from '../../lib/auth/auth.context';
import { useFetch }               from '../../lib/hooks/useFetch';
import { apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api';
import { useI18n }            from '../../lib/i18n/useI18n';
import { Badge }                  from '../ui/Badge';
import { Button }                 from '../ui/Button';
import { Dialog }                 from '../ui/Dialog';
import { ErrorAlert }             from '../ui/ErrorAlert';
import { FormFooter }             from '../ui/FormFooter';
import { inputClass as inp }      from '../ui/inputClass';
import { cn }                     from '../../lib/utils';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

// ─── Types (alignés sur le backend qhse.service.ts) ───────────────────────────

type AccidentStatus = 'OPEN' | 'UNDER_INVESTIGATION' | 'LEGAL' | 'SETTLED' | 'CLOSED';

interface SeverityType {
  id:              string;
  name:            string;
  code:            string;
  color:           string;
  requiresQhse:    boolean;
  requiresPolice:  boolean;
  requiresInsurer: boolean;
  sortOrder:       number;
  isActive:        boolean;
}

interface AccidentRow {
  id:             string;
  busId:          string | null;
  severityTypeId: string;
  severityType:   { id: string; code: string; name: string; color: string };
  status:         AccidentStatus;
  occurredAt:     string;
  locationDesc:   string | null;
  description:    string;
  reportedById:   string;
  reportedByRole: string;
  disputeTracking: { id: string; status: string } | null;
  _count:         { injuries: number };
}

interface ProcedureStep {
  id?:              string;
  order:            number;
  description:      string;
  responsible:      string;
  isVerification?:  boolean;
  isPhotoRequired?: boolean;
}

interface ProcedureRow {
  id:          string;
  name:        string;
  triggerCode: string;
  description: string | null;
  isActive:    boolean;
  version:     number;
  steps:       ProcedureStep[];
}

interface Hospital {
  id:      string;
  name:    string;
  city:    string;
  address: string | null;
  phone:   string | null;
}

interface BusRow { id: string; plateNumber: string }

interface ThirdParty {
  id: string; type: string; name: string | null; phone: string | null;
  plateNumber: string | null; vehicleModel: string | null;
  insuranceRef: string | null; notes: string | null;
}

interface InjuryFollowUp {
  id: string; date: string; practitionerName: string | null;
  notes: string | null; nextAppointment: string | null;
}

interface Injury {
  id: string; personType: string; personName: string | null;
  severity: string; hospitalId: string | null; hospitalName: string | null;
  admittedAt: string | null; medicalNotes: string | null;
  hospital: Hospital | null; followUps: InjuryFollowUp[];
}

interface ProcedureStepExec {
  id:         string;
  isOk:       boolean | null;
  notes:      string | null;
  executedAt: string | null;
  step:       ProcedureStep & { id: string; procedureId: string };
}

interface ProcedureExecution {
  id: string; procedureId: string; status: string;
  startedAt: string; completedAt: string | null;
  procedure: ProcedureRow;
  stepExecs: ProcedureStepExec[];
}

interface AccidentDetail extends AccidentRow {
  description:    string;
  circumstance:   string | null;
  thirdParties:   ThirdParty[];
  injuries:       Injury[];
  procedureExecs: ProcedureExecution[];
}

const THIRD_PARTY_TYPES = ['VEHICLE', 'PEDESTRIAN', 'PROPERTY', 'OTHER'] as const;
const INJURY_PERSON_TYPES = ['PASSENGER', 'DRIVER', 'CREW', 'PEDESTRIAN', 'THIRD_PARTY'] as const;
const INJURY_SEVERITIES = ['MINOR', 'SERIOUS', 'CRITICAL', 'FATAL'] as const;

type Tab = 'accidents' | 'disputes' | 'procedures' | 'config';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<AccidentStatus, string> = {
  OPEN:                'qhse.statusOpen',
  UNDER_INVESTIGATION: 'qhse.statusUnderInvestigation',
  LEGAL:               'qhse.statusLegal',
  SETTLED:             'qhse.statusSettled',
  CLOSED:              'qhse.statusClosed',
};

// i18n: namespace 'qhse' — string keys used directly

const STATUS_VARIANT: Record<AccidentStatus, 'danger' | 'warning' | 'info' | 'success' | 'default'> = {
  OPEN:                'danger',
  UNDER_INVESTIGATION: 'warning',
  LEGAL:               'info',
  SETTLED:             'success',
  CLOSED:              'default',
};

const REPORTER_ROLES = ['DRIVER', 'CREW', 'QHSE', 'STATION_AGENT'] as const;
const STEP_RESPONSIBLES = ['DRIVER', 'CREW', 'QHSE', 'STATION_AGENT'] as const;
const DISPUTE_MODES   = ['INSURANCE', 'AMICABLE', 'LEGAL'] as const;

// ─── Form: Déclarer accident ──────────────────────────────────────────────────

interface AccidentFormValues {
  busId:          string;
  severityTypeId: string;
  reportedByRole: string;
  occurredAt:     string;
  locationDesc:   string;
  description:    string;
  circumstance:   string;
}

function AccidentForm({
  buses, severities, initial, onSubmit, onCancel, busy, error,
}: {
  buses:       BusRow[];
  severities:  SeverityType[];
  initial:     AccidentFormValues;
  onSubmit:    (v: AccidentFormValues) => void;
  onCancel:    () => void;
  busy:        boolean;
  error:       string | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState(initial);
  const patch = (p: Partial<AccidentFormValues>) => setF(prev => ({ ...prev, ...p }));

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      <ErrorAlert error={error} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LQhse.severity')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select required value={f.severityTypeId}
            onChange={e => patch({ severityTypeId: e.target.value })}
            className={inp} disabled={busy}>
            <option value="">{t('LQhse.selectOption')}</option>
            {severities.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LQhse.reporterRole')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <select required value={f.reportedByRole}
            onChange={e => patch({ reportedByRole: e.target.value })}
            className={inp} disabled={busy}>
            {REPORTER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LQhse.busInvolved')}
          </label>
          <select value={f.busId}
            onChange={e => patch({ busId: e.target.value })}
            className={inp} disabled={busy}>
            <option value="">{t('LQhse.noneOption')}</option>
            {buses.map(b => <option key={b.id} value={b.id}>{b.plateNumber}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LQhse.dateTime')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="datetime-local" required value={f.occurredAt}
            onChange={e => patch({ occurredAt: e.target.value })}
            className={inp} disabled={busy} />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('LQhse.location')}
        </label>
        <input type="text" value={f.locationDesc}
          onChange={e => patch({ locationDesc: e.target.value })}
          className={inp} disabled={busy} placeholder="PK 42, RN1 — Edéa" />
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('common.description')} <span aria-hidden className="text-red-500">*</span>
        </label>
        <textarea required rows={3} value={f.description}
          onChange={e => patch({ description: e.target.value })}
          className={inp} disabled={busy} />
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('LQhse.circumstances')}
        </label>
        <textarea rows={2} value={f.circumstance}
          onChange={e => patch({ circumstance: e.target.value })}
          className={inp} disabled={busy} placeholder={t('LQhse.circPlaceholder')} />
      </div>

      <FormFooter onCancel={onCancel} busy={busy}
        submitLabel={t('LQhse.declare')} pendingLabel={t('LQhse.declaring')} />
    </form>
  );
}

// ─── Form: Sévérité ───────────────────────────────────────────────────────────

interface SeverityFormValues {
  name: string; code: string; color: string;
  requiresQhse: boolean; requiresPolice: boolean; requiresInsurer: boolean;
  sortOrder: string;
}

function SeverityForm({
  initial, onSubmit, onCancel, busy, error,
  submitLabel, pendingLabel,
}: {
  initial: SeverityFormValues;
  onSubmit: (v: SeverityFormValues) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
  submitLabel?: string;
  pendingLabel?: string;
}) {
  const { t } = useI18n();
  const [f, setF] = useState(initial);
  const patch = (p: Partial<SeverityFormValues>) => setF(prev => ({ ...prev, ...p }));

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      <ErrorAlert error={error} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('common.name')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="text" required value={f.name}
            onChange={e => patch({ name: e.target.value })}
            className={inp} disabled={busy} placeholder="Accident léger" />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Code <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="text" required value={f.code}
            onChange={e => patch({ code: e.target.value.toUpperCase() })}
            className={inp} disabled={busy} placeholder="MINOR" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LQhse.color')}
          </label>
          <div className="flex items-center gap-2">
            <input type="color" value={f.color}
              onChange={e => patch({ color: e.target.value })}
              className="h-10 w-14 rounded border border-slate-200 dark:border-slate-700"
              disabled={busy} />
            <input type="text" value={f.color}
              onChange={e => patch({ color: e.target.value })}
              className={inp} disabled={busy} placeholder="#f59e0b" />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LQhse.displayOrder')}
          </label>
          <input type="number" min={0} value={f.sortOrder}
            onChange={e => patch({ sortOrder: e.target.value })}
            className={inp} disabled={busy} />
        </div>
      </div>

      <fieldset className="space-y-2 rounded-lg border border-slate-200 dark:border-slate-800 p-3">
        <legend className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t('LQhse.autoTriggers')}
        </legend>
        {([
          ['requiresQhse',    'qhse.triggerQhse'],
          ['requiresPolice',  'qhse.contactPolice'],
          ['requiresInsurer', 'qhse.contactInsurer'],
        ] as [keyof SeverityFormValues, string][]).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={f[key] as boolean}
              onChange={e => patch({ [key]: e.target.checked } as Partial<SeverityFormValues>)}
              disabled={busy} className="w-4 h-4 rounded border-slate-300" />
            {t(label)}
          </label>
        ))}
      </fieldset>

      <FormFooter onCancel={onCancel} busy={busy}
        submitLabel={submitLabel ?? t('common.create')} pendingLabel={pendingLabel ?? t('common.creating')} />
    </form>
  );
}

// ─── Form: Hôpital ────────────────────────────────────────────────────────────

interface HospitalFormValues {
  name: string; city: string; address: string; phone: string;
}

function HospitalForm({
  initial, onSubmit, onCancel, busy, error,
  submitLabel, pendingLabel,
}: {
  initial: HospitalFormValues;
  onSubmit: (v: HospitalFormValues) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
  submitLabel?: string;
  pendingLabel?: string;
}) {
  const { t } = useI18n();
  const [f, setF] = useState(initial);
  const patch = (p: Partial<HospitalFormValues>) => setF(prev => ({ ...prev, ...p }));

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      <ErrorAlert error={error} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('common.name')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="text" required value={f.name}
            onChange={e => patch({ name: e.target.value })}
            className={inp} disabled={busy} placeholder="Hôpital Général de Yaoundé" />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LQhse.city')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="text" required value={f.city}
            onChange={e => patch({ city: e.target.value })}
            className={inp} disabled={busy} placeholder="Yaoundé" />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('common.address')}
        </label>
        <input type="text" value={f.address}
          onChange={e => patch({ address: e.target.value })}
          className={inp} disabled={busy} />
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('common.phone')}
        </label>
        <input type="tel" value={f.phone}
          onChange={e => patch({ phone: e.target.value })}
          className={inp} disabled={busy} placeholder="+237 6XX XX XX XX" />
      </div>

      <FormFooter onCancel={onCancel} busy={busy}
        submitLabel={submitLabel ?? t('common.add')} pendingLabel={pendingLabel ?? t('common.creating')} />
    </form>
  );
}

// ─── Form: Édition procédure (rename + active toggle) ─────────────────────────

interface ProcedureEditValues { name: string; description: string; isActive: boolean }

function ProcedureEditForm({
  initial, onSubmit, onCancel, busy, error,
}: {
  initial: ProcedureEditValues;
  onSubmit: (v: ProcedureEditValues) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState(initial);
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      <ErrorAlert error={error} />
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('common.name')} <span aria-hidden className="text-red-500">*</span>
        </label>
        <input type="text" required value={f.name}
          onChange={e => setF(p => ({ ...p, name: e.target.value }))}
          className={inp} disabled={busy} />
      </div>
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('common.description')}
        </label>
        <textarea rows={2} value={f.description}
          onChange={e => setF(p => ({ ...p, description: e.target.value }))}
          className={inp} disabled={busy} />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input type="checkbox" checked={f.isActive}
          onChange={e => setF(p => ({ ...p, isActive: e.target.checked }))}
          disabled={busy} className="w-4 h-4 rounded border-slate-300" />
        {t('LQhse.activeProcedure')}
      </label>
      <p className="text-xs text-slate-500">
        {t('LQhse.editStepsHint')}
      </p>
      <FormFooter onCancel={onCancel} busy={busy}
        submitLabel={t('common.save')} pendingLabel={t('common.saving')} />
    </form>
  );
}

// ─── Form: Procédure QHSE (avec étapes dynamiques) ────────────────────────────

interface ProcedureFormValues {
  name:        string;
  triggerCode: string;
  description: string;
  steps:       ProcedureStep[];
}

const EMPTY_STEP: ProcedureStep = {
  order: 1, description: '', responsible: 'DRIVER',
  isVerification: false, isPhotoRequired: false,
};

function ProcedureForm({
  initial, onSubmit, onCancel, busy, error,
}: {
  initial: ProcedureFormValues;
  onSubmit: (v: ProcedureFormValues) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState(initial);

  const updateStep = (idx: number, patch: Partial<ProcedureStep>) =>
    setF(prev => ({
      ...prev,
      steps: prev.steps.map((s, i) => i === idx ? { ...s, ...patch } : s),
    }));

  const addStep = () =>
    setF(prev => ({
      ...prev,
      steps: [...prev.steps, { ...EMPTY_STEP, order: prev.steps.length + 1 }],
    }));

  const removeStep = (idx: number) =>
    setF(prev => ({
      ...prev,
      steps: prev.steps
        .filter((_, i) => i !== idx)
        .map((s, i) => ({ ...s, order: i + 1 })),
    }));

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      <ErrorAlert error={error} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('common.name')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="text" required value={f.name}
            onChange={e => setF(p => ({ ...p, name: e.target.value }))}
            className={inp} disabled={busy} placeholder="Procédure accident grave" />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LQhse.triggerCode')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="text" required value={f.triggerCode}
            onChange={e => setF(p => ({ ...p, triggerCode: e.target.value.toUpperCase() }))}
            className={inp} disabled={busy} placeholder="ACCIDENT_SERIOUS" />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('common.description')}
        </label>
        <textarea rows={2} value={f.description}
          onChange={e => setF(p => ({ ...p, description: e.target.value }))}
          className={inp} disabled={busy} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            {t('LQhse.steps')} <span className="text-xs font-normal text-slate-500">({f.steps.length})</span>
          </h3>
          <Button type="button" variant="outline" size="sm" onClick={addStep} disabled={busy}>
            <Plus className="w-3.5 h-3.5 mr-1" aria-hidden /> {t('LQhse.step')}
          </Button>
        </div>

        {f.steps.length === 0 && (
          <p className="text-xs text-slate-500 italic py-2">
            {t('LQhse.noSteps')}
          </p>
        )}

        <ul className="space-y-2">
          {f.steps.map((s, idx) => (
            <li key={idx} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <span className="mt-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 text-xs font-bold shrink-0">
                  {s.order}
                </span>
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input type="text" required value={s.description} placeholder={t('LQhse.stepDescPlaceholder')}
                    onChange={e => updateStep(idx, { description: e.target.value })}
                    className={cn(inp, 'sm:col-span-2')} disabled={busy} />
                  <select value={s.responsible}
                    onChange={e => updateStep(idx, { responsible: e.target.value })}
                    className={inp} disabled={busy}>
                    {STEP_RESPONSIBLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <button type="button" onClick={() => removeStep(idx)}
                  aria-label={`Supprimer l'étape ${s.order}`}
                  className="mt-1 p-1.5 rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  disabled={busy}>
                  <Trash2 className="w-3.5 h-3.5" aria-hidden />
                </button>
              </div>
              <div className="flex items-center gap-4 pl-8 text-xs">
                <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                  <input type="checkbox" checked={!!s.isVerification}
                    onChange={e => updateStep(idx, { isVerification: e.target.checked })}
                    disabled={busy} />
                  {t('LQhse.verification')}
                </label>
                <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                  <input type="checkbox" checked={!!s.isPhotoRequired}
                    onChange={e => updateStep(idx, { isPhotoRequired: e.target.checked })}
                    disabled={busy} />
                  {t('LQhse.photoRequired')}
                </label>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <FormFooter onCancel={onCancel} busy={busy}
        submitLabel={t('common.create')} pendingLabel={t('common.creating')} />
    </form>
  );
}

// ─── Form: Ouvrir litige ──────────────────────────────────────────────────────

interface DisputeFormValues {
  mode: string; insurerRef: string; insurerName: string; estimatedTotal: string;
}

function DisputeForm({
  onSubmit, onCancel, busy, error,
}: {
  onSubmit: (v: DisputeFormValues) => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<DisputeFormValues>({
    mode: 'INSURANCE', insurerRef: '', insurerName: '', estimatedTotal: '',
  });
  const patch = (p: Partial<DisputeFormValues>) => setF(prev => ({ ...prev, ...p }));

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }} className="space-y-4">
      <ErrorAlert error={error} />

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('LQhse.mode')} <span aria-hidden className="text-red-500">*</span>
        </label>
        <select required value={f.mode}
          onChange={e => patch({ mode: e.target.value })}
          className={inp} disabled={busy}>
          {DISPUTE_MODES.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LQhse.insurerRef')}
          </label>
          <input type="text" value={f.insurerRef}
            onChange={e => patch({ insurerRef: e.target.value })}
            className={inp} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('LQhse.insurerName')}
          </label>
          <input type="text" value={f.insurerName}
            onChange={e => patch({ insurerName: e.target.value })}
            className={inp} disabled={busy} placeholder="Activa Assurances" />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('LQhse.estimatedTotal')}
        </label>
        <input type="number" min={0} value={f.estimatedTotal}
          onChange={e => patch({ estimatedTotal: e.target.value })}
          className={inp} disabled={busy} />
      </div>

      <FormFooter onCancel={onCancel} busy={busy}
        submitLabel={t('LQhse.openDispute')} pendingLabel={t('LQhse.opening')} />
    </form>
  );
}

// ─── AccidentDetailDialog ─────────────────────────────────────────────────────

function AccidentDetailDialog({
  open, onOpenChange, tenantId, accidentId, hospitals, procedures, userId, onChanged,
}: {
  open:         boolean;
  onOpenChange: (o: boolean) => void;
  tenantId:     string;
  accidentId:   string | null;
  hospitals:    Hospital[];
  procedures:   ProcedureRow[];
  userId:       string;
  onChanged:    () => void;
}) {
  const { t } = useI18n();
  const base = `/api/tenants/${tenantId}/qhse`;
  const [detail,  setDetail]  = useState<AccidentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState<string | null>(null);
  const [busy,    setBusy]    = useState(false);

  const reload = async () => {
    if (!accidentId) return;
    setLoading(true); setErr(null);
    try { setDetail(await apiGet<AccidentDetail>(`${base}/accidents/${accidentId}`)); }
    catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (open && accidentId) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, accidentId]);

  // ── Sub-forms state ──
  const [tp, setTp] = useState({
    type: 'VEHICLE', name: '', phone: '', plateNumber: '', vehicleModel: '', insuranceRef: '', notes: '',
  });
  const [inj, setInj] = useState({
    personType: 'PASSENGER', personName: '', severity: 'MINOR',
    hospitalId: '', hospitalName: '', admittedAt: '', medicalNotes: '',
  });
  const [procId, setProcId] = useState('');

  const submitThirdParty = async (e: FormEvent) => {
    e.preventDefault();
    if (!accidentId) return;
    setBusy(true); setErr(null);
    try {
      await apiPost(`${base}/accidents/${accidentId}/third-parties`, {
        type: tp.type,
        name:         tp.name         || undefined,
        phone:        tp.phone        || undefined,
        plateNumber:  tp.plateNumber  || undefined,
        vehicleModel: tp.vehicleModel || undefined,
        insuranceRef: tp.insuranceRef || undefined,
        notes:        tp.notes        || undefined,
      });
      setTp({ type: 'VEHICLE', name: '', phone: '', plateNumber: '', vehicleModel: '', insuranceRef: '', notes: '' });
      await reload(); onChanged();
    } catch (e2) { setErr((e2 as Error).message); }
    finally { setBusy(false); }
  };

  const submitInjury = async (e: FormEvent) => {
    e.preventDefault();
    if (!accidentId) return;
    setBusy(true); setErr(null);
    try {
      await apiPost(`${base}/accidents/${accidentId}/injuries`, {
        personType:  inj.personType,
        personName:  inj.personName  || undefined,
        severity:    inj.severity,
        hospitalId:  inj.hospitalId  || undefined,
        hospitalName: inj.hospitalName || undefined,
        admittedAt:  inj.admittedAt ? new Date(inj.admittedAt).toISOString() : undefined,
        medicalNotes: inj.medicalNotes || undefined,
      });
      setInj({ personType: 'PASSENGER', personName: '', severity: 'MINOR', hospitalId: '', hospitalName: '', admittedAt: '', medicalNotes: '' });
      await reload(); onChanged();
    } catch (e2) { setErr((e2 as Error).message); }
    finally { setBusy(false); }
  };

  const startExecution = async () => {
    if (!accidentId || !procId) return;
    setBusy(true); setErr(null);
    try {
      await apiPost(`${base}/procedures/execute`, {
        reportId: accidentId, procedureId: procId, startedById: userId,
      });
      setProcId('');
      await reload();
    } catch (e2) { setErr((e2 as Error).message); }
    finally { setBusy(false); }
  };

  const executeStep = async (executionId: string, stepId: string, isOk: boolean, notes?: string) => {
    setBusy(true); setErr(null);
    try {
      await apiPost(`${base}/executions/${executionId}/steps`, {
        stepId, executedById: userId, isOk, notes: notes || undefined,
      });
      await reload();
    } catch (e2) { setErr((e2 as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={detail ? `${t('LQhse.accidentLabel')} ${detail.severityType.name}` : t('LQhse.detailAccident')}
      description={detail ? new Date(detail.occurredAt).toLocaleString('fr-FR') : undefined}
      size="3xl"
    >
      {loading && <p className="text-sm text-slate-500">{t('LQhse.loading')}</p>}
      <ErrorAlert error={err} />

      {detail && (
        <div className="space-y-6">
          {/* En-tête */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <Field label={t('LQhse.status')}>
              <Badge variant={STATUS_VARIANT[detail.status]} size="sm">{t(STATUS_LABEL[detail.status])}</Badge>
            </Field>
            <Field label={t('LQhse.severity')}>
              <span className="inline-flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: detail.severityType.color }} aria-hidden />
                {detail.severityType.name} ({detail.severityType.code})
              </span>
            </Field>
            <Field label={t('LQhse.location')}>{detail.locationDesc || '—'}</Field>
            <Field label={t('LQhse.reporterRoleLabel')}>{detail.reportedByRole}</Field>
            <Field label={t('common.description')} className="sm:col-span-2">
              <p className="whitespace-pre-wrap">{detail.description}</p>
            </Field>
            {detail.circumstance && (
              <Field label={t('LQhse.circumstances')} className="sm:col-span-2">
                <p className="whitespace-pre-wrap">{detail.circumstance}</p>
              </Field>
            )}
          </section>

          {/* Tiers impliqués */}
          <SubSection title={t('LQhse.thirdParties')} count={detail.thirdParties.length}>
            {detail.thirdParties.length === 0 ? (
              <p className="text-xs text-slate-500 italic">{t('LQhse.noThirdParty')}</p>
            ) : (
              <ul className="space-y-2">
                {detail.thirdParties.map(t => (
                  <li key={t.id} className="rounded-md border border-slate-200 dark:border-slate-800 p-2 text-sm">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="default" size="sm">{t.type}</Badge>
                      {t.name && <span className="font-medium">{t.name}</span>}
                      {t.plateNumber && <span className="font-mono text-xs text-slate-500">{t.plateNumber}</span>}
                    </div>
                    {(t.phone || t.insuranceRef || t.vehicleModel) && (
                      <p className="text-xs text-slate-500 mt-1">
                        {[t.phone, t.vehicleModel, t.insuranceRef && `Assurance: ${t.insuranceRef}`].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {t.notes && <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{t.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={submitThirdParty} className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <select required value={tp.type} onChange={e => setTp({ ...tp, type: e.target.value })}
                className={inp} disabled={busy}>
                {THIRD_PARTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input value={tp.name} onChange={e => setTp({ ...tp, name: e.target.value })}
                className={inp} disabled={busy} placeholder="Nom" />
              <input value={tp.phone} onChange={e => setTp({ ...tp, phone: e.target.value })}
                className={inp} disabled={busy} placeholder={t('common.phone')} />
              <input value={tp.plateNumber} onChange={e => setTp({ ...tp, plateNumber: e.target.value.toUpperCase() })}
                className={inp} disabled={busy} placeholder="Immatriculation" />
              <input value={tp.vehicleModel} onChange={e => setTp({ ...tp, vehicleModel: e.target.value })}
                className={inp} disabled={busy} placeholder="Modèle véhicule" />
              <input value={tp.insuranceRef} onChange={e => setTp({ ...tp, insuranceRef: e.target.value })}
                className={inp} disabled={busy} placeholder="Réf. assurance" />
              <input value={tp.notes} onChange={e => setTp({ ...tp, notes: e.target.value })}
                className={cn(inp, 'sm:col-span-2')} disabled={busy} placeholder="Notes" />
              <Button type="submit" size="sm" disabled={busy} loading={busy}>
                <Plus className="w-3.5 h-3.5 mr-1" aria-hidden /> {t('LQhse.addThirdParty')}
              </Button>
            </form>
          </SubSection>

          {/* Blessés */}
          <SubSection title={t('LQhse.injuries')} count={detail.injuries.length}>
            {detail.injuries.length === 0 ? (
              <p className="text-xs text-slate-500 italic">{t('LQhse.noInjury')}</p>
            ) : (
              <ul className="space-y-2">
                {detail.injuries.map(i => (
                  <li key={i.id} className="rounded-md border border-slate-200 dark:border-slate-800 p-2 text-sm">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={i.severity === 'FATAL' ? 'danger' : i.severity === 'CRITICAL' ? 'danger' : i.severity === 'SERIOUS' ? 'warning' : 'default'} size="sm">
                        {i.severity}
                      </Badge>
                      <span className="font-medium">{i.personName || i.personType}</span>
                      <span className="text-xs text-slate-500">({i.personType})</span>
                    </div>
                    {(i.hospital || i.hospitalName) && (
                      <p className="text-xs text-slate-500 mt-1">
                        {t('LQhse.hospital')} : {i.hospital?.name || i.hospitalName}
                        {i.admittedAt && ` — ${t('LQhse.admitted')} ${new Date(i.admittedAt).toLocaleString('fr-FR')}`}
                      </p>
                    )}
                    {i.medicalNotes && <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{i.medicalNotes}</p>}
                    {i.followUps.length > 0 && (
                      <p className="text-xs text-teal-600 dark:text-teal-400 mt-1">
                        {i.followUps.length} {t('LQhse.medicalFollowups')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={submitInjury} className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <select required value={inj.personType} onChange={e => setInj({ ...inj, personType: e.target.value })}
                className={inp} disabled={busy}>
                {INJURY_PERSON_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input value={inj.personName} onChange={e => setInj({ ...inj, personName: e.target.value })}
                className={inp} disabled={busy} placeholder="Nom" />
              <select required value={inj.severity} onChange={e => setInj({ ...inj, severity: e.target.value })}
                className={inp} disabled={busy}>
                {INJURY_SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={inj.hospitalId} onChange={e => setInj({ ...inj, hospitalId: e.target.value })}
                className={inp} disabled={busy}>
                <option value="">{t('LQhse.noThirdPartyOption')}</option>
                {hospitals.map(h => <option key={h.id} value={h.id}>{h.name} ({h.city})</option>)}
              </select>
              <input value={inj.hospitalName} onChange={e => setInj({ ...inj, hospitalName: e.target.value })}
                className={inp} disabled={busy} placeholder={t('LQhse.freeNameLabel')} />
              <input type="datetime-local" value={inj.admittedAt}
                onChange={e => setInj({ ...inj, admittedAt: e.target.value })}
                className={inp} disabled={busy} />
              <input value={inj.medicalNotes} onChange={e => setInj({ ...inj, medicalNotes: e.target.value })}
                className={cn(inp, 'sm:col-span-2')} disabled={busy} placeholder={t('LQhse.medicalNotes')} />
              <Button type="submit" size="sm" disabled={busy} loading={busy}>
                <Plus className="w-3.5 h-3.5 mr-1" aria-hidden /> {t('LQhse.addInjury')}
              </Button>
            </form>
          </SubSection>

          {/* Procédures QHSE */}
          <SubSection title={t('LQhse.qhseProcedures')} count={detail.procedureExecs.length}>
            {detail.procedureExecs.length === 0 ? (
              <p className="text-xs text-slate-500 italic">{t('LQhse.noProcedure')}</p>
            ) : (
              <ul className="space-y-3">
                {detail.procedureExecs.map(exec => {
                  const sortedSteps = [...exec.stepExecs].sort((a, b) => a.step.order - b.step.order);
                  const nextStep = sortedSteps.find(s => s.isOk === null);
                  const done = sortedSteps.filter(s => s.isOk !== null).length;
                  return (
                    <li key={exec.id} className="rounded-md border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <p className="text-sm font-medium">{exec.procedure.name}</p>
                          <p className="text-xs text-slate-500 font-mono">{exec.procedure.triggerCode}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500 tabular-nums">{done}/{sortedSteps.length}</span>
                          <Badge variant={exec.status === 'COMPLETED' ? 'success' : exec.status === 'ABORTED' ? 'danger' : 'warning'} size="sm">
                            {exec.status}
                          </Badge>
                        </div>
                      </div>
                      <ol className="space-y-1.5">
                        {sortedSteps.map(se => {
                          const ok      = se.isOk === true;
                          const ko      = se.isOk === false;
                          const pending = se.isOk === null;
                          const isNext  = pending && se === nextStep;
                          return (
                            <li key={se.id} className={cn(
                              'flex items-start gap-2 text-xs px-2 py-1.5 rounded',
                              isNext && 'bg-amber-50 dark:bg-amber-900/20',
                              ok && 'opacity-60',
                            )}>
                              {ok ? <CheckSquare className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" aria-hidden />
                                : ko ? <Square className="w-4 h-4 text-red-600 mt-0.5 shrink-0" aria-hidden />
                                : <Square className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" aria-hidden />}
                              <div className="flex-1">
                                <p className={cn('font-medium', ok && 'line-through')}>
                                  {se.step.order}. {se.step.description}
                                </p>
                                <p className="text-[10px] text-slate-500">
                                  {se.step.responsible}
                                  {se.step.isPhotoRequired && ' · 📷'}
                                  {se.step.isVerification && ' · ✓'}
                                  {se.notes && ` · ${se.notes}`}
                                </p>
                              </div>
                              {isNext && (
                                <div className="flex gap-1 shrink-0">
                                  <button type="button"
                                    onClick={() => executeStep(exec.id, se.step.id, true)}
                                    className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-semibold hover:bg-emerald-700"
                                    disabled={busy}>OK</button>
                                  <button type="button"
                                    onClick={() => executeStep(exec.id, se.step.id, false)}
                                    className="px-2 py-0.5 rounded bg-red-600 text-white text-[10px] font-semibold hover:bg-red-700"
                                    disabled={busy}>KO</button>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <select value={procId} onChange={e => setProcId(e.target.value)}
                className={cn(inp, 'flex-1')} disabled={busy}>
                <option value="">{t('LQhse.startProcedure')}</option>
                {procedures.filter(p =>
                  !detail.procedureExecs.some(ex => ex.procedureId === p.id),
                ).map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.triggerCode})</option>
                ))}
              </select>
              <Button type="button" size="sm" onClick={startExecution}
                disabled={!procId || busy} loading={busy}>
                <PlayCircle className="w-3.5 h-3.5 mr-1" aria-hidden /> {t('LQhse.launch')}
              </Button>
            </div>
          </SubSection>
        </div>
      )}
    </Dialog>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">{label}</p>
      <div className="text-slate-700 dark:text-slate-300">{children}</div>
    </div>
  );
}

function SubSection({
  title, count, children,
}: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-1">
        <FileText className="w-4 h-4 text-teal-500" aria-hidden /> {title}
        {count !== undefined && <span className="text-xs font-normal text-slate-500">({count})</span>}
      </h3>
      {children}
    </section>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export function PageQhse() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const userId   = user?.id ?? '';

  const [tab, setTab] = useState<Tab>('accidents');
  const base = `/api/tenants/${tenantId}/qhse`;

  const { data: accidents,  loading: loadingAccidents,  refetch: refetchAccidents }
    = useFetch<AccidentRow[]>(tenantId ? `${base}/accidents` : null, [tenantId]);
  const { data: procedures, loading: loadingProcedures, refetch: refetchProcedures }
    = useFetch<ProcedureRow[]>(tenantId ? `${base}/procedures` : null, [tenantId]);
  const { data: severities, loading: loadingSeverities, refetch: refetchSeverities }
    = useFetch<SeverityType[]>(tenantId ? `${base}/severity-types` : null, [tenantId]);
  const { data: hospitals,  loading: loadingHospitals,  refetch: refetchHospitals }
    = useFetch<Hospital[]>(tenantId ? `${base}/hospitals` : null, [tenantId]);
  const { data: buses } = useFetch<BusRow[]>(
    tenantId ? `/api/tenants/${tenantId}/fleet/buses` : null, [tenantId],
  );

  // ── Dialogues ──
  const [showAccident,  setShowAccident]  = useState(false);
  const [showSeverity,  setShowSeverity]  = useState(false);
  const [showHospital,  setShowHospital]  = useState(false);
  const [showProcedure, setShowProcedure] = useState(false);
  const [disputeFor,    setDisputeFor]    = useState<AccidentRow | null>(null);
  const [editSeverity,  setEditSeverity]  = useState<SeverityType | null>(null);
  const [editHospital,  setEditHospital]  = useState<Hospital | null>(null);
  const [editProcedure, setEditProcedure] = useState<ProcedureRow | null>(null);
  const [detailAccId,   setDetailAccId]   = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<
    | { kind: 'severity';  item: SeverityType }
    | { kind: 'hospital';  item: Hospital }
    | { kind: 'procedure'; item: ProcedureRow }
    | null
  >(null);

  const [busy,      setBusy]      = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  // ── Filtre Accidents ──
  const [statusFilter, setStatusFilter] = useState<'' | AccidentStatus>('');
  const filteredAccidents = useMemo(() => {
    const list = accidents ?? [];
    return statusFilter ? list.filter(a => a.status === statusFilter) : list;
  }, [accidents, statusFilter]);

  // ── KPIs ──
  const openCount    = accidents?.filter(a => a.status === 'OPEN').length ?? 0;
  const injuredTotal = accidents?.reduce((sum, a) => sum + (a._count?.injuries ?? 0), 0) ?? 0;
  const disputeCount = accidents?.filter(a => a.disputeTracking).length ?? 0;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'accidents',  label: t('LQhse.tabAccidents') },
    { id: 'disputes',   label: t('LQhse.tabDisputes') },
    { id: 'procedures', label: t('LQhse.tabProcedures') },
    { id: 'config',     label: t('LQhse.tabConfig') },
  ];

  const busPlate = (id: string | null) =>
    id ? (buses?.find(b => b.id === id)?.plateNumber ?? '—') : '—';

  // ── Handlers ──

  const handleCreateAccident = async (v: AccidentFormValues) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPost(`${base}/accidents`, {
        busId:          v.busId || undefined,
        severityTypeId: v.severityTypeId,
        reportedById:   userId,
        reportedByRole: v.reportedByRole,
        occurredAt:     new Date(v.occurredAt).toISOString(),
        locationDesc:   v.locationDesc || undefined,
        description:    v.description,
        circumstance:   v.circumstance || undefined,
      });
      setShowAccident(false); refetchAccidents();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleCreateSeverity = async (v: SeverityFormValues) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPost(`${base}/severity-types`, {
        name: v.name, code: v.code, color: v.color,
        requiresQhse: v.requiresQhse, requiresPolice: v.requiresPolice, requiresInsurer: v.requiresInsurer,
        sortOrder: v.sortOrder ? Number(v.sortOrder) : 0,
      });
      setShowSeverity(false); refetchSeverities();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleCreateHospital = async (v: HospitalFormValues) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPost(`${base}/hospitals`, {
        name: v.name, city: v.city,
        address: v.address || undefined,
        phone:   v.phone   || undefined,
      });
      setShowHospital(false); refetchHospitals();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleCreateProcedure = async (v: ProcedureFormValues) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPost(`${base}/procedures`, {
        name: v.name, triggerCode: v.triggerCode,
        description: v.description || undefined,
        steps: v.steps.map(s => ({
          order: s.order, description: s.description, responsible: s.responsible,
          isVerification: s.isVerification ?? false,
          isPhotoRequired: s.isPhotoRequired ?? false,
        })),
      });
      setShowProcedure(false); refetchProcedures();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleUpdateSeverity = async (v: SeverityFormValues) => {
    if (!editSeverity) return;
    setBusy(true); setActionErr(null);
    try {
      await apiPatch(`${base}/severity-types/${editSeverity.id}`, {
        name: v.name, code: v.code, color: v.color,
        requiresQhse: v.requiresQhse, requiresPolice: v.requiresPolice, requiresInsurer: v.requiresInsurer,
        sortOrder: v.sortOrder ? Number(v.sortOrder) : 0,
      });
      setEditSeverity(null); refetchSeverities();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleUpdateHospital = async (v: HospitalFormValues) => {
    if (!editHospital) return;
    setBusy(true); setActionErr(null);
    try {
      await apiPatch(`${base}/hospitals/${editHospital.id}`, {
        name: v.name, city: v.city,
        address: v.address || undefined,
        phone:   v.phone   || undefined,
      });
      setEditHospital(null); refetchHospitals();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleUpdateProcedure = async (v: ProcedureEditValues) => {
    if (!editProcedure) return;
    setBusy(true); setActionErr(null);
    try {
      await apiPatch(`${base}/procedures/${editProcedure.id}`, {
        name: v.name,
        description: v.description || undefined,
        isActive: v.isActive,
      });
      setEditProcedure(null); refetchProcedures();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    setBusy(true); setActionErr(null);
    try {
      const path = confirmDelete.kind === 'severity'  ? `severity-types/${confirmDelete.item.id}`
                 : confirmDelete.kind === 'hospital'  ? `hospitals/${confirmDelete.item.id}`
                 : `procedures/${confirmDelete.item.id}`;
      await apiDelete(`${base}/${path}`);
      if (confirmDelete.kind === 'severity')  refetchSeverities();
      if (confirmDelete.kind === 'hospital')  refetchHospitals();
      if (confirmDelete.kind === 'procedure') refetchProcedures();
      setConfirmDelete(null);
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const handleOpenDispute = async (v: DisputeFormValues) => {
    if (!disputeFor) return;
    setBusy(true); setActionErr(null);
    try {
      await apiPost(`${base}/accidents/${disputeFor.id}/dispute`, {
        mode: v.mode,
        insurerRef:     v.insurerRef     || undefined,
        insurerName:    v.insurerName    || undefined,
        estimatedTotal: v.estimatedTotal ? Number(v.estimatedTotal) : undefined,
      });
      setDisputeFor(null); refetchAccidents();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  // ── Colonnes DataTableMaster ──

  const accidentColumns: Column<AccidentRow>[] = useMemo(() => [
    {
      key: 'occurredAt', header: t('common.date'), sortable: true,
      cellRenderer: (v) => (
        <span className="text-sm text-slate-700 dark:text-slate-300 tabular-nums">
          {new Date(v as string).toLocaleString('fr-FR')}
        </span>
      ),
      csvValue: (v) => new Date(v as string).toLocaleString('fr-FR'),
    },
    {
      key: 'busId', header: 'Bus',
      cellRenderer: (v) => (
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
          {busPlate(v as string | null)}
        </span>
      ),
      csvValue: (v) => busPlate(v as string | null),
    },
    {
      key: 'severityType', header: t('LQhse.severity'), sortable: true,
      cellRenderer: (_v, row) => (
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: row.severityType.color }} aria-hidden />
          <span className="text-sm text-slate-700 dark:text-slate-300">{row.severityType.name}</span>
        </div>
      ),
      csvValue: (_v, row) => row.severityType.name,
    },
    {
      key: 'locationDesc', header: t('LQhse.location'),
      cellRenderer: (v) => (
        <span className="text-sm text-slate-600 dark:text-slate-400">{(v as string) || '—'}</span>
      ),
    },
    {
      key: '_count', header: t('LQhse.injuries'), align: 'right',
      cellRenderer: (_v, row) => {
        const n = row._count?.injuries ?? 0;
        return n === 0
          ? <span className="text-sm text-slate-400">0</span>
          : <Badge variant="warning" size="sm">{n}</Badge>;
      },
      csvValue: (_v, row) => String(row._count?.injuries ?? 0),
    },
    {
      key: 'disputeTracking', header: t('LQhse.tabDisputes'),
      cellRenderer: (v) =>
        v
          ? <Badge variant="info" size="sm">{t('LQhse.opened')}</Badge>
          : <span className="text-sm text-slate-400">—</span>,
      csvValue: (v) => (v ? t('LQhse.opened') : ''),
    },
    {
      key: 'status', header: t('LQhse.status'), sortable: true,
      cellRenderer: (v) => (
        <Badge variant={STATUS_VARIANT[v as AccidentStatus]} size="sm">
          {t(STATUS_LABEL[v as AccidentStatus])}
        </Badge>
      ),
      csvValue: (v) => t(STATUS_LABEL[v as AccidentStatus]),
    },
  ] as Column<AccidentRow>[], [buses, t]);

  const accidentRowActions: RowAction<AccidentRow>[] = [
    {
      label: t('LQhse.detail'),
      icon:  <FileText size={13} />,
      onClick: (row) => { setActionErr(null); setDetailAccId(row.id); },
    },
    {
      label: t('LQhse.openDisputeAction'),
      icon:  <Gavel size={13} />,
      onClick: (row) => { setActionErr(null); setDisputeFor(row); },
      hidden: (row) => !!row.disputeTracking,
    },
  ];

  const severityRowActions: RowAction<SeverityType>[] = [
    {
      label: t('LQhse.modify'),
      icon:  <Pencil size={13} />,
      onClick: (row) => { setActionErr(null); setEditSeverity(row); },
    },
    {
      label: t('common.delete'),
      icon:  <Trash2 size={13} />,
      danger: true,
      onClick: (row) => { setActionErr(null); setConfirmDelete({ kind: 'severity', item: row }); },
    },
  ];

  const hospitalRowActions: RowAction<Hospital>[] = [
    {
      label: t('LQhse.modify'),
      icon:  <Pencil size={13} />,
      onClick: (row) => { setActionErr(null); setEditHospital(row); },
    },
    {
      label: t('common.delete'),
      icon:  <Trash2 size={13} />,
      danger: true,
      onClick: (row) => { setActionErr(null); setConfirmDelete({ kind: 'hospital', item: row }); },
    },
  ];

  const toggleProcedureActive = async (row: ProcedureRow) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPatch(`${base}/procedures/${row.id}`, { isActive: !row.isActive });
      refetchProcedures();
    } catch (e) { setActionErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const procedureRowActions: RowAction<ProcedureRow>[] = [
    {
      label: t('LQhse.modify'),
      icon:  <Pencil size={13} />,
      onClick: (row) => { setActionErr(null); setEditProcedure(row); },
    },
    {
      label: t('LQhse.deactivate'),
      icon:  <Power size={13} />,
      onClick: toggleProcedureActive,
      hidden: (row) => !row.isActive,
    },
    {
      label: t('LQhse.activate'),
      icon:  <Power size={13} />,
      onClick: toggleProcedureActive,
      hidden: (row) => row.isActive,
    },
    {
      label: t('common.delete'),
      icon:  <Trash2 size={13} />,
      danger: true,
      onClick: (row) => { setActionErr(null); setConfirmDelete({ kind: 'procedure', item: row }); },
    },
  ];

  const disputeColumns: Column<AccidentRow>[] = useMemo(() => [
    {
      key: 'occurredAt', header: 'Date', sortable: true,
      cellRenderer: (v) => (
        <span className="text-sm text-slate-700 dark:text-slate-300 tabular-nums">
          {new Date(v as string).toLocaleDateString('fr-FR')}
        </span>
      ),
    },
    {
      key: 'busId', header: 'Bus',
      cellRenderer: (v) => <span className="text-sm">{busPlate(v as string | null)}</span>,
    },
    {
      key: 'severityType', header: t('LQhse.severity'),
      cellRenderer: (_v, row) => <span className="text-sm">{row.severityType.name}</span>,
    },
    {
      key: 'disputeTracking', header: t('LQhse.disputeState'),
      cellRenderer: (v) => {
        const d = v as { status: string } | null;
        return d ? <Badge variant="info" size="sm">{d.status}</Badge> : <span>—</span>;
      },
    },
    {
      key: 'status', header: t('LQhse.accidentLabel'),
      cellRenderer: (v) => (
        <Badge variant={STATUS_VARIANT[v as AccidentStatus]} size="sm">
          {t(STATUS_LABEL[v as AccidentStatus])}
        </Badge>
      ),
    },
  ], [buses, t]);

  const procedureColumns: Column<ProcedureRow>[] = [
    {
      key: 'name', header: t('common.name'), sortable: true,
      cellRenderer: (v) => (
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{v as string}</span>
      ),
    },
    {
      key: 'triggerCode', header: t('LQhse.trigger'), sortable: true,
      cellRenderer: (v) => (
        <span className="text-xs font-mono text-slate-600 dark:text-slate-400">{v as string}</span>
      ),
    },
    {
      key: 'steps', header: t('LQhse.steps'), align: 'right',
      cellRenderer: (_v, row) => (
        <span className="text-sm text-slate-600 dark:text-slate-400 tabular-nums">{row.steps.length}</span>
      ),
      csvValue: (_v, row) => String(row.steps.length),
    },
    {
      key: 'version', header: t('LQhse.version'), align: 'right',
      cellRenderer: (v) => <span className="text-sm tabular-nums">v{v as number}</span>,
    },
    {
      key: 'isActive', header: t('LQhse.stateLabel'),
      cellRenderer: (v) => v
        ? <Badge variant="success" size="sm">{t('LQhse.active')}</Badge>
        : <Badge variant="default" size="sm">{t('LQhse.inactive')}</Badge>,
      csvValue: (v) => (v ? t('LQhse.active') : t('LQhse.inactive')),
    },
  ];

  const severityColumns: Column<SeverityType>[] = [
    {
      key: 'sortOrder', header: t('LQhse.order'), sortable: true, align: 'right',
      cellRenderer: (v) => <span className="text-sm tabular-nums">{v as number}</span>,
    },
    {
      key: 'name', header: t('common.name'), sortable: true,
      cellRenderer: (_v, row) => (
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: row.color }} aria-hidden />
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{row.name}</span>
        </div>
      ),
      csvValue: (_v, row) => row.name,
    },
    {
      key: 'code', header: 'Code', sortable: true,
      cellRenderer: (v) => (
        <span className="text-xs font-mono text-slate-500">{v as string}</span>
      ),
    },
    {
      key: 'requiresQhse', header: 'QHSE',
      cellRenderer: (v) => v ? <Badge variant="warning" size="sm">QHSE</Badge> : <span className="text-slate-300">—</span>,
      csvValue: (v) => (v ? 'oui' : ''),
    },
    {
      key: 'requiresPolice', header: 'Police',
      cellRenderer: (v) => v ? <Badge variant="danger" size="sm">Police</Badge> : <span className="text-slate-300">—</span>,
      csvValue: (v) => (v ? 'oui' : ''),
    },
    {
      key: 'requiresInsurer', header: t('LQhse.insurance'),
      cellRenderer: (v) => v ? <Badge variant="info" size="sm">Assureur</Badge> : <span className="text-slate-300">—</span>,
      csvValue: (v) => (v ? 'oui' : ''),
    },
  ];

  const hospitalColumns: Column<Hospital>[] = [
    {
      key: 'name', header: t('common.name'), sortable: true,
      cellRenderer: (v) => (
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{v as string}</span>
      ),
    },
    {
      key: 'city', header: t('LQhse.city'), sortable: true,
      cellRenderer: (v) => <span className="text-sm text-slate-600 dark:text-slate-400">{v as string}</span>,
    },
    {
      key: 'address', header: t('common.address'),
      cellRenderer: (v) => (
        <span className="text-sm text-slate-500 dark:text-slate-400">{(v as string) || '—'}</span>
      ),
    },
    {
      key: 'phone', header: t('common.phone'),
      cellRenderer: (v) => (
        <span className="text-sm font-mono text-slate-500">{(v as string) || '—'}</span>
      ),
    },
  ];

  // ── Initial form values ──
  const initialAccident: AccidentFormValues = {
    busId: '', severityTypeId: '', reportedByRole: 'QHSE',
    occurredAt: new Date().toISOString().slice(0, 16),
    locationDesc: '', description: '', circumstance: '',
  };
  const initialSeverity: SeverityFormValues = {
    name: '', code: '', color: '#f59e0b',
    requiresQhse: false, requiresPolice: false, requiresInsurer: false,
    sortOrder: '0',
  };
  const initialHospital: HospitalFormValues = { name: '', city: '', address: '', phone: '' };
  const initialProcedure: ProcedureFormValues = {
    name: '', triggerCode: '', description: '', steps: [{ ...EMPTY_STEP }],
  };

  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('LQhse.pageTitle')}>
      {/* ── En-tête ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/30">
            <AlertOctagon className="w-5 h-5 text-red-600 dark:text-red-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('LQhse.pageTitle')}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {t('LQhse.pageDesc')}
            </p>
          </div>
        </div>
        <Button
          variant="destructive"
          aria-label={t('LQhse.declareAccident')}
          onClick={() => { setActionErr(null); setShowAccident(true); }}
          disabled={!severities?.length}
          title={!severities?.length ? t('LQhse.configSeverityFirst') : undefined}
        >
          <Plus className="w-4 h-4 mr-2" aria-hidden />
          {t('LQhse.declareAccident')}
        </Button>
      </div>

      <ErrorAlert error={actionErr} icon />

      {/* ── KPIs ── */}
      <section aria-label={t('LQhse.indicatorsQhse')} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label={t('LQhse.openAccidents')}   value={openCount}             icon={<AlertOctagon className="w-5 h-5" />} tone={openCount > 0 ? 'danger' : 'success'} />
        <Kpi label={t('LQhse.injuredTotal')}     value={injuredTotal}          icon={<Users className="w-5 h-5" />}        tone={injuredTotal > 0 ? 'warning' : 'success'} />
        <Kpi label={t('LQhse.ongoingDisputes')}  value={disputeCount}          icon={<Gavel className="w-5 h-5" />}        tone={disputeCount > 0 ? 'warning' : 'success'} />
        <Kpi label={t('LQhse.configProcedures')} value={procedures?.length ?? 0} icon={<ClipboardCheck className="w-5 h-5" />} tone="default" />
      </section>

      {/* ── Tabs ── */}
      <nav aria-label="Sections QHSE" role="tablist">
        <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
          {tabs.map(tb => (
            <button
              key={tb.id}
              role="tab"
              aria-selected={tab === tb.id}
              aria-controls={`tabpanel-qhse-${tb.id}`}
              id={`tab-qhse-${tb.id}`}
              onClick={() => setTab(tb.id)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                tab === tb.id
                  ? 'border-teal-600 text-teal-600 dark:border-teal-400 dark:text-teal-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300',
              )}
            >
              {tb.label}
              {tb.id === 'accidents' && openCount > 0 && (
                <span
                  className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold"
                  aria-label={`${openCount} ${t('LQhse.openAccLabel')}`}
                >
                  {openCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* ── Accidents ── */}
      {tab === 'accidents' && (
        <section id="tabpanel-qhse-accidents" role="tabpanel" aria-labelledby="tab-qhse-accidents" aria-live="polite" className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-sm text-slate-600 dark:text-slate-400">{t('LQhse.statusFilter')}</label>
            <select value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as '' | AccidentStatus)}
              className={cn(inp, 'w-auto')}>
              <option value="">{t('LQhse.all')}</option>
              {(['OPEN','UNDER_INVESTIGATION','LEGAL','SETTLED','CLOSED'] as AccidentStatus[]).map(s => (
                <option key={s} value={s}>{t(STATUS_LABEL[s])}</option>
              ))}
            </select>
          </div>

          <DataTableMaster<AccidentRow>
            columns={accidentColumns}
            data={filteredAccidents}
            loading={loadingAccidents}
            rowActions={accidentRowActions}
            onRowClick={(row) => { setActionErr(null); setDetailAccId(row.id); }}
            defaultSort={{ key: 'occurredAt', dir: 'desc' }}
            defaultPageSize={25}
            searchPlaceholder={t('LQhse.searchAccident')}
            emptyMessage={t('LQhse.noAccident')}
            exportFormats={['csv', 'json', 'xls', 'pdf']}
            exportFilename="accidents"
            stickyHeader
          />
        </section>
      )}

      {/* ── Litiges ── */}
      {tab === 'disputes' && (
        <section id="tabpanel-qhse-disputes" role="tabpanel" aria-labelledby="tab-qhse-disputes">
          <DataTableMaster<AccidentRow>
            columns={disputeColumns}
            data={(accidents ?? []).filter(a => a.disputeTracking)}
            loading={loadingAccidents}
            onRowClick={(row) => { setActionErr(null); setDetailAccId(row.id); }}
            defaultSort={{ key: 'occurredAt', dir: 'desc' }}
            defaultPageSize={25}
            searchPlaceholder={t('LQhse.searchDispute')}
            emptyMessage={t('LQhse.noDispute')}
            exportFormats={['csv', 'json']}
            exportFilename="litiges"
            stickyHeader
          />
        </section>
      )}

      {/* ── Procédures ── */}
      {tab === 'procedures' && (
        <section id="tabpanel-qhse-procedures" role="tabpanel" aria-labelledby="tab-qhse-procedures" className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm"
              onClick={() => { setActionErr(null); setShowProcedure(true); }}
              aria-label="Créer une nouvelle procédure QHSE">
              <Plus className="w-4 h-4 mr-1" aria-hidden /> {t('LQhse.procedure')}
            </Button>
          </div>
          <DataTableMaster<ProcedureRow>
            columns={procedureColumns}
            data={procedures ?? []}
            loading={loadingProcedures}
            rowActions={procedureRowActions}
            onRowClick={(row) => { setActionErr(null); setEditProcedure(row); }}
            defaultSort={{ key: 'name', dir: 'asc' }}
            defaultPageSize={25}
            searchPlaceholder={t('LQhse.searchProcedure')}
            emptyMessage={t('LQhse.noProcedureConfig')}
            exportFormats={['csv', 'json']}
            exportFilename="procedures-qhse"
            stickyHeader
          />
        </section>
      )}

      {/* ── Configuration ── */}
      {tab === 'config' && (
        <section id="tabpanel-qhse-config" role="tabpanel" aria-labelledby="tab-qhse-config" className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <Palette className="w-4 h-4 text-teal-500" aria-hidden />
                {t('LQhse.severityTypes')}
              </h2>
              <Button size="sm" onClick={() => { setActionErr(null); setShowSeverity(true); }}
                aria-label="Ajouter un type de sévérité">
                <Plus className="w-4 h-4 mr-1" aria-hidden /> Type
              </Button>
            </div>
            <DataTableMaster<SeverityType>
              columns={severityColumns}
              data={severities ?? []}
              loading={loadingSeverities}
              rowActions={severityRowActions}
              onRowClick={(row) => { setActionErr(null); setEditSeverity(row); }}
              defaultSort={{ key: 'sortOrder', dir: 'asc' }}
              defaultPageSize={25}
              searchPlaceholder={t('LQhse.searchType')}
              emptyMessage={t('LQhse.noType')}
              exportFormats={['csv', 'json']}
              exportFilename="severites-qhse"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-teal-500" aria-hidden />
                {t('LQhse.referencedHospitals')}
              </h2>
              <Button size="sm" onClick={() => { setActionErr(null); setShowHospital(true); }}
                aria-label="Ajouter un hôpital">
                <Plus className="w-4 h-4 mr-1" aria-hidden /> Hôpital
              </Button>
            </div>
            <DataTableMaster<Hospital>
              columns={hospitalColumns}
              data={hospitals ?? []}
              loading={loadingHospitals}
              rowActions={hospitalRowActions}
              onRowClick={(row) => { setActionErr(null); setEditHospital(row); }}
              defaultSort={{ key: 'city', dir: 'asc' }}
              defaultPageSize={25}
              searchPlaceholder={t('LQhse.searchHospital')}
              emptyMessage={t('LQhse.noHospital')}
              exportFormats={['csv', 'json']}
              exportFilename="hopitaux"
            />
          </div>
        </section>
      )}

      {/* ── Dialogues ── */}
      <Dialog open={showAccident} onOpenChange={o => { if (!o) setShowAccident(false); }}
        title={t('LQhse.declareAccTitle')}
        description={t('LQhse.declareAccDesc')}
        size="xl">
        <AccidentForm
          buses={buses ?? []}
          severities={severities ?? []}
          initial={initialAccident}
          onSubmit={handleCreateAccident}
          onCancel={() => setShowAccident(false)}
          busy={busy}
          error={actionErr}
        />
      </Dialog>

      <Dialog open={showSeverity} onOpenChange={o => { if (!o) setShowSeverity(false); }}
        title={t('LQhse.addSeverityTitle')}
        description={t('LQhse.addSeverityDesc')}
        size="xl">
        <SeverityForm
          initial={initialSeverity}
          onSubmit={handleCreateSeverity}
          onCancel={() => setShowSeverity(false)}
          busy={busy}
          error={actionErr}
        />
      </Dialog>

      <Dialog open={showHospital} onOpenChange={o => { if (!o) setShowHospital(false); }}
        title={t('LQhse.addHospitalTitle')}
        description={t('LQhse.addHospitalDesc')}
        size="lg">
        <HospitalForm
          initial={initialHospital}
          onSubmit={handleCreateHospital}
          onCancel={() => setShowHospital(false)}
          busy={busy}
          error={actionErr}
        />
      </Dialog>

      <Dialog open={showProcedure} onOpenChange={o => { if (!o) setShowProcedure(false); }}
        title={t('LQhse.createProcTitle')}
        description={t('LQhse.createProcDesc')}
        size="2xl">
        <ProcedureForm
          initial={initialProcedure}
          onSubmit={handleCreateProcedure}
          onCancel={() => setShowProcedure(false)}
          busy={busy}
          error={actionErr}
        />
      </Dialog>

      <Dialog open={!!disputeFor} onOpenChange={o => { if (!o) setDisputeFor(null); }}
        title={t('LQhse.openDisputeTitle')}
        description={disputeFor ? `${t('LQhse.accidentOf')} ${new Date(disputeFor.occurredAt).toLocaleString('fr-FR')}` : undefined}
        size="lg">
        {disputeFor && (
          <DisputeForm
            onSubmit={handleOpenDispute}
            onCancel={() => setDisputeFor(null)}
            busy={busy}
            error={actionErr}
          />
        )}
      </Dialog>

      {/* Édition sévérité */}
      <Dialog open={!!editSeverity} onOpenChange={o => { if (!o) setEditSeverity(null); }}
        title={t('LQhse.editSeverityTitle')}
        description={editSeverity?.name}
        size="xl">
        {editSeverity && (
          <SeverityForm
            initial={{
              name: editSeverity.name, code: editSeverity.code, color: editSeverity.color,
              requiresQhse: editSeverity.requiresQhse,
              requiresPolice: editSeverity.requiresPolice,
              requiresInsurer: editSeverity.requiresInsurer,
              sortOrder: String(editSeverity.sortOrder),
            }}
            onSubmit={handleUpdateSeverity}
            onCancel={() => setEditSeverity(null)}
            busy={busy}
            error={actionErr}
            submitLabel={t('common.save')}
            pendingLabel={t('common.saving')}
          />
        )}
      </Dialog>

      {/* Édition hôpital */}
      <Dialog open={!!editHospital} onOpenChange={o => { if (!o) setEditHospital(null); }}
        title={t('LQhse.editHospitalTitle')}
        description={editHospital?.name}
        size="lg">
        {editHospital && (
          <HospitalForm
            initial={{
              name: editHospital.name, city: editHospital.city,
              address: editHospital.address ?? '', phone: editHospital.phone ?? '',
            }}
            onSubmit={handleUpdateHospital}
            onCancel={() => setEditHospital(null)}
            busy={busy}
            error={actionErr}
            submitLabel={t('common.save')}
            pendingLabel={t('common.saving')}
          />
        )}
      </Dialog>

      {/* Édition procédure */}
      <Dialog open={!!editProcedure} onOpenChange={o => { if (!o) setEditProcedure(null); }}
        title={t('LQhse.editProcTitle')}
        description={editProcedure?.name}
        size="lg">
        {editProcedure && (
          <ProcedureEditForm
            initial={{
              name: editProcedure.name,
              description: editProcedure.description ?? '',
              isActive: editProcedure.isActive,
            }}
            onSubmit={handleUpdateProcedure}
            onCancel={() => setEditProcedure(null)}
            busy={busy}
            error={actionErr}
          />
        )}
      </Dialog>

      {/* Confirmation suppression */}
      <Dialog open={!!confirmDelete} onOpenChange={o => { if (!o) setConfirmDelete(null); }}
        title={t('LQhse.confirmDelete')}
        description={
          confirmDelete
            ? `${t('common.delete')} "${
                confirmDelete.kind === 'severity'  ? confirmDelete.item.name :
                confirmDelete.kind === 'hospital'  ? confirmDelete.item.name :
                confirmDelete.item.name
              }" ${t('LQhse.deleteDesc')}`
            : undefined
        }
        size="sm"
        footer={
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleConfirmDelete} disabled={busy} loading={busy}
              className="bg-red-600 hover:bg-red-700 text-white border-red-600">
              <Trash2 className="w-4 h-4 mr-1.5" aria-hidden /> {t('common.delete')}
            </Button>
          </div>
        }>
        <ErrorAlert error={actionErr} />
      </Dialog>

      {/* Détail accident */}
      <AccidentDetailDialog
        open={!!detailAccId}
        onOpenChange={o => { if (!o) setDetailAccId(null); }}
        tenantId={tenantId}
        accidentId={detailAccId}
        hospitals={hospitals ?? []}
        procedures={procedures ?? []}
        userId={userId}
        onChanged={refetchAccidents}
      />
    </main>
  );
}

// ─── KPI ──────────────────────────────────────────────────────────────────────

function Kpi({
  label, value, icon, tone = 'default',
}: {
  label: string; value: number; icon: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const toneClass = {
    default: 'bg-slate-100 dark:bg-slate-800 text-slate-500',
    success: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500',
    warning: 'bg-amber-50 dark:bg-amber-900/20 text-amber-500',
    danger:  'bg-red-50 dark:bg-red-900/20 text-red-500',
  }[tone];
  return (
    <article
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex items-center gap-4"
      aria-label={`${label}: ${value}`}
    >
      <div className={cn('p-3 rounded-lg shrink-0', toneClass)} aria-hidden>{icon}</div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
        <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">
          {value.toLocaleString('fr-FR')}
        </p>
      </div>
    </article>
  );
}

