/**
 * PageFleetSeats — « Plans de sièges »
 *
 * Éditeur du seatLayout (JSON) de chaque bus : grille rows × cols, allée
 * optionnelle après une colonne, sièges désactivés (moteur, roue, porte…).
 * PRD §IV.3 — seatLayout obligatoire avant toute vente numérotée.
 *
 * API :
 *   GET   /api/tenants/:tid/fleet/buses
 *   PATCH /api/tenants/:tid/fleet/buses/:id/seat-layout   body: { seatLayout }
 */

import { useEffect, useMemo, useState } from 'react';
import { Grid3x3, Save, Bus, LayoutGrid } from 'lucide-react';
import { useAuth }                       from '../../lib/auth/auth.context';
import { useFetch }                      from '../../lib/hooks/useFetch';
import { apiPatch }                      from '../../lib/api';
import { useI18n }                   from '../../lib/i18n/useI18n';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge }                         from '../ui/Badge';
import { Skeleton }                      from '../ui/Skeleton';
import { Button }                        from '../ui/Button';
import { ErrorAlert }                    from '../ui/ErrorAlert';
import { inputClass as inp }             from '../ui/inputClass';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BusRow {
  id:          string;
  plateNumber: string;
  model?:      string | null;
  capacity:    number;
  seatLayout?: SeatLayout | null;
}

interface SeatLayout {
  rows:        number;
  cols:        number;
  aisleAfter?: number;        // numéro de colonne (1-indexed) après laquelle insérer une allée
  disabled?:   string[];      // ex. ["2-1","5-4"] pour (row-col)
}

const DEFAULT_LAYOUT: SeatLayout = { rows: 10, cols: 4, aisleAfter: 2, disabled: [] };

function cellId(r: number, c: number) { return `${r}-${c}`; }

