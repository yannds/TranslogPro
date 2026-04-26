/**
 * StationFormDialog — modale unique pour créer ou éditer une station.
 *
 * Refonte 2026-04-26 :
 *   - Carte Google Maps (au lieu de Leaflet/OSM) via `GoogleMapPicker`
 *     → tuiles Google + Places Autocomplete + reverse geocode natif.
 *   - Combobox ville `CityCombobox` qui fixe le bug du clic souris (le
 *     dropdown reste dans le wrapper, plus de portail au document.body).
 *   - Plus de bouton « Re-calibrer » : Google donne directement la coordonnée
 *     précise, plus besoin du fallback backend Nominatim.
 *   - Aucune dépendance à l'ancien `StationForm`/`LocationPicker`/
 *     `ComboboxEditable` qui restent en place pour les autres pages.
 *
 * UX/Tech :
 *   - Mode `'create' | 'edit'` géré par prop, un seul composant rendu.
 *   - Responsive : grid 1 col mobile, 2 cols ≥ sm pour les paires de champs.
 *   - Dark mode + WCAG AA + ARIA propre (labels, role=dialog hérité de Dialog).
 *   - Réutilise Dialog, Button, FormFooter, ErrorAlert, Badge, inputClass.
 *   - Si la clé Google JS n'est pas encore configurée → fallback champs lat/lng,
 *     zéro régression : la station reste créable manuellement.
 */
import { useState, useCallback, type FormEvent } from 'react';
import { useI18n } from '../../../lib/i18n/useI18n';
import { apiGet } from '../../../lib/api';
import { Dialog } from '../../ui/Dialog';
import { ErrorAlert } from '../../ui/ErrorAlert';
import { FormFooter } from '../../ui/FormFooter';
import { inputClass as inp } from '../../ui/inputClass';
import { CityCombobox, type CityOption } from '../../ui/CityCombobox';
import { GoogleMapPicker } from '../../ui/MapPicker/GoogleMapPicker';

export type StationType = 'PRINCIPALE' | 'RELAIS';

export interface StationDialogValues {
  name: string;
  city: string;
  type: StationType;
  lat:  string;
  lng:  string;
}

export const EMPTY_STATION: StationDialogValues = {
  name: '', city: '', type: 'PRINCIPALE', lat: '', lng: '',
};

interface GeoResult { displayName: string; lat: number; lng: number; countryCode: string }
interface GeoResponse { results: GeoResult[] }

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(
    ...code.toUpperCase().split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65),
  );
}

interface Props {
  open:      boolean;
  mode:      'create' | 'edit';
  tenantId:  string;
  /** Nom à afficher dans la description du Dialog (mode edit). */
  stationName?: string;
  initial:   StationDialogValues;
  onSubmit:  (values: StationDialogValues) => void | Promise<void>;
  onClose:   () => void;
  busy:      boolean;
  error:     string | null;
}

export function StationFormDialog({
  open, mode, tenantId, stationName, initial, onSubmit, onClose, busy, error,
}: Props) {
  const { t } = useI18n();
  const [f, setF] = useState<StationDialogValues>(initial);

  // Re-sync quand on ouvre/change la cible
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reset = useCallback(() => setF(initial), [JSON.stringify(initial)]);
  useResetOnOpen(open, reset);

  const patch = (p: Partial<StationDialogValues>) =>
    setF(prev => ({ ...prev, ...p }));

  // ── Recherche Ville (backend /geo/search avec drapeau pays) ────────────────
  const searchCity = useCallback(async (q: string): Promise<CityOption[]> => {
    const data = await apiGet<GeoResponse>(
      `/api/tenants/${tenantId}/geo/search?q=${encodeURIComponent(q)}`,
    );
    return (data.results ?? []).map(r => {
      const head = r.displayName.split(',')[0].trim();
      const tail = r.displayName.split(',').slice(1).join(',').trim();
      return {
        value: head,
        label: head,
        hint:  tail,
        flag:  countryFlag(r.countryCode),
      };
    });
  }, [tenantId]);

  // ── Soumission ──────────────────────────────────────────────────────────
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void onSubmit(f);
  };

  const title = mode === 'create' ? t('stations.newStation') : t('stations.editStation');
  const desc  = mode === 'create' ? t('stations.dialogNewDesc') : (stationName ?? '');

  return (
    <Dialog
      open={open}
      onOpenChange={o => { if (!o) onClose(); }}
      title={title}
      description={desc}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <ErrorAlert error={error} />

        {/* Nom de la station */}
        <div className="space-y-1.5">
          <label htmlFor="station-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('stations.stationName')} <span aria-hidden className="text-red-500">*</span>
          </label>
          <input
            id="station-name"
            type="text"
            required
            value={f.name}
            onChange={e => patch({ name: e.target.value })}
            className={inp}
            disabled={busy}
            placeholder={t('stations.placeholderName')}
            autoComplete="off"
          />
        </div>

        {/* Ville + Type — grid 2 cols ≥ sm */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <CityCombobox
            id="station-city"
            label={t('stations.city')}
            value={f.city}
            onChange={v => patch({ city: v })}
            onSearch={searchCity}
            freeTextWarning={t('stations.cityFreeTextWarning')}
            placeholder={t('stations.placeholderCity')}
            disabled={busy}
            required
          />
          <div className="space-y-1.5">
            <label htmlFor="station-type" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('common.type')} <span aria-hidden className="text-red-500">*</span>
            </label>
            <select
              id="station-type"
              required
              value={f.type}
              onChange={e => patch({ type: e.target.value as StationType })}
              className={inp}
              disabled={busy}
            >
              <option value="PRINCIPALE">{t('stations.typePrincipale')}</option>
              <option value="RELAIS">{t('stations.typeRelais')}</option>
            </select>
          </div>
        </div>

        {/* Carte Google + recherche d'adresse + champs lat/lng */}
        <GoogleMapPicker
          tenantId={tenantId}
          value={{ lat: f.lat, lng: f.lng }}
          onChange={v => patch({ lat: v.lat, lng: v.lng })}
          disabled={busy}
        />

        <FormFooter
          onCancel={onClose}
          busy={busy}
          submitLabel={mode === 'create' ? t('common.create') : t('common.save')}
          pendingLabel={mode === 'create' ? t('common.creating') : t('common.saving')}
        />
      </form>
    </Dialog>
  );
}

/** Réinitialise l'état local quand la modale s'ouvre. */
import { useEffect } from 'react';
function useResetOnOpen(open: boolean, reset: () => void) {
  useEffect(() => { if (open) reset(); }, [open, reset]);
}
