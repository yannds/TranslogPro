/**
 * PageParcelsList — « Suivi colis »
 *
 * Recherche par code de suivi + journal des colis récemment consultés
 * (stockage localStorage). Permet aussi de déclarer un dommage.
 *
 * API :
 *   GET  /api/tenants/:tid/parcels/track/:code      (public tracking)
 *   POST /api/tenants/:tid/parcels/:id/report-damage  body: { description }
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Truck, Search, PackageSearch, AlertOctagon, Clock, MapPin } from 'lucide-react';
import { useAuth }                       from '../../lib/auth/auth.context';
import { useI18n }                        from '../../lib/i18n/useI18n';
import { apiGet, apiPost }               from '../../lib/api';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge, statusToVariant }        from '../ui/Badge';
import { Button }                        from '../ui/Button';
import { Dialog }                        from '../ui/Dialog';
import { ErrorAlert }                    from '../ui/ErrorAlert';
import { FormFooter }                    from '../ui/FormFooter';
import { inputClass as inp }             from '../ui/inputClass';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Parcel {
  id:            string;
  trackingCode:  string;
  status:        string;
  weight:        number;
  price:         number;
  destinationId: string;
  destination?:  { name: string; city: string } | null;
  recipientInfo?: { name?: string; phone?: string; address?: string } | null;
  createdAt?:    string;
  updatedAt?:    string;
}

const HISTORY_KEY = 'translog.parcel.history';
const MAX_HISTORY = 10;

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

function saveHistory(codes: string[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(codes.slice(0, MAX_HISTORY))); } catch { /* ignore */ }
}


// ─── Page ─────────────────────────────────────────────────────────────────────

export function PageParcelsList() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId ?? '';

  const [code,    setCode]    = useState('');
  const [parcel,  setParcel]  = useState<Parcel | null>(null);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);

  const [damageOpen, setDamageOpen] = useState(false);
  const [damageText, setDamageText] = useState('');
  const [damageBusy, setDamageBusy] = useState(false);
  const [damageErr,  setDamageErr]  = useState<string | null>(null);

  useEffect(() => { setHistory(loadHistory()); }, []);

  const doSearch = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(true); setError(null); setParcel(null);
    try {
      const p = await apiGet<Parcel>(`/api/tenants/${tenantId}/parcels/track/${encodeURIComponent(trimmed)}`);
      setParcel(p);
      setCode(trimmed);
      const next = [trimmed, ...history.filter(c => c !== trimmed)].slice(0, MAX_HISTORY);
      setHistory(next); saveHistory(next);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void doSearch(code);
  };

  const handleDamage = async () => {
    if (!parcel) return;
    setDamageBusy(true); setDamageErr(null);
    try {
      await apiPost(`/api/tenants/${tenantId}/parcels/${parcel.id}/report-damage`,
        { description: damageText.trim() });
      setDamageOpen(false); setDamageText('');
      void doSearch(parcel.trackingCode);
    } catch (e) { setDamageErr((e as Error).message); }
    finally { setDamageBusy(false); }
  };

  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('parcelsList.trackParcels')}>
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
          <Truck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('parcelsList.trackParcels')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t('parcelsList.subtitle')}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader heading={t('parcelsList.searchParcel')} />
        <CardContent>
          <form onSubmit={onSubmit} className="flex gap-2">
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              className={inp}
              placeholder="Ex. TENA-MXYZ-AB12"
              disabled={busy}
              aria-label={t('parcelsList.trackingCode')}
            />
            <Button type="submit" disabled={busy || !code.trim()}>
              <Search className="w-4 h-4 mr-1.5" aria-hidden />
              {busy ? t('parcelsList.searching') : t('ui.search')}
            </Button>
          </form>
          <ErrorAlert error={error} icon />

          {history.length > 0 && !parcel && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
                {t('parcelsList.recents')}
              </p>
              <div className="flex flex-wrap gap-2">
                {history.map(h => (
                  <button key={h} type="button"
                    onClick={() => { setCode(h); void doSearch(h); }}
                    className="text-xs px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-600 dark:text-slate-300 tabular-nums">
                    {h}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {parcel && (
        <Card>
          <CardHeader
            heading={parcel.trackingCode}
            description={`Colis ${parcel.id.slice(0, 8)}`}
          />
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <InfoBlock icon={<PackageSearch className="w-4 h-4" />} label={t('parcelsList.status')}>
                <Badge variant={statusToVariant(parcel.status)}>{parcel.status}</Badge>
              </InfoBlock>
              <InfoBlock icon={<MapPin className="w-4 h-4" />} label={t('parcelsList.destination')}>
                {parcel.destination
                  ? `${parcel.destination.name} — ${parcel.destination.city}`
                  : parcel.destinationId}
              </InfoBlock>
              <InfoBlock icon={<Clock className="w-4 h-4" />} label={t('parcelsList.createdOn')}>
                {parcel.createdAt
                  ? new Date(parcel.createdAt).toLocaleString('fr-FR')
                  : '—'}
              </InfoBlock>
              <InfoBlock label={t('parcelsList.weightValue')}>
                <span className="tabular-nums">
                  {parcel.weight} kg · {parcel.price.toLocaleString('fr-FR')} XAF
                </span>
              </InfoBlock>
              {parcel.recipientInfo?.name && (
                <InfoBlock label={t('parcelsList.recipient')} wide>
                  <div className="space-y-0.5">
                    <p>{parcel.recipientInfo.name}</p>
                    {parcel.recipientInfo.phone && (
                      <p className="text-xs text-slate-500 tabular-nums">{parcel.recipientInfo.phone}</p>
                    )}
                    {parcel.recipientInfo.address && (
                      <p className="text-xs text-slate-500">{parcel.recipientInfo.address}</p>
                    )}
                  </div>
                </InfoBlock>
              )}
            </div>

            <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
              <Button variant="outline"
                onClick={() => { setDamageErr(null); setDamageText(''); setDamageOpen(true); }}
                className="text-red-700 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-900 dark:hover:bg-red-900/20">
                <AlertOctagon className="w-4 h-4 mr-1.5" aria-hidden />
                {t('parcelsList.reportDamage')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={damageOpen}
        onOpenChange={o => { if (!o) setDamageOpen(false); }}
        title={t('parcelsList.reportDamage')}
        description={t('parcelsList.damageDialogDesc')}
      >
        <form onSubmit={(e) => { e.preventDefault(); void handleDamage(); }} className="space-y-4">
          <ErrorAlert error={damageErr} />
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('parcelsList.damageDesc')} <span aria-hidden className="text-red-500">*</span>
            </label>
            <textarea required rows={4} value={damageText}
              onChange={e => setDamageText(e.target.value)}
              className={inp} disabled={damageBusy}
              placeholder="Cartonnage écrasé, emballage percé, contenu visible…" />
          </div>
          <FormFooter onCancel={() => setDamageOpen(false)} busy={damageBusy}
            submitLabel={t('parcelsList.report')} pendingLabel={t('parcelsList.sending')} />
        </form>
      </Dialog>
    </main>
  );
}

function InfoBlock({
  icon, label, children, wide,
}: {
  icon?:    React.ReactNode;
  label:    string;
  children: React.ReactNode;
  wide?:    boolean;
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mb-1">
        {icon} {label}
      </p>
      <div className="text-sm text-slate-800 dark:text-slate-200">{children}</div>
    </div>
  );
}
