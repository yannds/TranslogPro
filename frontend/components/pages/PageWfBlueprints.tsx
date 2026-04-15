/**
 * PageWfBlueprints — Gestion des Blueprints de Workflow
 *
 * CRUD complet :
 *   - Lister les blueprints accessibles (propres + système + publics)
 *   - Créer un nouveau blueprint (métadonnées + graphe JSON)
 *   - Modifier un blueprint existant (métadonnées uniquement)
 *   - Supprimer un blueprint (non-système)
 *   - Installer un blueprint sur le tenant actif
 *
 * Données :
 *   GET    /api/tenants/:tid/workflow-studio/blueprints
 *   POST   /api/tenants/:tid/workflow-studio/blueprints
 *   PUT    /api/tenants/:tid/workflow-studio/blueprints/:id
 *   DELETE /api/tenants/:tid/workflow-studio/blueprints/:id
 *   POST   /api/tenants/:tid/workflow-studio/blueprints/:id/install
 *
 * Accessibilité : WCAG 2.1 AA
 * Dark mode : classes Tailwind dark: via ThemeProvider
 */

import { useState, type FormEvent } from 'react';
import {
  GitFork, Plus, Pencil, Trash2, Download, Shield, Globe, Lock,
  Tag, ChevronDown, ChevronUp, X, Check, AlertTriangle,
} from 'lucide-react';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPost, apiPut, apiDelete } from '../../lib/api';
import { useAuth } from '../../lib/auth/auth.context';
import { Card, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { Dialog } from '../ui/Dialog';
import { cn } from '../../lib/utils';
import type { BlueprintSummary } from '../workflow/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CreateBlueprintForm {
  name:        string;
  slug:        string;
  description: string;
  entityType:  string;
  isPublic:    boolean;
  tags:        string;
  categoryId:  string;
  graphJson:   string;
}

const ENTITY_TYPES = ['Ticket', 'Trip', 'Parcel', 'Bus', 'Claim'];

const EMPTY_GRAPH = (entityType: string) => JSON.stringify({
  entityType,
  nodes: [
    { id: 'INITIAL', label: 'Initial', type: 'initial',  position: { x: 60,  y: 100 }, metadata: {} },
    { id: 'FINAL',   label: 'Final',   type: 'terminal', position: { x: 400, y: 100 }, metadata: {} },
  ],
  edges: [
    { id: 'INITIAL___next___FINAL', source: 'INITIAL', target: 'FINAL', label: 'next', guards: [], permission: '', sideEffects: [], metadata: {} },
  ],
  version: '1.0.0',
  checksum: '',
  metadata: {},
}, null, 2);

// ─── Badge helpers ────────────────────────────────────────────────────────────

function blueprintBadge(bp: BlueprintSummary) {
  if (bp.isSystem) return { variant: 'warning' as const, label: 'Système', icon: Shield };
  if (bp.isPublic) return { variant: 'info'    as const, label: 'Public',  icon: Globe   };
  return               { variant: 'default' as const, label: 'Privé',   icon: Lock    };
}

// ─── Blueprint Card ───────────────────────────────────────────────────────────

