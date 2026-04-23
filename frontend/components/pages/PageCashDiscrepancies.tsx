/**
 * PageCashDiscrepancies — audit admin des clôtures de caisse avec écart.
 *
 * Backend : GET /tenants/:tid/cashier/discrepancies?sinceDays=30&agencyId=
 * Permission : data.cashier.close.agency (même scope que la clôture).
 *
 * Light mode first + dark: variants. i18n FR + EN (autres locales TODO).
 * WCAG : DataTableMaster (déjà accessible) + aria-label sur filtres.
 */

import { useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useAuth }     from '../../lib/auth/auth.context';
import { useI18n }     from '../../lib/i18n/useI18n';
import { useFetch }    from '../../lib/hooks/useFetch';
import { useCurrencyFormatter } from '../../providers/TenantConfigProvider';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';
import { inputClass } from '../ui/inputClass';
import { Dialog, Button } from '../ui';
import { apiPatch } from '../../lib/api';

interface Row {
  id:             string;
  agencyId:       string;
  agencyName:     string | null;
  agentId:        string;
  openedAt:       string;
  closedAt:       string | null;
  initialBalance: number;
  finalBalance:   number | null;
  theoretical:    number;
  discrepancy:    number;
  txCount:        number;
}

// Fenêtres proposées — pas de magic number côté render.
const WINDOWS = [
  { days: 7,  labelFr: '7 jours',   labelEn: '7 days'   },
  { days: 30, labelFr: '30 jours',  labelEn: '30 days'  },
  { days: 90, labelFr: '90 jours',  labelEn: '90 days'  },
];

// Justification min/max — alignés sur ResolveDiscrepancyDto (MinLength(10) / MaxLength(1000)).
const RESOLUTION_NOTE_MIN = 10;
const RESOLUTION_NOTE_MAX = 1_000;

