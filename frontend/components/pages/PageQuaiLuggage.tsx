/**
 * PageQuaiLuggage — contrôle des bagages passagers (agent de quai).
 *
 * V1 lecture : affiche la liste des voyageurs du trajet avec leur poids
 * bagage déclaré (champ Passenger.luggageKg). L'agent peut saisir/corriger
 * le poids constaté à la balance ; la mise à jour appelle un endpoint
 * générique POST /travelers/:id/verify qui est déjà perm-gated par
 * TRAVELER_VERIFY_AGENCY (l'AGENT_QUAI l'a).
 *
 * TODO backend (itération prochaine) : exposer PATCH /travelers/:id/luggage
 * { weightKg } pour mutation explicite. En attendant cette page reste une
 * vue de contrôle — la mise à jour du poids passe par le parcours de vente
 * (CASHIER ou portail public) ou un endpoint à créer.
 */

import { useMemo, useState } from 'react';
import { Luggage, Save, Loader2 } from 'lucide-react';
import { useAuth }   from '../../lib/auth/auth.context';
import { useI18n }  from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPatch, ApiError } from '../../lib/api';
import { Badge }      from '../ui/Badge';
import { Button }     from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { inputClass } from '../ui/inputClass';
import { TripPickerForDay } from '../agent/TripPickerForDay';
import DataTableMaster, { type Column } from '../DataTableMaster';

interface Traveler {
  id:            string;
  passengerName: string;
  seatNumber:    string | null;
  luggageKg:     number | null;
  status:        string;
}

export function PageQuaiLuggage() {
  const { t }    = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const [tripId, setTripId] = useState<string | null>(null);

  // On tape la même API que PageQuaiBoarding : /flight-deck/.../passengers
  // retourne `luggageKg` agrégé depuis Baggage (enrichi côté service).
  // L'id correspond au ticketId, qu'on utilise pour PATCH /luggage.
  const { data: travelers, loading, error, refetch } = useFetch<Traveler[]>(
    tenantId && tripId ? `/api/tenants/${tenantId}/flight-deck/trips/${tripId}/passengers` : null,
    [tenantId, tripId],
  );

  const [editId, setEditId] = useState<string | null>(null);
  const [draftKg, setDraftKg] = useState<string>('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<Record<string, string>>({});

  async function saveWeight(ticketId: string) {
    const weightKg = Number(draftKg);
    if (!Number.isFinite(weightKg) || weightKg < 0) {
      setRowErr(m => ({ ...m, [ticketId]: t('quaiLuggage.errInvalid') }));
      return;
    }
    setBusyId(ticketId); setRowErr(m => ({ ...m, [ticketId]: '' }));
    try {
      await apiPatch(
        `/api/tenants/${tenantId}/flight-deck/trips/${tripId}/passengers/${ticketId}/luggage`,
        { weightKg },
      );
      setEditId(null);
      setDraftKg('');
      refetch();
    } catch (e) {
      setRowErr(m => ({
        ...m,
        [ticketId]: e instanceof ApiError
          ? String((e.body as { message?: string })?.message ?? e.message)
          : String(e),
      }));
    } finally { setBusyId(null); }
  }

  const totalKg = useMemo(
    () => (travelers ?? []).reduce((sum, tr) => sum + (tr.luggageKg ?? 0), 0),
    [travelers],
  );
  const countDeclared = useMemo(
    () => (travelers ?? []).filter(tr => tr.luggageKg != null).length,
    [travelers],
  );

  const columns: Column<Traveler>[] = [
    { key: 'seatNumber',    header: t('quaiLuggage.colSeat'), width: '80px', cellRenderer: v => v ?? '—' },
    { key: 'passengerName', header: t('quaiLuggage.colName'), sortable: true },
    { key: 'luggageKg', header: t('quaiLuggage.colWeight'), sortable: true, width: '220px', align: 'right',
      cellRenderer: (v, row) => {
        const isEditing = editId === row.id;
        const isBusy    = busyId === row.id;
        const err       = rowErr[row.id];
        if (isEditing) {
          return (
            <div className="flex items-center gap-1.5 justify-end">
              <input
                type="number"
                min={0}
                step={0.1}
                value={draftKg}
                onChange={e => setDraftKg(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveWeight(row.id); if (e.key === 'Escape') { setEditId(null); setDraftKg(''); }}}
                className={`${inputClass} w-20 text-right tabular-nums`}
                autoFocus
                disabled={isBusy}
                aria-label={t('quaiLuggage.colWeight')}
              />
              <Button size="sm" onClick={() => saveWeight(row.id)} disabled={isBusy}
                leftIcon={isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}>
                OK
              </Button>
            </div>
          );
        }
        return (
          <button type="button"
            onClick={() => { setEditId(row.id); setDraftKg(String((v as number | null) ?? '')); }}
            className="w-full text-right hover:bg-slate-100 dark:hover:bg-slate-800 rounded px-1 py-0.5"
            title={err || t('quaiLuggage.editHint')}
          >
            {(v as number | null) != null
              ? <span className="tabular-nums">{(v as number).toLocaleString('fr-FR')} kg</span>
              : <span className="text-xs text-slate-400">{t('quaiLuggage.notDeclared')}</span>}
            {err && <span className="block text-[10px] text-red-600 truncate">{err}</span>}
          </button>
        );
      },
    },
    { key: 'status', header: t('quaiLuggage.colStatus'), width: '130px',
      cellRenderer: v => <Badge size="sm" variant={String(v) === 'BOARDED' ? 'success' : 'info'}>{String(v)}</Badge> },
  ];

  return (
    <main className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto" role="main">
      <header className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30 shrink-0">
          <Luggage className="w-5 h-5 text-purple-600 dark:text-purple-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold t-text">{t('quaiLuggage.title')}</h1>
          <p className="text-sm t-text-2 mt-0.5">{t('quaiLuggage.subtitle')}</p>
        </div>
      </header>

      <TripPickerForDay selectedTripId={tripId} onChange={setTripId} />

      <ErrorAlert error={error} icon />

      {!tripId ? (
        <p className="text-sm t-text-3 text-center py-10">{t('quaiLuggage.pickTrip')}</p>
      ) : (
        <>
          {travelers && travelers.length > 0 && (
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="info">{countDeclared}/{travelers.length} {t('quaiLuggage.declaredCount')}</Badge>
              <Badge variant="default">{totalKg.toLocaleString('fr-FR')} kg {t('quaiLuggage.totalWeight')}</Badge>
            </div>
          )}
          <DataTableMaster<Traveler>
            columns={columns}
            data={travelers ?? []}
            loading={loading}
            emptyMessage={t('quaiLuggage.empty')}
            exportFormats={['csv', 'pdf']}
            exportFilename="bagages-quai"
            stickyHeader
          />
          <p className="text-xs t-text-3 italic">{t('quaiLuggage.updateHint')}</p>
        </>
      )}
    </main>
  );
}
