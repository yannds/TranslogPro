/**
 * PageBriefingTemplate — éditeur des templates de briefing pré-voyage QHSE.
 *
 * Administre les sections + items du template tenant. Supporte création,
 * activation/désactivation, duplication, édition inline.
 *
 * Accessibilité : WCAG 2.1 AA (aria-expanded, aria-label sur boutons).
 * Dark mode : Tailwind dark:. Light par défaut.
 * i18n : namespace `briefingTemplate.*` + `common.*`.
 */

import { useState, type FormEvent } from 'react';
import {
  ClipboardCheck, Plus, Copy, CheckCircle2, XCircle, ChevronDown,
  ChevronRight, Edit3, Trash2, Sparkles,
} from 'lucide-react';
import { useAuth }     from '../../lib/auth/auth.context';
import { useI18n }     from '../../lib/i18n/useI18n';
import { useFetch }    from '../../lib/hooks/useFetch';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge }       from '../ui/Badge';
import { Button }      from '../ui/Button';
import { Dialog }      from '../ui/Dialog';
import { ErrorAlert }  from '../ui/ErrorAlert';
import { FormFooter }  from '../ui/FormFooter';
import { Skeleton }    from '../ui/Skeleton';
import { inputClass }  from '../ui/inputClass';

// ─── Types ─────────────────────────────────────────────────────────────────

type ItemKind   = 'CHECK' | 'QUANTITY' | 'DOCUMENT' | 'ACKNOWLEDGE' | 'INFO';
type AutoSource = 'DRIVER_REST_HOURS' | 'WEATHER' | 'MANIFEST_LOADED' | 'ROUTE_CONFIRMED';

interface BriefingItem {
  id:              string;
  code:            string;
  kind:            ItemKind;
  labelFr:         string;
  labelEn:         string;
  helpFr?:         string | null;
  helpEn?:         string | null;
  requiredQty:     number;
  isMandatory:     boolean;
  isActive:        boolean;
  order:           number;
  evidenceAllowed: boolean;
  autoSource?:     AutoSource | null;
}

interface BriefingSection {
  id:       string;
  code:     string;
  titleFr:  string;
  titleEn:  string;
  order:    number;
  isActive: boolean;
  items:    BriefingItem[];
}

interface BriefingTemplate {
  id:          string;
  name:        string;
  description: string | null;
  isDefault:   boolean;
  isActive:    boolean;
  sections?:   BriefingSection[];
  _count?:     { sections: number; briefingRecords: number };
}

const ITEM_KINDS: ItemKind[] = ['CHECK', 'QUANTITY', 'DOCUMENT', 'ACKNOWLEDGE', 'INFO'];
const AUTO_SOURCES: AutoSource[] = ['DRIVER_REST_HOURS', 'WEATHER', 'MANIFEST_LOADED', 'ROUTE_CONFIRMED'];

// ─── Composant principal ──────────────────────────────────────────────────

