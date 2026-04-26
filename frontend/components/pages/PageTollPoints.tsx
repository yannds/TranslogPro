/**
 * PageTollPoints — /admin/pricing/toll-points
 *
 * Registre partagé des péages / points de contrôle du tenant. Un péage saisi
 * une fois ici est :
 *   - Réutilisé automatiquement sur toutes les routes qui y passent
 *     (bouton « Détecter les péages » dans l'éditeur de ligne)
 *   - Propagable : éditer le tarif met à jour toutes les routes sans override
 *   - Pré-plaçable sur une route créée dans l'autre sens
 *
 * Permission : `control.route.manage.tenant`.
 */
import { useEffect, useState } from 'react';
import {
  Coins, MapPin, Plus, Pencil, Trash2, AlertTriangle, CheckCircle2,
  Loader2, Shield, Navigation, Download,
} from 'lucide-react';
import { apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { cn } from '../../lib/utils';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Badge } from '../ui/Badge';

type Kind = 'PEAGE' | 'POLICE' | 'DOUANE' | 'EAUX_FORETS' | 'FRONTIERE' | 'AUTRE';
type Direction = 'BOTH' | 'ONE_WAY';

interface TollPoint {
  id:          string;
  name:        string;
  coordinates: { lat: number; lng: number };
  kind:        Kind;
  tollCostXaf: number;
  direction:   Direction;
  notes:       string | null;
  createdAt:   string;
  updatedAt:   string;
}

const KIND_LABELS: Record<Kind, string> = {
  PEAGE:       'Péage',
  POLICE:      'Police',
  DOUANE:      'Douane',
  EAUX_FORETS: 'Eaux & Forêts',
  FRONTIERE:   'Frontière',
  AUTRE:       'Autre',
};

const KIND_ICON: Record<Kind, React.ElementType> = {
  PEAGE:       Coins,
  POLICE:      Shield,
  DOUANE:      Shield,
  EAUX_FORETS: Navigation,
  FRONTIERE:   Navigation,
  AUTRE:       MapPin,
};

