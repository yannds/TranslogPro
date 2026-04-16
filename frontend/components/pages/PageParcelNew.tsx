/**
 * PageParcelNew — « Enregistrer un colis »
 *
 * Formulaire plein écran pour enregistrer un nouveau colis (agent de gare).
 * Sur succès, affiche le code de suivi + bouton « Nouveau colis ».
 *
 * API :
 *   GET  /api/tenants/:tid/stations
 *   POST /api/tenants/:tid/parcels          body: CreateParcelDto
 */

import { useState, type FormEvent } from 'react';
import { PackagePlus, PackageCheck, Copy, Plus } from 'lucide-react';
import { useAuth }                       from '../../lib/auth/auth.context';
import { useFetch }                      from '../../lib/hooks/useFetch';
import { apiPost }                       from '../../lib/api';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge }                         from '../ui/Badge';
import { Button }                        from '../ui/Button';
import { ErrorAlert }                    from '../ui/ErrorAlert';
import { FormFooter }                    from '../ui/FormFooter';
import { inputClass as inp }             from '../ui/inputClass';

interface StationRow {
  id:   string;
  name: string;
  city: string;
}

interface ParcelCreated {
  id:           string;
  trackingCode: string;
}

interface FormValues {
  recipientName:  string;
  recipientPhone: string;
  address:        string;
  destinationId:  string;
  weightKg:       string;
  declaredValue:  string;
}

const EMPTY_FORM: FormValues = {
  recipientName: '', recipientPhone: '', address: '',
  destinationId: '', weightKg: '', declaredValue: '',
};

export function PageParcelNew() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const { data: stations } = useFetch<StationRow[]>(
    tenantId ? `/api/tenants/${tenantId}/stations` : null, [tenantId],
  );

  const [f, setF]                 = useState<FormValues>(EMPTY_FORM);
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [created, setCreated]     = useState<ParcelCreated | null>(null);
  const [copied, setCopied]       = useState(false);

  const patch = (p: Partial<FormValues>) => setF(prev => ({ ...prev, ...p }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const parcel = await apiPost<ParcelCreated>(`/api/tenants/${tenantId}/parcels`, {
        recipientName:  f.recipientName.trim(),
        recipientPhone: f.recipientPhone.trim(),
        address:        f.address.trim() || undefined,
        destinationId:  f.destinationId,
        weightKg:       Number(f.weightKg),
        declaredValue:  f.declaredValue ? Number(f.declaredValue) : undefined,
      });
      setCreated(parcel);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const reset = () => {
    setCreated(null); setF(EMPTY_FORM); setError(null); setCopied(false);
  };

  const copyCode = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.trackingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <main className="p-6 space-y-6 max-w-3xl mx-auto" role="main" aria-label="Enregistrer un colis">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
          <PackagePlus className="w-5 h-5 text-indigo-600 dark:text-indigo-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Enregistrer un colis</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Un code de suivi unique est émis à la création.
          </p>
        </div>
      </div>

      {created ? (
        <Card>
          <CardHeader heading="Colis enregistré" description="Transmettez le code au destinataire." />
          <CardContent className="space-y-5">
            <div className="flex flex-col items-center text-center gap-3 py-4">
              <div className="p-3 rounded-full bg-green-100 dark:bg-green-900/30">
                <PackageCheck className="w-8 h-8 text-green-600 dark:text-green-400" aria-hidden />
              </div>
              <Badge variant="success">Créé</Badge>
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Code de suivi</p>
                <p className="text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-50">
                  {created.trackingCode}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={copyCode}>
                <Copy className="w-3.5 h-3.5 mr-1.5" aria-hidden />
                {copied ? 'Copié !' : 'Copier le code'}
              </Button>
            </div>
            <div className="flex justify-end">
              <Button onClick={reset}>
                <Plus className="w-4 h-4 mr-1.5" aria-hidden />
                Nouveau colis
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader heading="Informations du colis" />
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <ErrorAlert error={error} />

              <fieldset className="space-y-4">
                <legend className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
                  Destinataire
                </legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                      Nom <span aria-hidden className="text-red-500">*</span>
                    </label>
                    <input type="text" required value={f.recipientName}
                      onChange={e => patch({ recipientName: e.target.value })}
                      className={inp} disabled={busy} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                      Téléphone <span aria-hidden className="text-red-500">*</span>
                    </label>
                    <input type="tel" required value={f.recipientPhone}
                      onChange={e => patch({ recipientPhone: e.target.value })}
                      className={inp} disabled={busy} placeholder="+242 06 000 00 00" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Adresse de livraison
                  </label>
                  <input type="text" value={f.address}
                    onChange={e => patch({ address: e.target.value })}
                    className={inp} disabled={busy}
                    placeholder="Quartier, rue, point de repère…" />
                </div>
              </fieldset>

              <fieldset className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                <legend className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
                  Expédition
                </legend>
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                    Gare de destination <span aria-hidden className="text-red-500">*</span>
                  </label>
                  <select required value={f.destinationId}
                    onChange={e => patch({ destinationId: e.target.value })}
                    className={inp} disabled={busy}>
                    <option value="">— Sélectionner —</option>
                    {(stations ?? []).map(s => (
                      <option key={s.id} value={s.id}>{s.name} — {s.city}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                      Poids (kg) <span aria-hidden className="text-red-500">*</span>
                    </label>
                    <input type="number" step="0.01" min={0} required value={f.weightKg}
                      onChange={e => patch({ weightKg: e.target.value })}
                      className={inp} disabled={busy} placeholder="5.0" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                      Valeur déclarée (XAF)
                    </label>
                    <input type="number" min={0} value={f.declaredValue}
                      onChange={e => patch({ declaredValue: e.target.value })}
                      className={inp} disabled={busy} placeholder="Optionnel" />
                  </div>
                </div>
              </fieldset>

              <FormFooter onCancel={() => setF(EMPTY_FORM)} busy={busy}
                submitLabel="Enregistrer le colis" pendingLabel="Enregistrement…"
                cancelLabel="Vider" />
            </form>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