function computeSeatCount(l: SeatLayout): number {
  return (l.rows * l.cols) - (l.disabled?.length ?? 0);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PageFleetSeats() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/tenants/${tenantId}/fleet/buses`;

  const { data: buses, loading, error, refetch } = useFetch<BusRow[]>(
    tenantId ? base : null, [tenantId],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layout,     setLayout]     = useState<SeatLayout>(DEFAULT_LAYOUT);
  const [busy,       setBusy]       = useState(false);
  const [saveErr,    setSaveErr]    = useState<string | null>(null);
  const [saved,      setSaved]      = useState(false);

  const selected = useMemo(
    () => buses?.find(b => b.id === selectedId) ?? null,
    [buses, selectedId],
  );

  useEffect(() => {
    if (!selected) return;
    setSaved(false); setSaveErr(null);
    setLayout(
      (selected.seatLayout && typeof selected.seatLayout === 'object')
        ? (selected.seatLayout as SeatLayout)
        : { ...DEFAULT_LAYOUT, rows: Math.max(5, Math.ceil(selected.capacity / 4)) },
    );
  }, [selected]);

  useEffect(() => {
    if (!selectedId && buses && buses.length > 0) setSelectedId(buses[0].id);
  }, [buses, selectedId]);

  const toggleCell = (r: number, c: number) => {
    const id = cellId(r, c);
    const current = new Set(layout.disabled ?? []);
    if (current.has(id)) current.delete(id); else current.add(id);
    setLayout({ ...layout, disabled: Array.from(current) });
    setSaved(false);
  };

  const handleSave = async () => {
    if (!selected) return;
    setBusy(true); setSaveErr(null); setSaved(false);
    try {
      await apiPatch(`${base}/${selected.id}/seat-layout`, { seatLayout: layout });
      setSaved(true); refetch();
    } catch (e) { setSaveErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const seatCount = computeSeatCount(layout);

  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('LFleetSeats.pageTitle')}>
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
          <Grid3x3 className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('LFleetSeats.pageTitle')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t('LFleetSeats.pageSubtitle')}
          </p>
        </div>
      </div>

      <ErrorAlert error={error} icon />

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        {/* Sélecteur de bus */}
        <Card>
          <CardHeader heading={t('LFleetSeats.vehicles')} description={t('LFleetSeats.selectBus')} />
          <CardContent className="p-0">
            {loading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : !buses || buses.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500">{t('LFleetSeats.noVehicle')}</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {buses.map(b => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(b.id)}
                      className={`w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50
                        ${selectedId === b.id ? 'bg-teal-50/60 dark:bg-teal-900/10' : ''}`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate flex items-center gap-2">
                          <Bus className="w-4 h-4 text-teal-500" aria-hidden />
                          {b.plateNumber}
                        </p>
                        <p className="text-xs text-slate-500 truncate">{b.model || '—'} · {b.capacity} {t('LFleetSeats.seats')}</p>
                      </div>
                      {b.seatLayout
                        ? <Badge variant="success" size="sm">{t('LFleetSeats.seatOk')}</Badge>
                        : <Badge variant="warning" size="sm">{t('LFleetSeats.seatTodo')}</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Éditeur */}
        <Card>
          <CardHeader
            heading={selected ? `Plan — ${selected.plateNumber}` : t('LFleetSeats.selectABus')}
            description={
              selected
                ? `${seatCount} ${t('LFleetSeats.seats')} ${t('LFleetSeats.activeSeats')} / ${t('LFleetSeats.declaredCapacity')} ${selected.capacity}`
                : undefined
            }
          />
          <CardContent>
            {!selected ? (
              <p className="text-sm text-slate-500">{t('LFleetSeats.noVehicleSelected')}</p>
            ) : (
              <div className="space-y-4">
                <ErrorAlert error={saveErr} />
                {saved && (
                  <div className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md px-3 py-2">
                    {t('LFleetSeats.planSaved')}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">{t('LFleetSeats.rows')}</label>
                    <input type="number" min={1} max={30} value={layout.rows}
                      onChange={e => setLayout({ ...layout, rows: Math.max(1, Number(e.target.value)) })}
                      className={inp} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">{t('LFleetSeats.columns')}</label>
                    <input type="number" min={1} max={8} value={layout.cols}
                      onChange={e => setLayout({ ...layout, cols: Math.max(1, Number(e.target.value)) })}
                      className={inp} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">{t('LFleetSeats.aisleAfterCol')}</label>
                    <input type="number" min={0} max={layout.cols} value={layout.aisleAfter ?? 0}
                      onChange={e => setLayout({ ...layout, aisleAfter: Number(e.target.value) || undefined })}
                      className={inp} />
                  </div>
                </div>

                <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <LayoutGrid className="w-3.5 h-3.5" aria-hidden />
                  {t('LFleetSeats.clickHint')}
                </p>

                {/* Grille */}
                <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-lg p-4 overflow-x-auto">
                  <div className="inline-block">
                    <div className="flex justify-center mb-3 text-xs text-slate-500">
                      ← {t('LFleetSeats.frontOfVehicle')}
                    </div>
                    <div className="space-y-1.5">
                      {Array.from({ length: layout.rows }).map((_, rIdx) => {
                        const r = rIdx + 1;
                        return (
                          <div key={r} className="flex items-center gap-1.5">
                            <span className="w-6 text-right text-[10px] text-slate-400 tabular-nums">{r}</span>
                            {Array.from({ length: layout.cols }).map((_, cIdx) => {
                              const c = cIdx + 1;
                              const id = cellId(r, c);
                              const disabled = (layout.disabled ?? []).includes(id);
                              return (
                                <div key={c} className="flex items-center">
                                  <button
                                    type="button"
                                    onClick={() => toggleCell(r, c)}
                                    aria-label={`${t('LFleetSeats.seats')} ${id} ${disabled ? t('LFleetSeats.seatDisabled') : t('LFleetSeats.seatActive')}`}
                                    className={`w-8 h-8 text-[10px] rounded border transition-colors
                                      ${disabled
                                        ? 'bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-400 line-through'
                                        : 'bg-teal-500 hover:bg-teal-400 border-teal-600 text-white font-semibold'}`}
                                  >
                                    {disabled ? '×' : id}
                                  </button>
                                  {layout.aisleAfter === c && c < layout.cols && (
                                    <div className="w-3" aria-hidden />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2">
                  <Button onClick={handleSave} disabled={busy} loading={busy}>
                    <Save className="w-4 h-4 mr-1.5" aria-hidden />
                    {busy ? t('common.saving') : t('LFleetSeats.savePlan')}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