export function PageTollPoints() {
  const { user }   = useAuth();
  const { t, lang } = useI18n();
  const tenantId   = user?.tenantId ?? '';
  const base       = `/api/tenants/${tenantId}/toll-points`;

  const [items,   setItems]   = useState<TollPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [msg,     setMsg]     = useState<string | null>(null);

  const [editing, setEditing] = useState<TollPoint | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deleting, setDeleting] = useState<TollPoint | null>(null);
  const [importing, setImporting] = useState(false);

  async function reload() {
    if (!tenantId) return;
    setLoading(true); setError(null);
    try {
      const data = await apiGet<TollPoint[]>(base);
      setItems(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void reload(); }, [tenantId]);

  async function remove(tp: TollPoint) {
    try {
      await apiDelete(`${base}/${tp.id}`);
      setMsg(t('tollPoints.removed').replace('{name}', tp.name));
      setDeleting(null);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /**
   * Import depuis les waypoints existants — remplit le registre à partir
   * des péages/contrôles déjà saisis sur les routes mais non rattachés.
   * Les TollPoint créés ont des coordonnées placeholder (0,0) — l'utilisateur
   * doit les éditer pour activer la détection automatique sur nouvelles routes.
   */
  async function importFromWaypoints() {
    setImporting(true); setError(null); setMsg(null);
    try {
      const res = await apiPost<{ imported: number; backlinked: number; skippedExisting: number }>(
        `${base}/import-from-waypoints`,
        {},
      );
      setMsg(
        t('tollPoints.importSuccess')
          .replace('{imported}', String(res.imported))
          .replace('{backlinked}', String(res.backlinked))
          .replace('{skipped}', String(res.skippedExisting)),
      );
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  const nf = new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'fr-FR');

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-400">
            <Coins className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold t-text">{t('tollPoints.title')}</h1>
            <p className="text-sm t-text-2">{t('tollPoints.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={importFromWaypoints}
            disabled={importing}
            variant="outline"
            className="inline-flex items-center gap-1.5"
            title={t('tollPoints.importHint')}
          >
            {importing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Download className="h-4 w-4" aria-hidden />
            )}
            {t('tollPoints.importFromRoutes')}
          </Button>
          <Button onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1.5">
            <Plus className="h-4 w-4" aria-hidden />
            {t('tollPoints.add')}
          </Button>
        </div>
      </header>

      {msg && (
        <div role="status" className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{msg}</span>
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t('common.loading')}
        </div>
      ) : items.length === 0 ? (
        <EmptyState onAdd={() => setAddOpen(true)} onImport={importFromWaypoints} importing={importing} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {items.map(tp => {
            const Icon = KIND_ICON[tp.kind];
            return (
              <li
                key={tp.id}
                className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              >
                <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{tp.name}</h3>
                    <Badge variant="info" size="sm">{t(`tollPoints.kind_${tp.kind}`)}</Badge>
                    {tp.direction === 'ONE_WAY' && (
                      <Badge variant="warning" size="sm">{t('tollPoints.oneWay')}</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm font-bold text-slate-900 dark:text-white">
                    {nf.format(tp.tollCostXaf)} XAF
                  </p>
                  <p className="mt-0.5 text-xs font-mono text-slate-500 dark:text-slate-400">
                    {tp.coordinates.lat.toFixed(4)}, {tp.coordinates.lng.toFixed(4)}
                  </p>
                  {tp.notes && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{tp.notes}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(tp)}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                  <Button
                    size="sm" variant="ghost"
                    onClick={() => setDeleting(tp)}
                    className="text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {(addOpen || editing) && (
        <TollPointFormDialog
          open
          existing={editing}
          onClose={() => { setAddOpen(false); setEditing(null); }}
          onSaved={() => {
            const name = editing?.name ?? '';
            setMsg(editing ? t('tollPoints.updated').replace('{name}', name) : t('tollPoints.created'));
            setAddOpen(false); setEditing(null);
            void reload();
          }}
          base={base}
          t={t}
        />
      )}

      {deleting && (
        <Dialog open onOpenChange={o => !o && setDeleting(null)} title={t('tollPoints.deleteTitle')}>
          <div className="space-y-4">
            <p className="text-sm text-slate-700 dark:text-slate-300">
              {t('tollPoints.deleteBody').replace('{name}', deleting.name)}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleting(null)}>{t('common.cancel')}</Button>
              <Button variant="destructive" onClick={() => remove(deleting)}>
                <Trash2 className="h-4 w-4 mr-1.5" aria-hidden />
                {t('common.delete')}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

// ─── Formulaire création/édition ─────────────────────────────────────────────

function TollPointFormDialog({
  open, existing, onClose, onSaved, base, t,
}: {
  open:     boolean;
  existing: TollPoint | null;
  onClose:  () => void;
  onSaved:  () => void;
  base:     string;
  t:        (k: string) => string;
}) {
  const [name,        setName]        = useState(existing?.name ?? '');
  const [lat,         setLat]         = useState(existing?.coordinates.lat != null ? String(existing.coordinates.lat) : '');
  const [lng,         setLng]         = useState(existing?.coordinates.lng != null ? String(existing.coordinates.lng) : '');
  const [kind,        setKind]        = useState<Kind>(existing?.kind ?? 'PEAGE');
  const [tollCostXaf, setTollCostXaf] = useState(String(existing?.tollCostXaf ?? ''));
  const [direction,   setDirection]   = useState<Direction>(existing?.direction ?? 'BOTH');
  const [notes,       setNotes]       = useState(existing?.notes ?? '');
  const [busy,        setBusy]        = useState(false);
  const [err,         setErr]         = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    try {
      const body = {
        name: name.trim(),
        coordinates: { lat: Number(lat), lng: Number(lng) },
        kind,
        tollCostXaf: Number(tollCostXaf),
        direction,
        notes: notes.trim() || undefined,
      };
      if (existing) await apiPatch(`${base}/${existing.id}`, body);
      else          await apiPost(base, body);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const inp = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800';

  return (
    <Dialog
      open={open} onOpenChange={o => !o && onClose()}
      title={existing ? t('tollPoints.editTitle') : t('tollPoints.addTitle')}
      size="md"
    >
      <div className="space-y-3">
        {err && (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{err}</span>
          </div>
        )}
        <div>
          <label className="text-xs font-medium">{t('tollPoints.fieldName')}</label>
          <input value={name} onChange={e => setName(e.target.value)} className={inp} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium">{t('tollPoints.fieldLat')}</label>
            <input type="number" step="0.000001" value={lat} onChange={e => setLat(e.target.value)} className={inp} />
          </div>
          <div>
            <label className="text-xs font-medium">{t('tollPoints.fieldLng')}</label>
            <input type="number" step="0.000001" value={lng} onChange={e => setLng(e.target.value)} className={inp} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium">{t('tollPoints.fieldKind')}</label>
            <select value={kind} onChange={e => setKind(e.target.value as Kind)} className={inp}>
              {(Object.keys(KIND_LABELS) as Kind[]).map(k => (
                <option key={k} value={k}>{t(`tollPoints.kind_${k}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium">{t('tollPoints.fieldDirection')}</label>
            <select value={direction} onChange={e => setDirection(e.target.value as Direction)} className={inp}>
              <option value="BOTH">{t('tollPoints.directionBoth')}</option>
              <option value="ONE_WAY">{t('tollPoints.directionOneWay')}</option>
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium">{t('tollPoints.fieldTollCost')}</label>
          <input type="number" min={0} value={tollCostXaf} onChange={e => setTollCostXaf(e.target.value)} className={inp} />
        </div>
        <div>
          <label className="text-xs font-medium">{t('tollPoints.fieldNotes')}</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={cn(inp, 'resize-none')} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button onClick={submit} disabled={busy || !name || !lat || !lng || !tollCostXaf}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" aria-hidden /> : null}
            {t('common.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function EmptyState({
  onAdd, onImport, importing,
}: {
  onAdd:     () => void;
  onImport:  () => void;
  importing: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center dark:border-slate-700 dark:bg-slate-900/50">
      <Coins className="h-10 w-10 text-slate-400" aria-hidden />
      <div>
        <h2 className="text-lg font-semibold t-text">{t('tollPoints.emptyTitle')}</h2>
        <p className="mt-1 text-sm t-text-2">{t('tollPoints.emptyBody')}</p>
        <p className="mt-2 text-xs t-text-2 italic">{t('tollPoints.emptyImportHint')}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={onImport} disabled={importing}>
          {importing ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden />
          ) : (
            <Download className="h-4 w-4 mr-1.5" aria-hidden />
          )}
          {t('tollPoints.importFromRoutes')}
        </Button>
        <Button onClick={onAdd}>
          <Plus className="h-4 w-4 mr-1.5" aria-hidden />
          {t('tollPoints.add')}
        </Button>
      </div>
    </div>
  );
}