export function PageCashDiscrepancies() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const fmt = useCurrencyFormatter();
  const tenantId = user?.tenantId ?? '';
  const [sinceDays, setSinceDays] = useState(WINDOWS[1].days);
  const [resolveRow, setResolveRow] = useState<Row | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const { data, loading, error } = useFetch<Row[]>(
    tenantId ? `/api/tenants/${tenantId}/cashier/discrepancies?sinceDays=${sinceDays}` : null,
    [tenantId, sinceDays, reloadKey],
  );

  const L = (fr: string, en: string) => (lang === 'en' ? en : fr);
  const rows = data ?? [];

  async function handleResolve() {
    if (!resolveRow) return;
    const note = resolutionNote.trim();
    if (note.length < RESOLUTION_NOTE_MIN) return;
    setResolving(true);
    setResolveError(null);
    try {
      await apiPatch(`/api/tenants/${tenantId}/cashier/registers/${resolveRow.id}/resolve`, {
        resolutionNote: note,
      });
      setResolveRow(null);
      setResolutionNote('');
      setReloadKey(k => k + 1);
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : L('Erreur de résolution', 'Resolve error'));
    } finally {
      setResolving(false);
    }
  }

  const rowActions: RowAction<Row>[] = [
    {
      label: L('Résoudre', 'Resolve'),
      icon:  <CheckCircle2 className="w-4 h-4" />,
      onClick: (row) => {
        setResolveRow(row);
        setResolutionNote('');
        setResolveError(null);
      },
    },
  ];

  const columns: Column<Row>[] = [
    {
      key: 'closedAt', sortable: true,
      header: L('Clôturée le', 'Closed at'),
      cellRenderer: (v) => v ? new Date(v as string).toLocaleString() : '—',
      csvValue:     (v) => v ? new Date(v as string).toISOString() : '',
    },
    {
      key: 'agencyName', sortable: true,
      header: L('Agence', 'Agency'),
      cellRenderer: (_v, r) => r.agencyName ?? r.agencyId.slice(0, 8),
    },
    {
      key: 'initialBalance', sortable: true, align: 'right',
      header: L('Solde initial', 'Opening'),
      cellRenderer: (_v, r) => fmt(r.initialBalance),
      csvValue:     (_v, r) => String(r.initialBalance),
    },
    {
      key: 'theoretical', sortable: true, align: 'right',
      header: L('Théorique', 'Expected'),
      cellRenderer: (_v, r) => fmt(r.theoretical),
      csvValue:     (_v, r) => String(r.theoretical),
    },
    {
      key: 'finalBalance', sortable: true, align: 'right',
      header: L('Compté', 'Counted'),
      cellRenderer: (_v, r) => r.finalBalance !== null ? fmt(r.finalBalance) : '—',
      csvValue:     (_v, r) => r.finalBalance !== null ? String(r.finalBalance) : '',
    },
    {
      key: 'discrepancy', sortable: true, align: 'right',
      header: L('Écart', 'Delta'),
      cellRenderer: (_v, r) => (
        <span className={r.discrepancy < 0 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-amber-600 dark:text-amber-400 font-semibold'}>
          {fmt(r.discrepancy)}
        </span>
      ),
      csvValue: (_v, r) => String(r.discrepancy),
    },
    {
      key: 'txCount', sortable: true, align: 'right',
      header: L('Nb TX', 'TX count'),
    },
  ];

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <header className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/40">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {L('Audit caisse — écarts', 'Cashier audit — discrepancies')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {L(
              'Clôtures où le montant compté diffère du solde théorique.',
              'Closings where the counted amount differs from the expected balance.',
            )}
          </p>
        </div>
      </header>

      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-700 dark:text-slate-300" htmlFor="discrepancy-window">
          {L('Fenêtre', 'Window')}
        </label>
        <select
          id="discrepancy-window"
          value={sinceDays}
          onChange={e => setSinceDays(Number(e.target.value))}
          className={inputClass + ' !w-auto'}
          aria-label={L('Fenêtre de temps', 'Time window')}
        >
          {WINDOWS.map(w => (
            <option key={w.days} value={w.days}>
              {lang === 'en' ? w.labelEn : w.labelFr}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      <DataTableMaster<Row>
        data={rows}
        columns={columns}
        keyField="id"
        loading={loading}
        rowActions={rowActions}
        emptyMessage={L('Aucun écart sur la période — bravo.', 'No discrepancy on this window — well done.')}
        exportFormats={['csv']}
        exportFilename="cash-discrepancies"
      />

      {resolveRow && (
        <Dialog
          open={!!resolveRow}
          onOpenChange={(o) => !o && !resolving && setResolveRow(null)}
          size="md"
          title={L('Résoudre l\'écart de caisse', 'Resolve cash discrepancy')}
          description={L(
            'Justification obligatoire tracée dans l\'audit immuable.',
            'A justification is required and tracked in the immutable audit log.',
          )}
          footer={
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setResolveRow(null)}
                disabled={resolving}
              >
                {L('Annuler', 'Cancel')}
              </Button>
              <Button
                onClick={handleResolve}
                disabled={resolutionNote.trim().length < RESOLUTION_NOTE_MIN || resolving}
                loading={resolving}
                leftIcon={<CheckCircle2 className="w-4 h-4" />}
              >
                {L('Confirmer la résolution', 'Confirm resolution')}
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="rounded-md bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">
                  {L('Agence', 'Agency')}
                </span>
                <span className="font-medium text-slate-900 dark:text-slate-50">
                  {resolveRow.agencyName ?? resolveRow.agencyId.slice(0, 8)}
                </span>
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-slate-600 dark:text-slate-400">
                  {L('Écart', 'Delta')}
                </span>
                <span className={`font-semibold ${resolveRow.discrepancy < 0 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {fmt(resolveRow.discrepancy)}
                </span>
              </div>
            </div>

            <div>
              <label
                htmlFor="resolution-note"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                {L('Justification (obligatoire)', 'Justification (required)')}
              </label>
              <textarea
                id="resolution-note"
                rows={4}
                maxLength={RESOLUTION_NOTE_MAX}
                className={inputClass}
                placeholder={L(
                  'Ex: billet 2000 XAF retrouvé sous tiroir, erreur rendu 15h30…',
                  'E.g. missing 2000 XAF banknote found under drawer, wrong change at 3:30 PM…',
                )}
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                disabled={resolving}
                aria-describedby="resolution-note-hint"
                aria-invalid={resolutionNote.trim().length > 0 && resolutionNote.trim().length < RESOLUTION_NOTE_MIN}
              />
              <p id="resolution-note-hint" className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {L(
                  `Min. ${RESOLUTION_NOTE_MIN} caractères — ${resolutionNote.trim().length}/${RESOLUTION_NOTE_MAX}`,
                  `Min. ${RESOLUTION_NOTE_MIN} chars — ${resolutionNote.trim().length}/${RESOLUTION_NOTE_MAX}`,
                )}
              </p>
            </div>

            {resolveError && (
              <div
                role="alert"
                className="rounded-md border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-800 dark:text-red-200"
              >
                {resolveError}
              </div>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}
