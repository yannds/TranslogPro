/**
 * TemplateLibraryPage — Page de gestion des templates d'impression du tenant
 *
 * Deux vues :
 *   1. "Bibliothèque" — templates système (bases de départ) + templates tenant
 *   2. "Designer" — éditeur pdfme plein écran pour un template donné
 *
 * Actions disponibles :
 *   - Dupliquer un template système → crée une copie personnalisable pour le tenant
 *   - Éditer un template tenant → ouvre le Designer
 *   - Supprimer un template tenant (soft delete)
 *
 * GET /tenants/:tenantId/templates/system  → templates système
 * GET /tenants/:tenantId/templates         → templates tenant
 * POST /tenants/:tenantId/templates/:id/duplicate
 * DELETE /tenants/:tenantId/templates/:id
 */
import { useState, useEffect, useCallback } from 'react';
import { TemplateDesigner } from './TemplateDesigner';
import { useTheme } from '../../theme/ThemeProvider';
import { useI18n } from '../../../lib/i18n/useI18n';

// ─── Palette dépendante du thème ─────────────────────────────────────────────
const lightPalette = {
  surface:        '#fff',
  surfaceMuted:   '#f9fafb',
  surfaceOwned:   '#f5f3ff',
  surfaceDanger:  '#fef2f2',
  surfaceBadge:   '#f3f4f6',
  surfaceBlue:    '#dbeafe',
  border:         '#e5e7eb',
  borderStrong:   '#d1d5db',
  borderOwned:    '#c7d2fe',
  borderDanger:   '#fca5a5',
  textPrimary:    '#111827',
  textHeading:    '#1a3a5c',
  textBody:       '#374151',
  textMuted:      '#6b7280',
  textFaint:      '#9ca3af',
  textDanger:     '#dc2626',
  badgeBlueText:  '#1d4ed8',
  primary:        '#1a3a5c',
  primaryMuted:   '#93c5fd',
  primaryOnDark:  '#fff',
  disabledBg:     '#e5e7eb',
  disabledText:   '#9ca3af',
};
const darkPalette: typeof lightPalette = {
  surface:        '#1e293b', // slate-800
  surfaceMuted:   '#0f172a', // slate-950
  surfaceOwned:   '#312e81', // indigo-900
  surfaceDanger:  '#450a0a', // red-950
  surfaceBadge:   '#334155', // slate-700
  surfaceBlue:    '#1e3a8a', // blue-900
  border:         '#334155',
  borderStrong:   '#475569', // slate-600
  borderOwned:    '#4338ca', // indigo-700
  borderDanger:   '#7f1d1d', // red-900
  textPrimary:    '#f1f5f9', // slate-100
  textHeading:    '#e2e8f0', // slate-200
  textBody:       '#cbd5e1', // slate-300
  textMuted:      '#94a3b8', // slate-400
  textFaint:      '#64748b', // slate-500
  textDanger:     '#f87171', // red-400
  badgeBlueText:  '#93c5fd', // blue-300
  primary:        '#3b82f6', // blue-500
  primaryMuted:   '#1e3a8a',
  primaryOnDark:  '#fff',
  disabledBg:     '#334155',
  disabledText:   '#64748b',
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface DocTemplate {
  id:         string;
  name:       string;
  slug:       string;
  docType:    string;
  format:     string;
  engine:     string;
  version:    number;
  isSystem:   boolean;
  isActive:   boolean;
  createdAt:  string;
}

interface TemplateLibraryPageProps {
  tenantId: string;
  apiBase?: string;
}


// Derived lookup maps — call inside component to get translated values
function docTypeLabels(t: (k: string | Record<string, string | undefined>) => string): Record<string, string> {
  return {
    TICKET:       t('templates.dtTicket'),
    INVOICE:      t('templates.dtInvoice'),
    LABEL:        t('templates.dtLabel'),
    MANIFEST:     t('templates.dtManifest'),
    PACKING_LIST: t('templates.dtPackingList'),
  };
}

function formatLabels(t: (k: string | Record<string, string | undefined>) => string): Record<string, string> {
  return {
    A4:           t('templates.fmtA4'),
    A5:           t('templates.fmtA5'),
    THERMAL_80MM: t('templates.fmtThermal'),
    LABEL_62MM:   t('templates.fmtLabel62'),
    BAGGAGE_TAG:  t('templates.fmtBaggage'),
    ENVELOPE_C5:  t('templates.fmtEnvC5'),
    ENVELOPE_DL:  t('templates.fmtEnvDL'),
  };
}

// ─── Composant ────────────────────────────────────────────────────────────────

export function TemplateLibraryPage({ tenantId, apiBase = '/api' }: TemplateLibraryPageProps) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const p = theme === 'dark' ? darkPalette : lightPalette;
  const DOC_TYPE_LABELS = docTypeLabels(t);
  const FORMAT_LABELS = formatLabels(t);
  const [systemTemplates, setSystemTemplates] = useState<DocTemplate[]>([]);
  const [tenantTemplates, setTenantTemplates] = useState<DocTemplate[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<DocTemplate | null>(null);
  const [duplicating,     setDuplicating]     = useState<string | null>(null);
  const [restoringPack,   setRestoringPack]   = useState(false);
  const [filterDocType,   setFilterDocType]   = useState<string>('');

  // ─── Chargement ─────────────────────────────────────────────────────────

  const loadTemplates = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [sysRes, tenantRes] = await Promise.all([
        fetch(`${apiBase}/tenants/${tenantId}/templates/system`, { credentials: 'include' }),
        fetch(`${apiBase}/tenants/${tenantId}/templates`, { credentials: 'include' }),
      ]);

      if (!sysRes.ok || !tenantRes.ok) throw new Error(t('templates.errorLoadTpl'));

      setSystemTemplates(await sysRes.json());
      setTenantTemplates(await tenantRes.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [tenantId, apiBase]);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  // ─── Actions ─────────────────────────────────────────────────────────────

  const handleDuplicate = async (template: DocTemplate) => {
    const name = window.prompt(
      `${t('templates.promptDupName')} "${template.name}" :`,
      `${template.name} — ${t('templates.dupSuffix')}`,
    );
    if (!name) return;

    try {
      setDuplicating(template.id);
      const res = await fetch(
        `${apiBase}/tenants/${tenantId}/templates/${template.id}/duplicate`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ name }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const copy = await res.json();
      await loadTemplates();
      // Ouvrir directement le designer sur la copie
      setEditingTemplate(copy);
    } catch (e: any) {
      alert(`${t('templates.errorDup')} : ${e.message}`);
    } finally {
      setDuplicating(null);
    }
  };

  const handleRestorePack = async () => {
    if (!window.confirm(t('templates.confirmRestore'))) return;

    try {
      setRestoringPack(true);
      const res = await fetch(
        `${apiBase}/tenants/${tenantId}/templates/restore-starter-pack`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: '{}',
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { created, skipped } = await res.json() as { created: string[]; skipped: string[] };
      await loadTemplates();
      alert(
        `${t('templates.packRestored')}\n` +
        `• ${t('templates.packCreated')} : ${created.length}${created.length ? ` (${created.join(', ')})` : ''}\n` +
        `• ${t('templates.packSkipped')} : ${skipped.length}`,
      );
    } catch (e: any) {
      alert(`${t('templates.errorRestore')} : ${e.message}`);
    } finally {
      setRestoringPack(false);
    }
  };

  const handleDelete = async (template: DocTemplate) => {
    if (!window.confirm(`${t('templates.confirmDelete')} "${template.name}" ?`)) return;

    try {
      const res = await fetch(
        `${apiBase}/tenants/${tenantId}/templates/${template.id}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadTemplates();
    } catch (e: any) {
      alert(`${t('templates.errorDelete')} : ${e.message}`);
    }
  };

  // ─── Vue Designer ─────────────────────────────────────────────────────────

  if (editingTemplate) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <TemplateDesigner
          tenantId={tenantId}
          templateId={editingTemplate.id}
          templateName={editingTemplate.name}
          docType={editingTemplate.docType as any}
          apiBase={apiBase}
          onClose={() => { setEditingTemplate(null); loadTemplates(); }}
          onSaved={() => loadTemplates()}
        />
      </div>
    );
  }

  // ─── Vue Bibliothèque ─────────────────────────────────────────────────────

  const filteredSystem = filterDocType
    ? systemTemplates.filter(tpl => tpl.docType === filterDocType)
    : systemTemplates;
  const filteredTenant = filterDocType
    ? tenantTemplates.filter(tpl => tpl.docType === filterDocType)
    : tenantTemplates;

  return (
    <div style={{ padding: '24px', maxWidth: '1100px', margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: p.textHeading, margin: 0 }}>
          {t('templates.pageTitle')}
        </h1>
        <p style={{ fontSize: '13px', color: p.textMuted, marginTop: '4px' }}>
          {t('templates.pageDesc')}
        </p>
      </div>

      {/* Filtre + action pack */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        {['', 'TICKET', 'INVOICE', 'LABEL', 'MANIFEST', 'PACKING_LIST'].map(dt => (
          <button
            key={dt || 'all'}
            onClick={() => setFilterDocType(dt)}
            style={{
              padding: '5px 12px',
              fontSize: '12px',
              border: `1px solid ${filterDocType === dt ? p.primary : p.borderStrong}`,
              borderRadius: '20px',
              background: filterDocType === dt ? p.primary : p.surface,
              color: filterDocType === dt ? p.primaryOnDark : p.textBody,
              cursor: 'pointer',
            }}
          >
            {dt ? DOC_TYPE_LABELS[dt] : t('templates.filterAll')}
          </button>
        ))}

        <button
          onClick={handleRestorePack}
          disabled={restoringPack}
          title={t('templates.restoreTitle')}
          style={{
            marginLeft: 'auto',
            padding: '6px 14px',
            fontSize: '12px',
            fontWeight: 600,
            border: `1px solid ${p.primary}`,
            borderRadius: '20px',
            background: restoringPack ? p.disabledBg : p.surface,
            color: restoringPack ? p.disabledText : p.primary,
            cursor: restoringPack ? 'not-allowed' : 'pointer',
          }}
        >
          {restoringPack ? t('templates.restoring') : t('templates.restorePackBtn')}
        </button>
      </div>

      {error && (
        <div style={{ padding: '12px', background: p.surfaceDanger, color: p.textDanger, borderRadius: '6px', marginBottom: '16px', fontSize: '13px', border: `1px solid ${p.borderDanger}` }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: p.textFaint, fontSize: '14px' }}>{t('templates.loading')}</div>
      ) : (
        <>
          {/* Templates tenant (personnalisés) */}
          {filteredTenant.length > 0 && (
            <section style={{ marginBottom: '32px' }}>
              <h2 style={{ fontSize: '15px', fontWeight: 700, color: p.textHeading, marginBottom: '12px' }}>
                {t('templates.yourTemplates')}
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                {filteredTenant.map(tpl => (
                  <TemplateCard
                    key={tpl.id}
                    template={tpl}
                    isOwned
                    palette={p}
                    t={t}
                    docTypeLabels={DOC_TYPE_LABELS}
                    formatLabels={FORMAT_LABELS}
                    onEdit={() => setEditingTemplate(tpl)}
                    onDelete={() => handleDelete(tpl)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Templates système */}
          <section>
            <h2 style={{ fontSize: '15px', fontWeight: 700, color: p.textBody, marginBottom: '12px' }}>
              {t('templates.systemModels')}
            </h2>
            <p style={{ fontSize: '12px', color: p.textFaint, marginBottom: '12px' }}>
              {t('templates.systemDesc')}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
              {filteredSystem.map(tpl => (
                <TemplateCard
                  key={tpl.id}
                  template={tpl}
                  isOwned={false}
                  palette={p}
                  t={t}
                  docTypeLabels={DOC_TYPE_LABELS}
                  formatLabels={FORMAT_LABELS}
                  onDuplicate={() => handleDuplicate(tpl)}
                  duplicating={duplicating === tpl.id}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// ─── TemplateCard ─────────────────────────────────────────────────────────────

interface TemplateCardProps {
  template:       DocTemplate;
  isOwned:        boolean;
  palette:        typeof lightPalette;
  t:              (k: string | Record<string, string | undefined>) => string;
  docTypeLabels:  Record<string, string>;
  formatLabels:   Record<string, string>;
  onEdit?:        () => void;
  onDelete?:      () => void;
  onDuplicate?:   () => void;
  duplicating?:   boolean;
}

function TemplateCard({
  template, isOwned, palette: p, t, docTypeLabels: DOC_TYPE_LABELS, formatLabels: FORMAT_LABELS, onEdit, onDelete, onDuplicate, duplicating,
}: TemplateCardProps) {
  const engineColor = template.engine === 'PDFME' ? '#7c3aed' : '#2563eb';
  const engineLabel = template.engine === 'PDFME' ? 'Designer' : template.engine;

  return (
    <div
      style={{
        border: `1px solid ${isOwned ? p.borderOwned : p.border}`,
        borderRadius: '8px',
        background: isOwned ? p.surfaceOwned : p.surface,
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      {/* Badges */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: '10px', fontWeight: 700,
            padding: '2px 7px', borderRadius: '3px',
            background: p.surfaceBlue, color: p.badgeBlueText,
          }}
        >
          {DOC_TYPE_LABELS[template.docType] ?? template.docType}
        </span>
        <span
          style={{
            fontSize: '10px', fontWeight: 700,
            padding: '2px 7px', borderRadius: '3px',
            background: p.surfaceBadge, color: p.textBody,
          }}
        >
          {FORMAT_LABELS[template.format] ?? template.format}
        </span>
        <span
          style={{
            fontSize: '10px', fontWeight: 700,
            padding: '2px 7px', borderRadius: '3px',
            background: `${engineColor}${typeof window !== 'undefined' && document.documentElement.classList.contains('dark') ? '40' : '18'}`,
            color: engineColor,
          }}
        >
          {engineLabel}
        </span>
      </div>

      {/* Title */}
      <div>
        <div style={{ fontSize: '13px', fontWeight: 700, color: p.textPrimary }}>
          {template.name}
        </div>
        <div style={{ fontSize: '11px', color: p.textFaint, marginTop: '2px' }}>
          {template.slug}  {isOwned ? `• v${template.version}` : `• ${t('templates.system')}`}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
        {isOwned && template.engine === 'PDFME' && onEdit && (
          <button
            onClick={onEdit}
            style={{
              flex: 1,
              padding: '6px',
              fontSize: '12px',
              background: p.primary,
              color: p.primaryOnDark,
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {t('templates.edit')}
          </button>
        )}
        {isOwned && onDelete && (
          <button
            onClick={onDelete}
            style={{
              padding: '6px 10px',
              fontSize: '12px',
              background: p.surface,
              color: p.textDanger,
              border: `1px solid ${p.borderDanger}`,
              borderRadius: '5px',
              cursor: 'pointer',
            }}
          >
            {t('templates.delete')}
          </button>
        )}
        {!isOwned && onDuplicate && (
          <button
            onClick={onDuplicate}
            disabled={duplicating}
            style={{
              flex: 1,
              padding: '6px',
              fontSize: '12px',
              background: duplicating ? p.disabledBg : p.surfaceBadge,
              color: duplicating ? p.disabledText : p.textBody,
              border: `1px solid ${p.borderStrong}`,
              borderRadius: '5px',
              cursor: duplicating ? 'not-allowed' : 'pointer',
              fontWeight: 600,
            }}
          >
            {duplicating ? t('templates.duplicating') : t('templates.duplicateBtn')}
          </button>
        )}
      </div>
    </div>
  );
}
