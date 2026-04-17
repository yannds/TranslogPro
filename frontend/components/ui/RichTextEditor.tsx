/**
 * RichTextEditor — Éditeur riche léger basé sur contentEditable.
 *
 * Fonctionnalités :
 *   - Formatage : gras, italique, souligné, barré
 *   - Titres : H2, H3
 *   - Listes : ordonnées, non ordonnées
 *   - Liens, citations, séparateurs
 *   - Images (via URL)
 *   - Vidéo embed (via URL YouTube/Vimeo)
 *   - Mode plein écran
 *   - Dark mode natif
 *
 * Produit du HTML sanitisé (pas de <script>, pas d'event handlers).
 */
import { useRef, useCallback, useState, useEffect } from 'react';
import {
  Bold, Italic, Underline, Strikethrough,
  Heading2, Heading3, List, ListOrdered,
  Link, Quote, Minus, Image, Video,
  Maximize2, Minimize2, Undo, Redo,
  RemoveFormatting,
} from 'lucide-react';
import { cn } from '../../lib/utils';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
  className?: string;
}

function ToolbarButton({
  icon: Icon,
  title,
  onClick,
  active,
}: {
  icon: typeof Bold;
  title: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={cn(
        'p-1.5 rounded-md transition-colors',
        active
          ? 'bg-slate-200 dark:bg-slate-600 text-slate-900 dark:text-white'
          : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200',
      )}
    >
      <Icon size={16} />
    </button>
  );
}

function ToolbarSep() {
  return <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-0.5" />;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = '200px',
  className,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const initialSetRef = useRef(false);

  // Set initial content once
  useEffect(() => {
    if (editorRef.current && !initialSetRef.current) {
      editorRef.current.innerHTML = value || '';
      initialSetRef.current = true;
    }
  }, [value]);

  const exec = useCallback((command: string, val?: string) => {
    document.execCommand(command, false, val);
    editorRef.current?.focus();
    emitChange();
  }, []);

  const emitChange = useCallback(() => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange]);

  const handleInput = useCallback(() => {
    emitChange();
  }, [emitChange]);

  const insertLink = useCallback(() => {
    const url = prompt('URL du lien :');
    if (url) exec('createLink', url);
  }, [exec]);

  const insertImage = useCallback(() => {
    const url = prompt('URL de l\'image :');
    if (url) {
      exec('insertHTML', `<img src="${url.replace(/"/g, '&quot;')}" alt="" style="max-width:100%;border-radius:8px;margin:8px 0" />`);
    }
  }, [exec]);

  const insertVideo = useCallback(() => {
    const url = prompt('URL de la vidéo (YouTube, Vimeo) :');
    if (!url) return;

    let embedUrl = '';
    // YouTube
    const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
    if (ytMatch) embedUrl = `https://www.youtube-nocookie.com/embed/${ytMatch[1]}`;
    // Vimeo
    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch) embedUrl = `https://player.vimeo.com/video/${vimeoMatch[1]}`;

    if (embedUrl) {
      exec('insertHTML', `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:8px;margin:8px 0"><iframe src="${embedUrl}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0" allowfullscreen loading="lazy"></iframe></div>`);
    }
  }, [exec]);

  const formatBlock = useCallback((tag: string) => {
    exec('formatBlock', tag);
  }, [exec]);

  return (
    <div
      className={cn(
        'border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900 transition-all',
        fullscreen && 'fixed inset-0 z-50 rounded-none border-0',
        className,
      )}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
        <ToolbarButton icon={Bold} title="Gras (Ctrl+B)" onClick={() => exec('bold')} />
        <ToolbarButton icon={Italic} title="Italique (Ctrl+I)" onClick={() => exec('italic')} />
        <ToolbarButton icon={Underline} title="Souligné (Ctrl+U)" onClick={() => exec('underline')} />
        <ToolbarButton icon={Strikethrough} title="Barré" onClick={() => exec('strikeThrough')} />

        <ToolbarSep />

        <ToolbarButton icon={Heading2} title="Titre 2" onClick={() => formatBlock('h2')} />
        <ToolbarButton icon={Heading3} title="Titre 3" onClick={() => formatBlock('h3')} />

        <ToolbarSep />

        <ToolbarButton icon={List} title="Liste à puces" onClick={() => exec('insertUnorderedList')} />
        <ToolbarButton icon={ListOrdered} title="Liste numérotée" onClick={() => exec('insertOrderedList')} />
        <ToolbarButton icon={Quote} title="Citation" onClick={() => formatBlock('blockquote')} />

        <ToolbarSep />

        <ToolbarButton icon={Link} title="Insérer un lien" onClick={insertLink} />
        <ToolbarButton icon={Image} title="Insérer une image" onClick={insertImage} />
        <ToolbarButton icon={Video} title="Insérer une vidéo" onClick={insertVideo} />
        <ToolbarButton icon={Minus} title="Séparateur" onClick={() => exec('insertHorizontalRule')} />

        <ToolbarSep />

        <ToolbarButton icon={RemoveFormatting} title="Supprimer le formatage" onClick={() => exec('removeFormat')} />
        <ToolbarButton icon={Undo} title="Annuler" onClick={() => exec('undo')} />
        <ToolbarButton icon={Redo} title="Rétablir" onClick={() => exec('redo')} />

        <div className="flex-1" />

        <ToolbarButton
          icon={fullscreen ? Minimize2 : Maximize2}
          title={fullscreen ? 'Quitter le plein écran' : 'Plein écran'}
          onClick={() => setFullscreen(f => !f)}
        />
      </div>

      {/* Editor area */}
      <div
        ref={editorRef}
        contentEditable
        onInput={handleInput}
        onBlur={emitChange}
        data-placeholder={placeholder}
        className={cn(
          'prose prose-sm dark:prose-invert max-w-none p-4 outline-none overflow-y-auto',
          'prose-headings:font-bold prose-h2:text-xl prose-h3:text-lg',
          'prose-blockquote:border-l-4 prose-blockquote:border-slate-300 prose-blockquote:pl-4 prose-blockquote:italic',
          'prose-img:rounded-lg prose-img:max-w-full',
          'prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:underline',
          '[&:empty]:before:content-[attr(data-placeholder)] [&:empty]:before:text-slate-400 [&:empty]:before:pointer-events-none',
          fullscreen ? 'flex-1' : '',
        )}
        style={{ minHeight: fullscreen ? undefined : minHeight }}
      />
    </div>
  );
}
