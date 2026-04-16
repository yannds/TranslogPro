/**
 * PageTemplateStudio — Studio de modèles de documents (factures, billets, talons, manifestes, étiquettes)
 *
 * Wrapper qui branche la bibliothèque de templates + le designer PDFME sur l'auth du tenant courant.
 * Backend : src/modules/templates (TemplatesController — /api/tenants/:tenantId/templates)
 */
import { FileText } from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { TemplateLibraryPage } from '../document/template-designer/TemplateLibraryPage';

export function PageTemplateStudio() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId;

  if (!tenantId) {
    return (
      <div className="p-8 text-center t-text-2 text-sm">
        {t('templateStudio.noSession')}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* En-tête cohérent avec les autres pages du dashboard */}
      <header className="flex items-center gap-3 px-6 pt-6 pb-4 border-b t-border">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center">
          <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold t-text">{t('templateStudio.title')}</h1>
          <p className="t-text-2 text-sm mt-0.5">
            {t('templateStudio.subtitle')}
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <TemplateLibraryPage tenantId={tenantId} apiBase="/api" />
      </div>
    </div>
  );
}
