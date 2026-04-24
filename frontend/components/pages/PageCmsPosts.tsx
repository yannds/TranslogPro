/**
 * PageCmsPosts — Gestion des actualités / news du portail public
 *
 * CRUD posts avec :
 *   - Éditeur riche HTML
 *   - Upload photos/vidéos (médias multiples)
 *   - Image de couverture
 *   - Tags, publication, auteur
 *
 * API :
 *   GET    /api/tenants/:tid/portal/posts
 *   GET    /api/tenants/:tid/portal/posts/:id
 *   POST   /api/tenants/:tid/portal/posts
 *   PUT    /api/tenants/:tid/portal/posts/:id
 *   DELETE /api/tenants/:tid/portal/posts/:id
 *   POST   /api/tenants/:tid/portal/media/upload-url
 */

import { useState, useRef, useCallback } from 'react';
import {
  Newspaper, Plus, Pencil, Trash2, Eye, EyeOff, Save,
  ChevronLeft, ImagePlus, X, Video, Tag, User,
  Upload, Megaphone, MegaphoneOff,
} from 'lucide-react';
import { useAuth } from '../../lib/auth/auth.context';
import { useI18n } from '../../lib/i18n/useI18n';
import { useFetch } from '../../lib/hooks/useFetch';
import { apiPost, apiPut, apiDelete, apiGet } from '../../lib/api';
import DataTableMaster from '../DataTableMaster';
import type { Column, RowAction } from '../DataTableMaster';
import { Button } from '../ui/Button';
import { RichTextEditor } from '../ui/RichTextEditor';
import { cn } from '../../lib/utils';

interface PostMedia {
  id?: string;
  url: string;
  type: 'IMAGE' | 'VIDEO';
  caption?: string;
  sortOrder: number;
  signedUrl?: string | null;
}

interface CmsPost {
  id: string;
  title: string;
  slug: string | null;
  excerpt: string | null;
  content: string;
  coverImage: string | null;
  locale: string;
  published: boolean;
  publishedAt: string | null;
  authorName: string | null;
  tags: string[];
  media: PostMedia[];
  coverImageUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

const EMPTY_POST: Partial<CmsPost> = {
  title: '',
  excerpt: '',
  content: '',
  coverImage: null,
  locale: 'fr',
  published: false,
  publishedAt: null,
  authorName: '',
  tags: [],
  media: [],
};

export function PageCmsPosts() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tenantId = user?.tenantId;

  const postsRes = useFetch<CmsPost[]>(
    tenantId ? `/api/tenants/${tenantId}/portal/posts` : null,
    [tenantId],
  );

  const [editing, setEditing] = useState<Partial<CmsPost> | null>(null);
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openNew = () => setEditing({ ...EMPTY_POST });

  const openEdit = async (post: CmsPost) => {
    if (!tenantId) return;
    try {
      const detail = await apiGet<CmsPost>(`/api/tenants/${tenantId}/portal/posts/${post.id}`);
      setEditing(detail);
    } catch {
      setEditing({ ...post });
    }
  };

  const savePost = async () => {
    if (!tenantId || !editing?.title) return;
    setSaving(true);
    try {
      const payload = {
        title:       editing.title,
        excerpt:     editing.excerpt || undefined,
        content:     editing.content || '',
        coverImage:  editing.coverImage || undefined,
        locale:      editing.locale || 'fr',
        published:   editing.published ?? false,
        publishedAt: editing.publishedAt || undefined,
        authorName:  editing.authorName || undefined,
        tags:        editing.tags ?? [],
        media:       (editing.media ?? []).map((m, i) => ({
          url:       m.url,
          type:      m.type,
          caption:   m.caption,
          sortOrder: i,
        })),
      };

      if (editing.id) {
        await apiPut(`/api/tenants/${tenantId}/portal/posts/${editing.id}`, payload);
      } else {
        await apiPost(`/api/tenants/${tenantId}/portal/posts`, payload);
      }
      setEditing(null);
      postsRes.refetch();
    } finally {
      setSaving(false);
    }
  };

  const deletePost = async (post: CmsPost) => {
    if (!tenantId) return;
    await apiDelete(`/api/tenants/${tenantId}/portal/posts/${post.id}`);
    postsRes.refetch();
  };

  const togglePublish = async (post: CmsPost) => {
    if (!tenantId) return;
    await apiPut(`/api/tenants/${tenantId}/portal/posts/${post.id}`, {
      title:     post.title,
      content:   post.content,
      published: !post.published,
    });
    postsRes.refetch();
  };

  const updateField = <K extends keyof CmsPost>(key: K, val: CmsPost[K]) => {
    setEditing(e => e ? { ...e, [key]: val } : e);
  };