export function PageBriefingTemplate() {
  const { t }    = useI18n();
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const baseUrl  = tenantId ? `/api/tenants/${tenantId}/crew-briefing` : null;
  const { data: templates, loading, error, refetch } =
    useFetch<BriefingTemplate[]>(baseUrl ? `${baseUrl}/templates` : null, [tenantId]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorErr, setEditorErr]   = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [dupFromId,  setDupFromId]  = useState<string | null>(null);

  const selectedUrl = selectedId && baseUrl ? `${baseUrl}/templates/${selectedId}` : null;
  const { data: selected, refetch: refetchSelected } =
    useFetch<BriefingTemplate>(selectedUrl, [selectedId]);

  const list = templates ?? [];

  if (loading) return <div className="p-6"><Skeleton className="h-40 w-full" /></div>;
  if (error)   return <div className="p-6"><ErrorAlert error={error} /></div>;

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <ClipboardCheck className="w-6 h-6 text-blue-600 dark:text-blue-400" aria-hidden="true" />
            {t('briefingTemplate.title')}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('briefingTemplate.subtitle')}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} aria-label={t('briefingTemplate.newTemplate')}>
          <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
          {t('briefingTemplate.newTemplate')}
        </Button>
      </header>

      {list.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-8 text-center text-gray-500 dark:text-gray-400">
          {t('briefingTemplate.noTemplate')}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Liste templates */}
        <aside className="lg:col-span-1 space-y-2">
          {list.map(tpl => (
            <button
              key={tpl.id}
              onClick={() => setSelectedId(tpl.id)}
              aria-pressed={selectedId === tpl.id}
              className={`w-full text-left rounded-lg border p-4 transition ${
                selectedId === tpl.id
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-gray-900 dark:text-gray-100 truncate">
                  {tpl.name}
                </span>
                <div className="flex gap-1 shrink-0">
                  {tpl.isDefault && <Badge variant="info">{t('briefingTemplate.defaultBadge')}</Badge>}
                  {!tpl.isActive && <Badge variant="default">{t('briefingTemplate.inactiveBadge')}</Badge>}
                </div>
              </div>
              {tpl._count && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('briefingTemplate.itemsCount', { count: tpl._count.sections, sections: tpl._count.sections })}
                  {' · '}{t('briefingTemplate.lastUsed', { count: tpl._count.briefingRecords })}
                </p>
              )}
            </button>
          ))}
        </aside>

        {/* Éditeur */}
        <section className="lg:col-span-2">
          {selected ? (
            <TemplateEditor
              template={selected}
              onChange={() => { refetchSelected(); refetch(); }}
              onDuplicate={() => setDupFromId(selected.id)}
              onError={setEditorErr}
              baseUrl={baseUrl!}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-8 text-center text-gray-500 dark:text-gray-400">
              ← {t('briefingTemplate.editTemplate')}
            </div>
          )}
        </section>
      </div>

      {editorErr && <ErrorAlert error={editorErr} />}

      {/* Dialog : créer */}
      <Dialog
        open={createOpen}
        onOpenChange={(v) => { if (!v) setCreateOpen(false); }}
        title={t('briefingTemplate.newTemplate')}
      >
        <CreateTemplateForm
          baseUrl={baseUrl!}
          onDone={() => { setCreateOpen(false); refetch(); }}
          onCancel={() => setCreateOpen(false)}
        />
      </Dialog>

      {/* Dialog : dupliquer */}
      <Dialog
        open={!!dupFromId}
        onOpenChange={(v) => { if (!v) setDupFromId(null); }}
        title={t('briefingTemplate.duplicateTitle')}
      >
        {dupFromId && (
          <DuplicateForm
            baseUrl={baseUrl!}
            sourceId={dupFromId}
            onDone={() => { setDupFromId(null); refetch(); }}
            onCancel={() => setDupFromId(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

// ─── Sous-composant : éditeur d'un template ───────────────────────────────

function TemplateEditor(props: {
  template:    BriefingTemplate;
  baseUrl:     string;
  onChange:    () => void;
  onDuplicate: () => void;
  onError:     (msg: string | null) => void;
}) {
  const { t } = useI18n();
  const { template, baseUrl, onChange, onDuplicate, onError } = props;

  const [addSectionFor, setAddSectionFor] = useState<string | null>(null);
  const [editItemFor,   setEditItemFor]   = useState<{ sectionId: string; item: BriefingItem | null } | null>(null);

  const toggleActive = async (isActive: boolean) => {
    onError(null);
    try {
      await apiPatch(`${baseUrl}/templates/${template.id}`, { isActive });
      onChange();
    } catch (e) { onError(e instanceof Error ? e.message : 'Error'); }
  };

  const setDefault = async () => {
    onError(null);
    try {
      await apiPatch(`${baseUrl}/templates/${template.id}`, { isDefault: true });
      onChange();
    } catch (e) { onError(e instanceof Error ? e.message : 'Error'); }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {template.name}
          </h2>
          <div className="flex gap-2">
            {!template.isDefault && (
              <Button variant="secondary" onClick={setDefault} aria-label={t('briefingTemplate.setDefault')}>
                <Sparkles className="w-4 h-4 mr-1" aria-hidden="true" />
                {t('briefingTemplate.setDefault')}
              </Button>
            )}
            <Button variant="secondary" onClick={onDuplicate} aria-label={t('briefingTemplate.duplicate')}>
              <Copy className="w-4 h-4 mr-1" aria-hidden="true" />
              {t('briefingTemplate.duplicate')}
            </Button>
            <Button variant="secondary" onClick={() => toggleActive(!template.isActive)}>
              {template.isActive ? t('briefingTemplate.deactivate') : t('briefingTemplate.activate')}
            </Button>
          </div>
        </div>
        {template.description && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">{template.description}</p>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {(template.sections ?? []).map(sec => (
          <SectionBlock
            key={sec.id}
            section={sec}
            baseUrl={baseUrl}
            onChange={onChange}
            onEditItem={(item) => setEditItemFor({ sectionId: sec.id, item })}
            onAddItem={() => setEditItemFor({ sectionId: sec.id, item: null })}
          />
        ))}

        <Button variant="secondary" onClick={() => setAddSectionFor(template.id)}>
          <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
          {t('briefingTemplate.addSection')}
        </Button>
      </CardContent>

      {/* Dialog section */}
      <Dialog
        open={!!addSectionFor}
        onOpenChange={(v) => { if (!v) setAddSectionFor(null); }}
        title={t('briefingTemplate.addSection')}
      >
        {addSectionFor && (
          <SectionForm
            baseUrl={baseUrl}
            templateId={addSectionFor}
            onDone={() => { setAddSectionFor(null); onChange(); }}
            onCancel={() => setAddSectionFor(null)}
          />
        )}
      </Dialog>

      {/* Dialog item */}
      <Dialog
        open={!!editItemFor}
        onOpenChange={(v) => { if (!v) setEditItemFor(null); }}
        title={editItemFor?.item ? t('briefingTemplate.itemsTitle') : t('briefingTemplate.addItem')}
      >
        {editItemFor && (
          <ItemForm
            baseUrl={baseUrl}
            sectionId={editItemFor.sectionId}
            initial={editItemFor.item}
            onDone={() => { setEditItemFor(null); onChange(); }}
            onCancel={() => setEditItemFor(null)}
          />
        )}
      </Dialog>
    </Card>
  );
}

// ─── Section block ─────────────────────────────────────────────────────────

function SectionBlock(props: {
  section:     BriefingSection;
  baseUrl:     string;
  onChange:    () => void;
  onEditItem:  (item: BriefingItem) => void;
  onAddItem:   () => void;
}) {
  const { t } = useI18n();
  const { section, baseUrl, onChange, onEditItem, onAddItem } = props;
  const [open, setOpen] = useState(true);

  const removeSection = async () => {
    if (!confirm(t('briefingTemplate.deleteSectionConfirm'))) return;
    await apiDelete(`${baseUrl}/sections/${section.id}`);
    onChange();
  };

  const toggleItem = async (itemId: string, isActive: boolean) => {
    await apiPatch(`${baseUrl}/items/${itemId}/toggle`, { isActive });
    onChange();
  };

  const removeItem = async (itemId: string) => {
    if (!confirm(t('briefingTemplate.deleteItemConfirm'))) return;
    await apiDelete(`${baseUrl}/items/${itemId}`);
    onChange();
  };

  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
      <div className="flex items-center justify-between gap-2 p-3 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-gray-100"
        >
          {open ? <ChevronDown className="w-4 h-4" aria-hidden="true" /> : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
          {section.titleFr}
          <Badge variant="default">{section.items.length}</Badge>
          {!section.isActive && <Badge variant="default">{t('briefingTemplate.inactiveBadge')}</Badge>}
        </button>
        <div className="flex gap-1">
          <Button size="sm" variant="secondary" onClick={onAddItem} aria-label={t('briefingTemplate.addItem')}>
            <Plus className="w-3 h-3" aria-hidden="true" />
          </Button>
          <Button size="sm" variant="ghost" onClick={removeSection} aria-label="delete">
            <Trash2 className="w-3 h-3 text-red-600" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {open && (
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {section.items.map(item => (
            <li key={item.id} className="flex items-center justify-between gap-2 p-3 text-sm">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant="default">{t(`briefingTemplate.kind.${item.kind}`)}</Badge>
                  <span className="font-medium text-gray-900 dark:text-gray-100 truncate">{item.labelFr}</span>
                  {item.isMandatory ? (
                    <Badge variant="info">{t('briefingTemplate.itemMandatory')}</Badge>
                  ) : null}
                </div>
                <code className="text-xs text-gray-500 dark:text-gray-400">{item.code}</code>
                {item.autoSource && <span className="ml-2 text-xs text-blue-600 dark:text-blue-400">
                  → {t(`briefingTemplate.autoSource.${item.autoSource}`)}
                </span>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="sm" variant="ghost" onClick={() => toggleItem(item.id, !item.isActive)} aria-label="toggle">
                  {item.isActive
                    ? <CheckCircle2 className="w-4 h-4 text-green-600" aria-hidden="true" />
                    : <XCircle className="w-4 h-4 text-gray-400" aria-hidden="true" />}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onEditItem(item)} aria-label="edit">
                  <Edit3 className="w-4 h-4" aria-hidden="true" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => removeItem(item.id)} aria-label="delete">
                  <Trash2 className="w-4 h-4 text-red-600" aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
          {section.items.length === 0 && (
            <li className="p-3 text-xs text-gray-500 dark:text-gray-400">—</li>
          )}
        </ul>
      )}
    </div>
  );
}

// ─── Formulaires ─────────────────────────────────────────────────────────

function CreateTemplateForm(props: { baseUrl: string; onDone: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await apiPost(`${props.baseUrl}/templates`, { name, description, isDefault: false });
      props.onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('briefingTemplate.templateName')}</span>
        <input required value={name} onChange={e => setName(e.target.value)} className={inputClass} />
      </label>
      <label className="block">
        <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('briefingTemplate.templateDesc')}</span>
        <textarea value={description} onChange={e => setDescription(e.target.value)} className={inputClass} rows={3} />
      </label>
      {err && <ErrorAlert error={err} />}
      <FormFooter submitLabel={t('common.save')} pendingLabel={t('common.saving')} busy={saving} onCancel={props.onCancel} />
    </form>
  );
}

function DuplicateForm(props: { baseUrl: string; sourceId: string; onDone: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await apiPost(`${props.baseUrl}/templates/${props.sourceId}/duplicate`, { newName });
      props.onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-gray-400">{t('briefingTemplate.duplicateDesc')}</p>
      <label className="block">
        <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('briefingTemplate.newName')}</span>
        <input required value={newName} onChange={e => setNewName(e.target.value)} className={inputClass} />
      </label>
      {err && <ErrorAlert error={err} />}
      <FormFooter submitLabel={t('briefingTemplate.duplicate')} pendingLabel={t('common.saving')} busy={saving} onCancel={props.onCancel} />
    </form>
  );
}

function SectionForm(props: { baseUrl: string; templateId: string; onDone: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [titleFr, setTitleFr] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await apiPost(`${props.baseUrl}/templates/${props.templateId}/sections`, { code, titleFr, titleEn });
      props.onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('briefingTemplate.sectionCode')}</span>
        <input required pattern="[A-Z_]+" value={code} onChange={e => setCode(e.target.value.toUpperCase())} className={inputClass} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('briefingTemplate.sectionTitleFr')}</span>
          <input required value={titleFr} onChange={e => setTitleFr(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('briefingTemplate.sectionTitleEn')}</span>
          <input required value={titleEn} onChange={e => setTitleEn(e.target.value)} className={inputClass} />
        </label>
      </div>
      {err && <ErrorAlert error={err} />}
      <FormFooter submitLabel={t('common.save')} pendingLabel={t('common.saving')} busy={saving} onCancel={props.onCancel} />
    </form>
  );
}

function ItemForm(props: {
  baseUrl:   string;
  sectionId: string;
  initial:   BriefingItem | null;
  onDone:    () => void;
  onCancel:  () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    code:            props.initial?.code ?? '',
    kind:            (props.initial?.kind ?? 'CHECK') as ItemKind,
    labelFr:         props.initial?.labelFr ?? '',
    labelEn:         props.initial?.labelEn ?? '',
    helpFr:          props.initial?.helpFr ?? '',
    helpEn:          props.initial?.helpEn ?? '',
    requiredQty:     props.initial?.requiredQty ?? 1,
    isMandatory:     props.initial?.isMandatory ?? true,
    isActive:        props.initial?.isActive ?? true,
    evidenceAllowed: props.initial?.evidenceAllowed ?? false,
    autoSource:      (props.initial?.autoSource ?? null) as AutoSource | null,
    order:           props.initial?.order ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await apiPost(`${props.baseUrl}/sections/${props.sectionId}/items`, {
        ...form,
        autoSource: form.kind === 'INFO' ? form.autoSource : undefined,
      });
      props.onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('briefingTemplate.itemCode')}</span>
          <input required value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} className={inputClass} />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('briefingTemplate.itemKind')}</span>
          <select value={form.kind} onChange={e => setForm(f => ({ ...f, kind: e.target.value as ItemKind }))} className={inputClass}>
            {ITEM_KINDS.map(k => <option key={k} value={k}>{t(`briefingTemplate.kind.${k}`)}</option>)}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('briefingTemplate.itemLabelFr')}</span>
          <input required value={form.labelFr} onChange={e => setForm(f => ({ ...f, labelFr: e.target.value }))} className={inputClass} />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('briefingTemplate.itemLabelEn')}</span>
          <input required value={form.labelEn} onChange={e => setForm(f => ({ ...f, labelEn: e.target.value }))} className={inputClass} />
        </label>
      </div>
      {form.kind === 'QUANTITY' && (
        <label className="block">
          <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('briefingTemplate.itemRequiredQty')}</span>
          <input type="number" min="1" value={form.requiredQty} onChange={e => setForm(f => ({ ...f, requiredQty: parseInt(e.target.value, 10) || 1 }))} className={inputClass} />
        </label>
      )}
      {form.kind === 'INFO' && (
        <label className="block">
          <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('briefingTemplate.itemAutoSource')}</span>
          <select value={form.autoSource ?? ''} onChange={e => setForm(f => ({ ...f, autoSource: (e.target.value || null) as AutoSource | null }))} className={inputClass}>
            <option value="">—</option>
            {AUTO_SOURCES.map(s => <option key={s} value={s}>{t(`briefingTemplate.autoSource.${s}`)}</option>)}
          </select>
        </label>
      )}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.isMandatory} onChange={e => setForm(f => ({ ...f, isMandatory: e.target.checked }))} />
          {t('briefingTemplate.itemMandatory')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} />
          {t('briefingTemplate.itemActive')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.evidenceAllowed} onChange={e => setForm(f => ({ ...f, evidenceAllowed: e.target.checked }))} />
          {t('briefingTemplate.itemEvidenceAllowed')}
        </label>
      </div>
      {err && <ErrorAlert error={err} />}
      <FormFooter submitLabel={t('common.save')} pendingLabel={t('common.saving')} busy={saving} onCancel={props.onCancel} />
    </form>
  );
}
