/**
 * CrmPhoneHint — Affiche un hint CRM quand le phone saisi matche un Customer.
 *
 * Appelle GET /api/tenants/:tid/crm/lookup?phone=XYZ (debounce 500ms).
 * Silencieux si pas de match ou si phone invalide.
 *
 * Usage :
 *   <CrmPhoneHint tenantId={tid} phone={value} />
 *
 * Contrat :
 *   - i18n 8 locales (clés `crmHint.*`)
 *   - WCAG : role=status, aria-live polite
 *   - Dark + light compatible
 */

import { useEffect, useState } from 'react';
import { Sparkles, User } from 'lucide-react';
import { apiGet } from '../../lib/api';
import { useI18n } from '../../lib/i18n/useI18n';
import { Badge } from '../ui/Badge';

interface Recommendation {
  customerId:       string;
  totalTickets:     number;
  totalParcels:     number;
  isRecurrent:      boolean;
  topSeat:          string | null;
  topFareClass:     string | null;
  topBoardingId:    string | null;
  topAlightingId:   string | null;
  topDestinationId: string | null;
  language:         string | null;
  segments:         string[];
}

export function CrmPhoneHint({ tenantId, phone }: { tenantId: string; phone: string }) {
  const { t } = useI18n();
  const [data, setData] = useState<Recommendation | null>(null);

  useEffect(() => {
    const trimmed = phone.trim();
    if (!tenantId || trimmed.length < 6) { setData(null); return; }

    // Debounce 500ms — évite un fetch à chaque frappe
    const timer = setTimeout(() => {
      apiGet<Recommendation | null>(`/api/tenants/${tenantId}/crm/lookup?phone=${encodeURIComponent(trimmed)}`, { skipRedirectOn401: true })
        .then(res => setData(res ?? null))
        .catch(() => setData(null));
    }, 500);
    return () => clearTimeout(timer);
  }, [tenantId, phone]);

  if (!data) return null;

  const hints: string[] = [];
  if (data.topSeat)       hints.push(t('crmHint.prefersSeat') + ' ' + data.topSeat);
  if (data.topFareClass)  hints.push(t('crmHint.usuallyFare') + ' ' + data.topFareClass);

  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-1 flex flex-wrap items-center gap-2 text-xs text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-md px-2 py-1"
    >
      <User className="w-3 h-3 shrink-0" aria-hidden />
      <span className="font-medium">
        {data.isRecurrent ? t('crmHint.recurrent') : t('crmHint.known')}
      </span>
      <Badge variant="info">
        {data.totalTickets} {t('crmHint.tickets')}
      </Badge>
      {data.totalParcels > 0 && (
        <Badge variant="default">
          {data.totalParcels} {t('crmHint.parcels')}
        </Badge>
      )}
      {data.segments?.map(s => (
        <Badge key={s} variant="warning">{s}</Badge>
      ))}
      {hints.length > 0 && (
        <span className="inline-flex items-center gap-1">
          <Sparkles className="w-3 h-3" aria-hidden />
          {hints.join(' · ')}
        </span>
      )}
    </div>
  );
}

export default CrmPhoneHint;
