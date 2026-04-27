/**
 * PageLicensePlateFormats — éditeur des masques d'immatriculation par pays.
 *
 * Permet à l'admin tenant de modifier le registre stocké dans
 * TenantBusinessConfig.licensePlateFormats. Les masques utilisent la convention
 * permissive : tout chiffre = emplacement chiffre, toute lettre = emplacement
 * lettre (hors lettres exclues), autres = séparateur littéral.
 *
 * Les masques sont en mode warn-only — voir docs/LICENSE_PLATE_FORMATS.md.
 *
 * API :
 *   GET  /api/tenants/:tid/fleet/license-plate-formats
 *   PUT  /api/tenants/:tid/fleet/license-plate-formats   body: { formats }
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2, X, Check, Globe2 } from 'lucide-react';
import { useAuth }                  from '../../lib/auth/auth.context';
import { useFetch }                 from '../../lib/hooks/useFetch';
import { apiPut }                   from '../../lib/api';
import { useI18n }                  from '../../lib/i18n/useI18n';
import { Badge }                    from '../ui/Badge';
import { Button }                   from '../ui/Button';
import { Dialog }                   from '../ui/Dialog';
import { ErrorAlert }               from '../ui/ErrorAlert';
import { FormFooter }               from '../ui/FormFooter';
import { inputClass as inp }        from '../ui/inputClass';
import DataTableMaster, { type Column, type RowAction } from '../DataTableMaster';

interface FormatEntry {
  label?:           string;
  masks:            string[];
  excludedLetters?: string[];
  examples?:        string[];
  notes?:           string;
}

interface FormatsResponse {
  defaultCountry: string | null;
  formats:        Record<string, FormatEntry>;
}

interface CountryRow {
  id:              string;     // = code (requis par DataTableMaster<{id:string}>)
  code:            string;
  label:           string;
  masks:           string[];
  excludedLetters: string[];
  examples:        string[];
  notes:           string;
}

interface FormState {
  code:            string;
  label:           string;
  masksText:       string;     // textarea, un masque par ligne
  excludedLetters: string;     // input, séparées par virgule
  examplesText:    string;     // textarea, un exemple par ligne
  notes:           string;
}

const EMPTY_FORM: FormState = {
  code: '', label: '', masksText: '', excludedLetters: '', examplesText: '', notes: '',
};

function entryToForm(code: string, e: FormatEntry): FormState {
  return {
    code,
    label:           e.label ?? code,
    masksText:       (e.masks ?? []).join('\n'),
    excludedLetters: (e.excludedLetters ?? []).join(', '),
    examplesText:    (e.examples ?? []).join('\n'),
    notes:           e.notes ?? '',
  };
}

function formToEntry(f: FormState): { code: string; entry: FormatEntry } {
  return {
    code: f.code.toUpperCase().trim(),
    entry: {
      label:           f.label.trim() || f.code.toUpperCase().trim(),
      masks:           f.masksText.split(/\r?\n/).map(s => s.trim()).filter(Boolean),
      excludedLetters: f.excludedLetters.split(/[,;\s]+/).map(s => s.toUpperCase().trim()).filter(Boolean),
      examples:        f.examplesText.split(/\r?\n/).map(s => s.trim()).filter(Boolean),
      notes:           f.notes.trim() || undefined,
    },
  };
}

export function PageLicensePlateFormats() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId ?? '';
  const url = `/api/tenants/${tenantId}/fleet/license-plate-formats`;

  const { data, loading, error, refetch } = useFetch<FormatsResponse>(
    tenantId ? url : null, [tenantId],
  );

  const [editing,    setEditing]    = useState<{ form: FormState; isNew: boolean } | null>(null);
  const [deleting,   setDeleting]   = useState<CountryRow | null>(null);
  const [busy,       setBusy]       = useState(false);
  const [actionErr,  setActionErr]  = useState<string | null>(null);

  const rows = useMemo<CountryRow[]>(() => {
    const formats = data?.formats ?? {};
    return Object.entries(formats)
      .map(([code, e]) => ({
        id:              code,
        code,
        label:           e.label ?? code,
        masks:           e.masks ?? [],
        excludedLetters: e.excludedLetters ?? [],
        examples:        e.examples ?? [],
        notes:           e.notes ?? '',
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [data]);

  const persist = async (next: Record<string, FormatEntry>) => {
    setBusy(true); setActionErr(null);
    try {
      await apiPut(url, { formats: next });
      refetch();
      setEditing(null);
      setDeleting(null);
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const { code, entry } = formToEntry(editing.form);
    if (!/^[A-Z]{2}$/.test(code)) {
      setActionErr(t('licensePlateFormats.invalidCountryCode'));
      return;
    }
    if (entry.masks.length === 0) {
      setActionErr(t('licensePlateFormats.atLeastOneMask'));
      return;
    }
    const next = { ...(data?.formats ?? {}) };
    if (editing.isNew && next[code]) {
      setActionErr(t('licensePlateFormats.countryAlreadyExists').replace('{code}', code));
      return;
    }
    next[code] = entry;
    await persist(next);
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const next = { ...(data?.formats ?? {}) };
    delete next[deleting.code];
    await persist(next);
  };

  const COLUMNS: Column<CountryRow>[] = [
    {
      key:       'id',
      header:    t('licensePlateFormats.colCountry'),
      sortable:  true,
      width:     '120px',
      cellRenderer: (_, row) => (
        <div className="flex items-center gap-2">
          <Globe2 className="w-4 h-4 text-slate-400" aria-hidden />
          <span className="font-mono font-semibold">{row.code}</span>
          {row.code === data?.defaultCountry && (
            <Badge variant="info" size="sm">{t('licensePlateFormats.defaultCountry')}</Badge>
          )}
        </div>
      ),
    },
    {
      key:      'label',
      header:   t('licensePlateFormats.colLabel'),
      sortable: true,
    },
    {
      key:    'masks',
      header: t('licensePlateFormats.colMasks'),
      cellRenderer: (_, row) => (
        <div className="flex flex-wrap gap-1.5">
          {row.masks.slice(0, 4).map(m => (
            <code key={m} className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-xs font-mono">
              {m}
            </code>
          ))}
          {row.masks.length > 4 && (
            <span className="text-xs text-slate-400">+{row.masks.length - 4}</span>
          )}
        </div>
      ),
      csvValue: (_, row) => row.masks.join(' | '),
    },
    {
      key:    'excludedLetters',
      header: t('licensePlateFormats.colExcluded'),
      width:  '160px',
      cellRenderer: (_, row) => row.excludedLetters.length > 0
        ? <span className="text-xs font-mono text-slate-500">{row.excludedLetters.join(', ')}</span>
        : <span className="text-xs text-slate-400 italic">—</span>,
      csvValue: (_, row) => row.excludedLetters.join(', '),
    },
    {
      key:    'examples',
      header: t('licensePlateFormats.colExamples'),
      cellRenderer: (_, row) => row.examples.length > 0
        ? (
          <span className="text-xs font-mono text-slate-600 dark:text-slate-300">
            {row.examples.slice(0, 2).join(', ')}
            {row.examples.length > 2 && ` +${row.examples.length - 2}`}
          </span>
        )
        : <span className="text-xs text-slate-400 italic">—</span>,
      csvValue: (_, row) => row.examples.join(' | '),
    },
  ];

  const ROW_ACTIONS: RowAction<CountryRow>[] = [
    {
      label: t('common.edit'),
      icon:  <Pencil size={13} />,
      onClick: (row) => {
        setActionErr(null);
        setEditing({ form: entryToForm(row.code, row), isNew: false });
      },
    },
    {
      label: t('common.delete'),
      icon:  <Trash2 size={13} />,
      danger: true,
      onClick: (row) => { setActionErr(null); setDeleting(row); },
    },
  ];

  return (
    <main className="p-6 space-y-6" role="main" aria-label={t('licensePlateFormats.pageTitle')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Globe2 className="w-6 h-6 text-emerald-500" aria-hidden />
            {t('licensePlateFormats.pageTitle')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t('licensePlateFormats.pageSubtitle')}
          </p>
        </div>
        <Button onClick={() => {
          setActionErr(null);
          setEditing({ form: EMPTY_FORM, isNew: true });
        }}>
          <Plus className="w-4 h-4 mr-2" aria-hidden /> {t('licensePlateFormats.addCountry')}
        </Button>
      </div>

      <div className="rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-300">
        💡 {t('licensePlateFormats.helpHint')}
      </div>

      {error && <ErrorAlert error={error} />}

      <DataTableMaster<CountryRow>
        data={rows}
        columns={COLUMNS}
        rowActions={ROW_ACTIONS}
        loading={loading}
        emptyMessage={t('licensePlateFormats.empty')}
        defaultSort={{ key: 'id', dir: 'asc' }}
      />

      {/* Modale édition / création */}
      <Dialog
        open={!!editing}
        onOpenChange={o => { if (!o) setEditing(null); }}
        title={editing?.isNew ? t('licensePlateFormats.addCountry') : t('licensePlateFormats.editCountry')}
        description={editing ? `${editing.form.code || '—'} — ${editing.form.label || ''}` : ''}
        size="xl"
      >
        {editing && (
          <form onSubmit={handleSave} className="space-y-4">
            <ErrorAlert error={actionErr} />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t('licensePlateFormats.fieldCountryCode')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text" required maxLength={2}
                  value={editing.form.code}
                  onChange={e => setEditing({ ...editing, form: { ...editing.form, code: e.target.value.toUpperCase() } })}
                  disabled={busy || !editing.isNew}
                  className={inp + ' font-mono uppercase'}
                  placeholder="CG"
                />
                <p className="text-xs text-slate-400">{t('licensePlateFormats.iso2Hint')}</p>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t('licensePlateFormats.fieldLabel')}
                </label>
                <input
                  type="text"
                  value={editing.form.label}
                  onChange={e => setEditing({ ...editing, form: { ...editing.form, label: e.target.value } })}
                  disabled={busy}
                  className={inp}
                  placeholder="Congo Brazzaville"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('licensePlateFormats.fieldMasks')} <span className="text-red-500">*</span>
              </label>
              <textarea
                required rows={5}
                value={editing.form.masksText}
                onChange={e => setEditing({ ...editing, form: { ...editing.form, masksText: e.target.value } })}
                disabled={busy}
                className={inp + ' font-mono'}
                placeholder={'999-A-9\n999-AA-9\n999-AAA-9'}
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('licensePlateFormats.masksHint')}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t('licensePlateFormats.fieldExcluded')}
                </label>
                <input
                  type="text"
                  value={editing.form.excludedLetters}
                  onChange={e => setEditing({ ...editing, form: { ...editing.form, excludedLetters: e.target.value } })}
                  disabled={busy}
                  className={inp + ' font-mono uppercase'}
                  placeholder="W, Y, O, I, Z"
                />
                <p className="text-xs text-slate-400">{t('licensePlateFormats.excludedHint')}</p>
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t('licensePlateFormats.fieldExamples')}
                </label>
                <textarea
                  rows={3}
                  value={editing.form.examplesText}
                  onChange={e => setEditing({ ...editing, form: { ...editing.form, examplesText: e.target.value } })}
                  disabled={busy}
                  className={inp + ' font-mono'}
                  placeholder={'001-AS-4\n234-AB-12'}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('licensePlateFormats.fieldNotes')}
              </label>
              <textarea
                rows={2}
                value={editing.form.notes}
                onChange={e => setEditing({ ...editing, form: { ...editing.form, notes: e.target.value } })}
                disabled={busy}
                className={inp}
                placeholder={t('licensePlateFormats.notesPlaceholder')}
              />
            </div>

            <FormFooter
              onCancel={() => setEditing(null)}
              busy={busy}
              submitLabel={t('common.save')}
              pendingLabel={t('common.saving')}
            />
          </form>
        )}
      </Dialog>

      {/* Modale confirmation suppression */}
      <Dialog
        open={!!deleting}
        onOpenChange={o => { if (!o) setDeleting(null); }}
        title={t('licensePlateFormats.deleteTitle')}
        description={deleting
          ? t('licensePlateFormats.deleteDesc').replace('{code}', deleting.code).replace('{label}', deleting.label)
          : ''}
        size="md"
      >
        {deleting && (
          <div className="space-y-3">
            <ErrorAlert error={actionErr} />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDeleting(null)} disabled={busy}>
                <X className="w-4 h-4 mr-1.5" aria-hidden /> {t('common.cancel')}
              </Button>
              <Button onClick={handleDelete} disabled={busy} variant="destructive">
                <Check className="w-4 h-4 mr-1.5" aria-hidden /> {busy ? t('common.deleting') : t('common.delete')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </main>
  );
}
