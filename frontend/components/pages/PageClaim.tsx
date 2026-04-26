/**
 * PageClaim — Page publique de revendication "magic link" CRM.
 *
 * Flow :
 *   1. L'utilisateur arrive via /claim?token=XYZ (lien SMS/WhatsApp/Email).
 *   2. Preview : POST /api/crm/claim/preview → infos masquées (prénom, compteurs).
 *   3. Formulaire de création de compte → à brancher au flow signup existant
 *      (laissé en pending via UI stub tant que le hook signup dédié n'est pas
 *      prêt dans ce batch).
 *   4. Confirmation : POST /api/crm/claim/complete avec le userId de l'User
 *      fraîchement créé → lie Customer ↔ User et redirige /customer.
 *
 * Contrat UI :
 *   - i18n 8 locales (clés `claim.*`)
 *   - WCAG AA : labels, aria-live, focus visible, dark+light
 *   - Responsive (mobile-first, centré sur desktop)
 *   - Pas d'accès auth requis
 */

import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Ticket, Package, Clock, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useI18n } from '../../lib/i18n/useI18n';
import { apiPost } from '../../lib/api';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';

interface PreviewPayload {
  firstName:    string;
  ticketsCount: number;
  parcelsCount: number;
  expiresAt:    string;
  channel:      'MAGIC_EMAIL' | 'MAGIC_WHATSAPP' | 'MAGIC_SMS';
  phoneMasked?: string;
  emailMasked?: string;
}

export function PageClaim() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');

  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || token.length < 32) {
      setError(t('claim.errorInvalidToken'));
      setLoading(false);
      return;
    }
    apiPost<PreviewPayload>('/api/crm/claim/preview', { token })
      .then(setPreview)
      .catch(e => setError((e as Error).message ?? t('claim.errorPreview')))
      .finally(() => setLoading(false));
  }, [token, t]);

  // Formatage expiresAt → "J-N" lisible
  const daysLeft = preview
    ? Math.max(0, Math.ceil((new Date(preview.expiresAt).getTime() - Date.now()) / (24 * 3600_000)))
    : 0;

  return (
    <main
      role="main"
      aria-labelledby="claim-title"
      className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4"
    >
      <Card className="w-full max-w-xl">
        <CardHeader
          heading={
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" aria-hidden />
              <span id="claim-title">{t('claim.title')}</span>
            </div>
          }
          description={t('claim.subtitle')}
        />
        <CardContent className="space-y-5">
          {loading && (
            <p className="text-sm text-slate-500 dark:text-slate-400" aria-live="polite">
              {t('claim.loading')}
            </p>
          )}

          {error && !loading && (
            <div
              role="alert"
              className="flex items-start gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          {preview && !error && (
            <>
              <div className="space-y-2">
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  {t('claim.greeting').replace('{{name}}', preview.firstName || '—')}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {preview.phoneMasked && `${t('claim.linkedPhone')} ${preview.phoneMasked}`}
                  {preview.emailMasked && ` · ${t('claim.linkedEmail')} ${preview.emailMasked}`}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <StatCard icon={<Ticket className="w-4 h-4" aria-hidden />}
                  value={preview.ticketsCount} label={t('claim.tickets')} />
                <StatCard icon={<Package className="w-4 h-4" aria-hidden />}
                  value={preview.parcelsCount} label={t('claim.parcels')} />
                <StatCard icon={<Clock className="w-4 h-4" aria-hidden />}
                  value={daysLeft} label={t('claim.daysLeft')} />
              </div>

              <Badge variant={daysLeft <= 3 ? 'warning' : 'info'}>
                {t('claim.expiresOn').replace('{{date}}', new Date(preview.expiresAt).toLocaleDateString())}
              </Badge>

              <div className="border-t border-slate-200 dark:border-slate-700 pt-5 space-y-3">
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  {t('claim.ctaDescription')}
                </p>
                <Button
                  className="w-full"
                  onClick={() => navigate(`/login?claimToken=${encodeURIComponent(token ?? '')}`)}
                >
                  {t('claim.ctaSignup')}
                </Button>
                <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
                  {t('claim.disclaimer')}
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function StatCard({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="p-3 rounded-lg bg-slate-100 dark:bg-slate-800 text-center">
      <div className="flex items-center justify-center text-slate-500 dark:text-slate-400 mb-1">
        {icon}
      </div>
      <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{value}</div>
      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{label}</div>
    </div>
  );
}

export default PageClaim;
