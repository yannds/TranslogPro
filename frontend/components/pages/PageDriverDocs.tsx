/**
 * PageDriverDocs — « Mes documents » (portail chauffeur)
 *
 * Affiche les permis/licences du chauffeur (via DriverLicensePanel en readOnly)
 * ET ses pièces jointes (contrats, pièces d'identité, certificats, etc.)
 * via DocumentAttachments.
 */

import { FileText } from 'lucide-react';
import { useAuth }    from '../../lib/auth/auth.context';
import { useI18n }    from '../../lib/i18n/useI18n';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { DocumentAttachments } from '../document/DocumentAttachments';
import { DriverLicensePanel } from '../drivers/DriverLicensePanel';

export function PageDriverDocs() {
  const { t } = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const staffId  = user?.staffId  ?? '';

  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('driverDocs.pageTitle')}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
          <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('driverDocs.pageTitle')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {t('driverDocs.pageSubtitle')}
          </p>
        </div>
      </div>

      {/* Licenses (source unique — readOnly pour le portail chauffeur) */}
      {tenantId && staffId && (
        <Card>
          <CardHeader
            heading={t('driverDocs.licensesTitle')}
            description={t('driverDocs.licensesDesc')}
          />
          <CardContent>
            <DriverLicensePanel
              tenantId={tenantId}
              staffId={staffId}
              readOnly
            />
          </CardContent>
        </Card>
      )}

      {/* All documents (contracts, ID, certificates, photos — hors permis) */}
      {staffId && (
        <Card>
          <CardHeader
            heading={t('driverDocs.attachmentsTitle')}
            description={t('driverDocs.attachmentsDesc')}
          />
          <CardContent>
            <DocumentAttachments
              tenantId={tenantId}
              entityType="STAFF"
              entityId={staffId}
              readOnly
            />
          </CardContent>
        </Card>
      )}
    </main>
  );
}