function BlueprintCard({
  bp,
  onEdit,
  onDelete,
  onInstall,
  installing,
  tenantId,
}: {
  bp:         BlueprintSummary;
  onEdit:     (bp: BlueprintSummary) => void;
  onDelete:   (bp: BlueprintSummary) => void;
  onInstall:  (id: string) => void;
  installing: string | null;
  tenantId:   string;
}) {
  const [expanded, setExpanded] = useState(false);
  const badge = blueprintBadge(bp);
  const BadgeIcon = badge.icon;

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold text-slate-900 dark:text-white text-sm truncate">
                {bp.name}
              </span>
              <Badge variant={badge.variant}>
                <BadgeIcon className="w-3 h-3 mr-1" aria-hidden />
                {badge.label}
              </Badge>
              <Badge variant="default">{bp.entityType}</Badge>
              <span className="text-xs text-slate-400">v{bp.version}</span>
            </div>
            {bp.description && (
              <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mb-2">
                {bp.description}
              </p>
            )}
            {bp.tags && bp.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {bp.tags.slice(0, 5).map(tag => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] text-slate-500 dark:text-slate-400"
                  >
                    <Tag className="w-2.5 h-2.5" aria-hidden />
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-center gap-3 text-[11px] text-slate-400">
              {bp.category && <span>{bp.category.name}</span>}
              {bp._count && (
                <span>{bp._count.installs} install{bp._count.installs !== 1 ? 's' : ''}</span>
              )}
              {bp.installs && bp.installs.length > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                  ✓ Installé {bp.installs[0]?.isDirty ? '(modifié)' : ''}
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onInstall(bp.id)}
              disabled={installing === bp.id}
              aria-label={`Installer ${bp.name}`}
            >
              <Download className="w-3.5 h-3.5 mr-1" aria-hidden />
              {installing === bp.id ? 'Install…' : 'Installer'}
            </Button>
            {!bp.isSystem && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onEdit(bp)}
                  aria-label={`Modifier ${bp.name}`}
                >
                  <Pencil className="w-3.5 h-3.5" aria-hidden />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onDelete(bp)}
                  aria-label={`Supprimer ${bp.name}`}
                  className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden />
                </Button>
              </>
            )}
            <button
              type="button"
              onClick={() => setExpanded(p => !p)}
              aria-expanded={expanded}
              aria-label="Voir le graphe"
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded transition-colors"
            >
              {expanded
                ? <ChevronUp   className="w-3.5 h-3.5" aria-hidden />
                : <ChevronDown className="w-3.5 h-3.5" aria-hidden />}
            </button>
          </div>
        </div>

        {/* Détails expandables */}
        {expanded && (
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-2">Aperçu du graphe</p>
            <GraphPreview tenantId={tenantId} bpId={bp.id} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Aperçu graphe ────────────────────────────────────────────────────────────

function GraphPreview({ tenantId, bpId }: { tenantId: string; bpId: string }) {
  const { data, loading } = useFetch<{ graphJson: { nodes: unknown[]; edges: unknown[] } }>(
    tenantId ? `/api/tenants/${tenantId}/workflow-studio/blueprints/${bpId}` : null,
    [tenantId, bpId],
  );
  if (loading || !data) return <Skeleton className="h-12 w-full" />;
  const g = data.graphJson;
  return (
    <div className="grid grid-cols-2 gap-2 text-xs">
      <div className="rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-2">
        <div className="text-slate-400 text-[10px] mb-0.5">États</div>
        <div className="font-semibold text-slate-900 dark:text-white">{g.nodes?.length ?? '—'}</div>
      </div>
      <div className="rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-2">
        <div className="text-slate-400 text-[10px] mb-0.5">Transitions</div>
        <div className="font-semibold text-slate-900 dark:text-white">{g.edges?.length ?? '—'}</div>
      </div>
    </div>
  );
}

// ─── Formulaire create/edit ───────────────────────────────────────────────────

function BlueprintForm({
  initial,
  onSubmit,
  onCancel,
  busy,
  error,
}: {
  initial?: Partial<CreateBlueprintForm>;
  onSubmit: (form: CreateBlueprintForm) => void;
  onCancel: () => void;
  busy:     boolean;
  error:    string | null;
}) {
  const [form, setForm] = useState<CreateBlueprintForm>({
    name:        initial?.name        ?? '',
    slug:        initial?.slug        ?? '',
    description: initial?.description ?? '',
    entityType:  initial?.entityType  ?? 'Ticket',
    isPublic:    initial?.isPublic    ?? false,
    tags:        initial?.tags        ?? '',
    categoryId:  initial?.categoryId  ?? '',
    graphJson:   initial?.graphJson   ?? EMPTY_GRAPH(initial?.entityType ?? 'Ticket'),
  });

  const setField = <K extends keyof CreateBlueprintForm>(k: K, v: CreateBlueprintForm[K]) =>
    setForm(p => ({ ...p, [k]: v }));

  const handleName = (v: string) => {
    setField('name', v);
    if (!initial?.slug) {
      setField('slug', v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
    }
  };

  const handleEntityChange = (v: string) => {
    setField('entityType', v);
    if (!initial?.graphJson) setField('graphJson', EMPTY_GRAPH(v));
  };

  const inputClass = cn(
    'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800',
    'px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400',
    'focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30',
  );

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(form); }} className="space-y-4">
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Nom <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="text" required value={form.name}
            onChange={e => handleName(e.target.value)}
            placeholder="Mon workflow" className={inputClass} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Slug <span aria-hidden className="text-red-500">*</span>
          </label>
          <input type="text" required value={form.slug}
            onChange={e => setField('slug', e.target.value)}
            placeholder="mon-workflow" className={`${inputClass} font-mono`} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Type d'entité <span aria-hidden className="text-red-500">*</span>
          </label>
          <select value={form.entityType}
            onChange={e => handleEntityChange(e.target.value)}
            className={inputClass} disabled={busy || !!initial?.entityType}>
            {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="col-span-2 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Description</label>
          <textarea value={form.description}
            onChange={e => setField('description', e.target.value)}
            rows={2} placeholder="Description du blueprint…" className={inputClass} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Tags (virgule séparés)</label>
          <input type="text" value={form.tags}
            onChange={e => setField('tags', e.target.value)}
            placeholder="transport, standard" className={inputClass} disabled={busy} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Visibilité</label>
          <label className="flex items-center gap-2 cursor-pointer mt-2.5">
            <input type="checkbox" checked={form.isPublic}
              onChange={e => setField('isPublic', e.target.checked)}
              className="rounded border-slate-300 text-blue-600" disabled={busy} />
            <span className="text-sm text-slate-700 dark:text-slate-300">Publier sur le Marketplace</span>
          </label>
        </div>
        {!initial?.name && (
          <div className="col-span-2 space-y-1.5">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Graphe JSON <span aria-hidden className="text-red-500">*</span>
            </label>
            <textarea value={form.graphJson}
              onChange={e => setField('graphJson', e.target.value)}
              rows={8} className={`${inputClass} font-mono text-xs`} disabled={busy}
              placeholder='{"entityType":"Ticket","nodes":[...],"edges":[...]}' />
            <p className="text-[11px] text-slate-400">
              Collez un graphe exporté depuis le Workflow Studio ou modifiez le template.
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          <X className="w-4 h-4 mr-1.5" aria-hidden /> Annuler
        </Button>
        <Button type="submit" disabled={busy}>
          <Check className="w-4 h-4 mr-1.5" aria-hidden />
          {busy ? 'Enregistrement…' : initial?.name ? 'Mettre à jour' : 'Créer'}
        </Button>
      </div>
    </form>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function PageWfBlueprints() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const base     = `/api/tenants/${tenantId}/workflow-studio`;

  const { data: blueprints, loading, error, refetch } = useFetch<BlueprintSummary[]>(
    tenantId ? `${base}/blueprints` : null,
    [tenantId],
  );

  const [showCreate, setShowCreate] = useState(false);
  const [editBp,     setEditBp]     = useState<BlueprintSummary | null>(null);
  const [deleteBp,   setDeleteBp]   = useState<BlueprintSummary | null>(null);
  const [busy,       setBusy]       = useState(false);
  const [actionErr,  setActionErr]  = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [filterEntity, setFilterEntity] = useState('');
  const [filterSearch, setFilterSearch] = useState('');

  const filtered = (blueprints ?? []).filter(bp => {
    if (filterEntity && bp.entityType !== filterEntity) return false;
    if (filterSearch && !bp.name.toLowerCase().includes(filterSearch.toLowerCase())) return false;
    return true;
  });

  const handleCreate = async (form: CreateBlueprintForm) => {
    setBusy(true);
    setActionErr(null);
    try {
      let graphJson: unknown;
      try { graphJson = JSON.parse(form.graphJson); }
      catch { throw new Error('JSON du graphe invalide'); }

      await apiPost(`${base}/blueprints`, {
        name:        form.name,
        slug:        form.slug,
        description: form.description || undefined,
        isPublic:    form.isPublic,
        tags:        form.tags.split(',').map(t => t.trim()).filter(Boolean),
        categoryId:  form.categoryId || undefined,
        graph:       graphJson,
      });
      setShowCreate(false);
      refetch();
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleEdit = async (form: CreateBlueprintForm) => {
    if (!editBp) return;
    setBusy(true);
    setActionErr(null);
    try {
      await apiPut(`${base}/blueprints/${editBp.id}`, {
        name:        form.name,
        description: form.description || undefined,
        isPublic:    form.isPublic,
        tags:        form.tags.split(',').map(t => t.trim()).filter(Boolean),
      });
      setEditBp(null);
      refetch();
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteBp) return;
    setBusy(true);
    setActionErr(null);
    try {
      await apiDelete(`${base}/blueprints/${deleteBp.id}`);
      setDeleteBp(null);
      refetch();
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleInstall = async (id: string) => {
    setInstalling(id);
    setActionErr(null);
    try {
      await apiPost(`${base}/blueprints/${id}/install`, {});
      refetch();
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className="p-6 space-y-6">

      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
            <GitFork className="w-5 h-5 text-blue-600 dark:text-blue-400" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Blueprints</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {blueprints ? `${blueprints.length} blueprint(s) disponible(s)` : 'Modèles de workflows réutilisables'}
            </p>
          </div>
        </div>
        <Button onClick={() => { setShowCreate(true); setActionErr(null); }}>
          <Plus className="w-4 h-4 mr-2" aria-hidden />
          Nouveau Blueprint
        </Button>
      </div>

      {/* Filtres */}
      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          value={filterSearch}
          onChange={e => setFilterSearch(e.target.value)}
          placeholder="Rechercher…"
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 w-48"
        />
        <select
          value={filterEntity}
          onChange={e => setFilterEntity(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        >
          <option value="">Tous les types</option>
          {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Erreur */}
      {(error || actionErr) && (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />
          {error ?? actionErr}
        </div>
      )}

      {/* Liste */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <Card key={i}><CardContent className="pt-4 space-y-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </CardContent></Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-slate-500 dark:text-slate-400">
          {blueprints?.length === 0
            ? 'Aucun blueprint. Créez-en un ou installez des modèles depuis le Marketplace.'
            : 'Aucun résultat pour ces filtres.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(bp => (
            <BlueprintCard
              key={bp.id}
              bp={bp}
              onEdit={bp => { setEditBp(bp); setActionErr(null); }}
              onDelete={bp => { setDeleteBp(bp); setActionErr(null); }}
              onInstall={handleInstall}
              installing={installing}
              tenantId={tenantId}
            />
          ))}
        </div>
      )}

      {/* Modal Créer */}
      <Dialog
        open={showCreate}
        onOpenChange={open => { if (!open) setShowCreate(false); }}
        title="Nouveau Blueprint"
        description="Définissez un modèle de workflow réutilisable."
        size="lg"
      >
        <BlueprintForm
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
          busy={busy}
          error={actionErr}
        />
      </Dialog>

      {/* Modal Éditer */}
      <Dialog
        open={!!editBp}
        onOpenChange={open => { if (!open) setEditBp(null); }}
        title="Modifier le Blueprint"
        description="Mettez à jour les métadonnées. Le graphe se modifie via le Studio."
        size="lg"
      >
        {editBp && (
          <BlueprintForm
            initial={{
              name:        editBp.name,
              slug:        editBp.slug,
              description: editBp.description ?? '',
              entityType:  editBp.entityType,
              isPublic:    editBp.isPublic,
              tags:        editBp.tags?.join(', ') ?? '',
            }}
            onSubmit={handleEdit}
            onCancel={() => setEditBp(null)}
            busy={busy}
            error={actionErr}
          />
        )}
      </Dialog>

      {/* Modal Supprimer */}
      <Dialog
        open={!!deleteBp}
        onOpenChange={open => { if (!open) setDeleteBp(null); }}
        title="Confirmer la suppression"
        description={`Êtes-vous sûr de vouloir supprimer "${deleteBp?.name}" ? Cette action est irréversible.`}
        footer={
          <div className="flex items-center gap-3">
            {actionErr && (
              <span className="text-sm text-red-600 dark:text-red-400 mr-auto">{actionErr}</span>
            )}
            <Button variant="outline" onClick={() => setDeleteBp(null)} disabled={busy}>
              <X className="w-4 h-4 mr-1.5" aria-hidden /> Annuler
            </Button>
            <Button
              onClick={handleDelete}
              disabled={busy}
              className="bg-red-600 hover:bg-red-700 text-white border-red-600"
            >
              <Trash2 className="w-4 h-4 mr-1.5" aria-hidden />
              {busy ? 'Suppression…' : 'Supprimer'}
            </Button>
          </div>
        }
      >
        {/* Children required — empty body since info is in description */}
        <div />
      </Dialog>

    </div>
  );
}