  // ── Tag management ────────────────────────────────────────────────────────

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !(editing?.tags ?? []).includes(tag)) {
      updateField('tags', [...(editing?.tags ?? []), tag]);
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    updateField('tags', (editing?.tags ?? []).filter(t => t !== tag));
  };

  // ── Media upload ──────────────────────────────────────────────────────────

  const handleMediaUpload = useCallback(async (files: FileList | null) => {
    if (!files || !tenantId) return;
    setUploadingMedia(true);
    try {
      const newMedia: PostMedia[] = [];
      for (const file of Array.from(files)) {
        const isVideo = file.type.startsWith('video/');
        const type = isVideo ? 'VIDEO' : 'IMAGE';

        // Get presigned upload URL
        const { uploadUrl, key } = await apiPost<{ uploadUrl: string; key: string }>(
          `/api/tenants/${tenantId}/portal/media/upload-url`,
          { filename: file.name },
        );

        // Upload file directly to storage
        await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });

        newMedia.push({
          url: key,
          type: type as 'IMAGE' | 'VIDEO',
          caption: '',
          sortOrder: (editing?.media ?? []).length + newMedia.length,
        });
      }

      updateField('media', [...(editing?.media ?? []), ...newMedia]);
    } finally {
      setUploadingMedia(false);
    }
  }, [tenantId, editing?.media]);

  const removeMedia = (index: number) => {
    updateField('media', (editing?.media ?? []).filter((_, i) => i !== index));
  };

  const updateMediaCaption = (index: number, caption: string) => {
    const media = [...(editing?.media ?? [])];
    media[index] = { ...media[index], caption };
    updateField('media', media);
  };

  // ── Table columns ─────────────────────────────────────────────────────────

  const columns: Column<CmsPost>[] = [
    { key: 'title' as keyof CmsPost, header: t('cms.postTitle'), sortable: true },
    { key: 'authorName' as keyof CmsPost, header: t('cms.author'), sortable: true,
      cellRenderer: (v) => v ? <span className="text-sm">{String(v)}</span> : <span className="text-xs text-slate-400">—</span>,
    },
    { key: 'published' as keyof CmsPost, header: t('cms.status'), sortable: true,
      cellRenderer: (v) => (
        <span className={cn('inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full', v ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400')}>
          {v ? <Eye size={12} /> : <EyeOff size={12} />}
          {v ? t('cms.published') : t('cms.draft')}
        </span>
      ),
    },
    { key: 'tags' as keyof CmsPost, header: t('cms.tags'),
      cellRenderer: (v) => {
        const tags = v as unknown as string[];
        return tags?.length ? (
          <div className="flex flex-wrap gap-1">{tags.slice(0, 3).map(tag => (
            <span key={tag} className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded">{tag}</span>
          ))}{tags.length > 3 && <span className="text-xs text-slate-400">+{tags.length - 3}</span>}</div>
        ) : <span className="text-xs text-slate-400">—</span>;
      },
    },
    { key: 'publishedAt' as keyof CmsPost, header: t('cms.publishedAt'), sortable: true,
      cellRenderer: (v) => v ? <span className="text-xs text-slate-500">{new Date(String(v)).toLocaleDateString()}</span> : <span className="text-xs text-slate-400">—</span>,
    },
    { key: 'media' as keyof CmsPost, header: t('cms.media'),
      cellRenderer: (v) => {
        const media = v as unknown as PostMedia[];
        const imgs = media?.filter(m => m.type === 'IMAGE').length ?? 0;
        const vids = media?.filter(m => m.type === 'VIDEO').length ?? 0;
        if (!imgs && !vids) return <span className="text-xs text-slate-400">—</span>;
        return (
          <span className="text-xs text-slate-500">
            {imgs > 0 && <>{imgs} photo{imgs > 1 ? 's' : ''}</>}
            {imgs > 0 && vids > 0 && ', '}
            {vids > 0 && <>{vids} video{vids > 1 ? 's' : ''}</>}
          </span>
        );
      },
    },
  ];

  const rowActions: RowAction<CmsPost>[] = [
    {
      label:   t('common.edit'),
      icon:    <Pencil size={14} />,
      onClick: openEdit,
    },
    {
      label:   (row) => row.published ? t('cms.unpublish') : t('cms.publish'),
      icon:    (row) => row.published ? <MegaphoneOff size={14} /> : <Megaphone size={14} />,
      onClick: togglePublish,
    },
    {
      label:   t('common.delete'),
      icon:    <Trash2 size={14} />,
      danger:  true,
      onClick: deletePost,
    },
  ];

  // ── Editor view ───────────────────────────────────────────────────────────

  if (editing) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => setEditing(null)} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white">
              <Newspaper size={18} />
            </div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">
              {editing.id ? t('cms.editPost') : t('cms.newPost')}
            </h1>
          </div>
          <div className="flex-1" />
          <Button onClick={savePost} disabled={saving || !editing.title} className="gap-1.5">
            <Save size={14} />
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </div>

        {/* Meta: title, author, locale */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('cms.postTitle')}</label>
            <input type="text" value={editing.title || ''} onChange={e => updateField('title', e.target.value)}
              placeholder={t('cms.postTitlePlaceholder')}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('cms.author')}</label>
            <div className="relative">
              <User size={14} className="absolute left-3 top-2.5 text-slate-400" />
              <input type="text" value={editing.authorName || ''} onChange={e => updateField('authorName', e.target.value)}
                placeholder={t('cms.authorPlaceholder')}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50" />
            </div>
          </div>
        </div>

        {/* Excerpt */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('cms.excerpt')}</label>
          <textarea value={editing.excerpt || ''} onChange={e => updateField('excerpt', e.target.value)}
            rows={2} maxLength={500} placeholder={t('cms.excerptPlaceholder')}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/50 resize-none" />
        </div>

        {/* Tags */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('cms.tags')}</label>
          <div className="flex flex-wrap items-center gap-2">
            {(editing.tags ?? []).map(tag => (
              <span key={tag} className="inline-flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-1 rounded-lg">
                <Tag size={10} /> {tag}
                <button type="button" onClick={() => removeTag(tag)} className="hover:text-red-500"><X size={12} /></button>
              </span>
            ))}
            <input type="text" value={tagInput} onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
              placeholder={t('cms.addTag')}
              className="flex-1 min-w-[120px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
          </div>
        </div>

        {/* Publication options */}
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={editing.published ?? false} onChange={e => updateField('published', e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('cms.publishPost')}</span>
          </label>
          <select value={editing.locale || 'fr'} onChange={e => updateField('locale', e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/50">
            {['fr', 'en', 'es', 'pt', 'ar', 'wo', 'ln', 'ktu'].map(l => (
              <option key={l} value={l}>{l.toUpperCase()}</option>
            ))}
          </select>
        </div>

        {/* Rich text editor */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('cms.content')}</label>
          <RichTextEditor
            value={editing.content || ''}
            onChange={html => updateField('content', html)}
            placeholder={t('cms.contentPlaceholder')}
            minHeight="300px"
          />
        </div>

        {/* Media gallery */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('cms.mediaGallery')}</label>
            <div className="flex gap-2">
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingMedia}
                className="gap-1.5 text-xs"
                variant="outline"
              >
                <ImagePlus size={14} />
                {uploadingMedia ? t('cms.uploading') : t('cms.addMedia')}
              </Button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple hidden
              onChange={e => handleMediaUpload(e.target.files)} />
          </div>

          {(editing.media ?? []).length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {(editing.media ?? []).map((media, idx) => (
                <div key={idx} className="relative group rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-50 dark:bg-slate-800">
                  {media.type === 'IMAGE' ? (
                    <div className="aspect-video bg-slate-100 dark:bg-slate-900 flex items-center justify-center">
                      {media.signedUrl ? (
                        <img src={media.signedUrl} alt={media.caption || ''} className="w-full h-full object-cover" />
                      ) : (
                        <ImagePlus size={24} className="text-slate-300" />
                      )}
                    </div>
                  ) : (
                    <div className="aspect-video bg-slate-900 flex items-center justify-center">
                      <Video size={24} className="text-slate-400" />
                    </div>
                  )}
                  <div className="p-2">
                    <input type="text" value={media.caption || ''} onChange={e => updateMediaCaption(idx, e.target.value)}
                      placeholder={t('cms.captionPlaceholder')}
                      className="w-full text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 focus:outline-none" />
                  </div>
                  <button type="button" onClick={() => removeMedia(idx)}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <X size={12} />
                  </button>
                  <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-black/50 text-white">
                    {media.type}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-8 text-center">
              <Upload size={32} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm text-slate-400">{t('cms.dropMediaHint')}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white">
            <Newspaper size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t('cms.postsTitle')}</h1>
            <p className="text-sm text-slate-500">{t('cms.postsSubtitle')}</p>
          </div>
        </div>
        <Button onClick={openNew} className="gap-1.5">
          <Plus size={14} /> {t('cms.newPost')}
        </Button>
      </div>

      <DataTableMaster
        columns={columns}
        data={postsRes.data ?? []}
        loading={postsRes.loading}
        rowActions={rowActions}
        onRowClick={openEdit}
        emptyMessage={t('cms.noPostsYet')}
        searchPlaceholder={t('cms.searchPosts')}
      />
    </div>
  );
}
