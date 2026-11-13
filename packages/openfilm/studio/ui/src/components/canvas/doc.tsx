/**
 * A note's words, written as a document: headings, lists, quotes, bold, struck, italic, underlined, aligned, drawn as
 * they read while they are written. They are kept as Markdown, as an agent reads and writes them; what Markdown has no
 * mark for is kept as the HTML Markdown allows inside it (`<u>`, a paragraph or heading with its `text-align`).
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { getHTMLFromFragment } from '@tiptap/core';
import { Fragment, type Schema } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import {
  AlignCenter, AlignLeft, AlignRight, Bold, ChevronDown, Download, FileText, Italic, List, ListOrdered, Maximize2, Quote,
  Redo2, Strikethrough, Type as TypeIcon, Underline as UnderlineIcon, Undo2, X,
} from 'lucide-react';
import { useT } from '@/i18n';
import { Tooltip } from '../Tooltip';
import { MENU, MENU_ICON, MENU_ROW } from './menu-style';

type JSONNode = { type?: string; attrs?: Record<string, unknown>; content?: JSONNode[] };
type Render = (node: JSONNode, helpers: never, context: never) => string;

/** a paragraph or heading set other than left: as HTML, its words as HTML too (Markdown is not read inside HTML) */
function asAligned(held: { schema: Schema | null }, tag: string, node: JSONNode) {
  const inner = held.schema ? getHTMLFromFragment(Fragment.fromJSON(held.schema, node.content ?? []), held.schema) : '';
  return `<${tag} style="text-align: ${String(node.attrs?.textAlign)}">${inner}</${tag}>`;
}
const aligned = (node: JSONNode) => {
  const align = node.attrs?.textAlign;
  return typeof align === 'string' && align !== 'left';
};

/** what a note is written with; `held` is given the editor's schema, which writing an aligned line needs */
function docExtensions(held: { schema: Schema | null }, placeholder: () => string) {
  const paragraphMarkdown = Paragraph.config.renderMarkdown as unknown as Render;
  const headingMarkdown = Heading.config.renderMarkdown as unknown as Render;
  return [
    StarterKit.configure({ paragraph: false, heading: false, underline: false, link: { openOnClick: false } }),
    Paragraph.extend({
      renderMarkdown: ((node: JSONNode, h: never, ctx: never) => (aligned(node) ? asAligned(held, 'p', node) : paragraphMarkdown(node, h, ctx))) as never,
    }),
    Heading.extend({
      renderMarkdown: ((node: JSONNode, h: never, ctx: never) => (aligned(node) ? asAligned(held, `h${Number(node.attrs?.level) || 1}`, node) : headingMarkdown(node, h, ctx))) as never,
    }).configure({ levels: [1, 2, 3] }),
    /* underlined as HTML's <u>, which Markdown keeps as it is, not a mark of its own */
    Underline.extend({
      markdownTokenizer: undefined,
      renderMarkdown: ((node: JSONNode, h: { renderChildren: (node: JSONNode) => string }) => `<u>${h.renderChildren(node)}</u>`) as never,
    }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit,
    Placeholder.configure({ placeholder, showOnlyWhenEditable: false }),
    Markdown,
  ];
}

const textOf = (editor: Editor) => editor.getMarkdown().replace(/\s+$/, '');

/**
 * A note's words in an editor: `text` taken in whenever it changes from outside (an agent's words, an undo), what is
 * written sent back to `onChange`; written in only while `editable`.
 */
export function useDoc({ text, editable, placeholder, onChange }: {
  text: string; editable: boolean; placeholder: string; onChange: (text: string) => void;
}) {
  const held = React.useRef<{ schema: Schema | null }>({ schema: null }).current;
  const sent = React.useRef(text);
  const change = React.useRef(onChange);
  change.current = onChange;
  const hint = React.useRef(placeholder);
  hint.current = placeholder;
  const extensions = React.useMemo(() => docExtensions(held, () => hint.current), [held]);
  const editor = useEditor({
    extensions,
    content: text,
    contentType: 'markdown',
    editable,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    /* no spelling marks under the words: they are a script's, a shot list's, often not words a dictionary knows */
    editorProps: { attributes: { spellcheck: 'false' } },
    onBeforeCreate: ({ editor: made }) => { held.schema = made.schema; },
    onUpdate: ({ editor: changed }) => {
      const next = textOf(changed);
      if (next === sent.current) return;
      sent.current = next;
      change.current(next);
    },
  }, []);
  React.useEffect(() => {
    if (!editor || text === sent.current) return;
    sent.current = text;
    editor.commands.setContent(text, { contentType: 'markdown', emitUpdate: false });
  }, [editor, text]);
  React.useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable, false);
    /* the placeholder drawn again for the state it is in */
    editor.view.dispatch(editor.state.tr);
  }, [editor, editable, placeholder]);
  return editor;
}

/** the document's words, drawn as they read */
export function DocView({ editor, large, className = '' }: { editor: Editor | null; large?: boolean; className?: string }) {
  return <EditorContent editor={editor} className={`cv-doc ${large ? 'cv-doc-large' : ''} ${className}`} />;
}

/** Words saved as a Markdown file of that name. */
export function saveText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  Object.assign(document.createElement('a'), { href: url, download: `${name}.md` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const ALIGN = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const;

/**
 * The bar the words are set with: a heading or body text, a list (bulleted, numbered), a quote; the alignment; bold,
 * struck, italic, underlined; undo, redo; and, beside a note, the note opened large. Pressing it leaves the words being
 * written in.
 */
export function FormatBar({ editor, onExpand, large }: { editor: Editor; onExpand?: () => void; large?: boolean }) {
  const t = useT();
  const [menu, setMenu] = React.useState<'level' | 'align' | null>(null);
  const on = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      level: ([1, 2, 3] as const).find((level) => e.isActive('heading', { level })) ?? 0,
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      align: (['center', 'right'] as const).find((align) => e.isActive({ textAlign: align })) ?? 'left',
      bold: e.isActive('bold'),
      strike: e.isActive('strike'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      undo: e.can().undo(),
      redo: e.can().redo(),
    }),
  });
  const run = () => editor.chain().focus();
  const size = large ? 18 : 20;
  const btn = (lit: boolean) => `cv-tool flex ${large ? 'h-8 min-w-8' : 'h-9 min-w-9'} items-center justify-center gap-0.5 rounded-[8px] px-1.5 transition disabled:opacity-30 ${lit ? 'bg-[var(--cv-on)] text-[var(--cv-ink)]' : 'text-[var(--cv-ink)] hover:bg-[var(--cv-float-hover)]'}`;
  const one = (label: string, icon: React.ReactNode, act: () => void, lit = false, disabled = false) => (
    <Tooltip label={label} side="top">
      <button type="button" aria-label={label} aria-pressed={lit} disabled={disabled} onClick={act} className={btn(lit)}>{icon}</button>
    </Tooltip>
  );
  const line = <span className="mx-1 h-5 w-px shrink-0 bg-[var(--cv-float-line)]" />;
  const pick = MENU_ROW;
  const AlignIcon = ALIGN[on.align as keyof typeof ALIGN];
  return (
    /* pressed without taking the words' focus */
    <div data-writing-bar="" className="flex items-center gap-0.5" onMouseDown={(event) => event.preventDefault()}>
      <span className="relative">
        <button type="button" aria-label={t('canvas.words.level')} aria-expanded={menu === 'level'} onClick={() => setMenu(menu === 'level' ? null : 'level')} className={btn(menu === 'level')}>
          <TypeIcon size={size} strokeWidth={1.75} /><ChevronDown size={14} />
        </button>
        {menu === 'level' ? (
          <span className={`${MENU} absolute left-0 top-full z-10 mt-1.5 flex w-[150px] flex-col`}>
            {([0, 1, 2, 3] as const).map((level) => (
              <button key={level} type="button" className={`${pick} ${on.level === level ? 'bg-[var(--cv-float-hover)]' : ''}`}
                onClick={() => { (level ? run().setHeading({ level }) : run().setParagraph()).run(); setMenu(null); }}>
                <span className={level === 1 ? 'text-[16px] font-semibold' : level === 2 ? 'text-[14.5px] font-semibold' : level === 3 ? 'text-[13.5px] font-semibold' : ''}>
                  {level ? t('canvas.words.heading').replace('{n}', String(level)) : t('canvas.words.body')}
                </span>
              </button>
            ))}
          </span>
        ) : null}
      </span>
      {one(t('canvas.words.list'), <List size={size} strokeWidth={1.75} />, () => run().toggleBulletList().run(), on.bullet)}
      {one(t('canvas.words.ordered'), <ListOrdered size={size} strokeWidth={1.75} />, () => run().toggleOrderedList().run(), on.ordered)}
      {one(t('canvas.words.quote'), <Quote size={size} strokeWidth={1.75} />, () => run().toggleBlockquote().run(), on.quote)}
      {line}
      <span className="relative">
        <button type="button" aria-label={t('canvas.words.align')} aria-expanded={menu === 'align'} onClick={() => setMenu(menu === 'align' ? null : 'align')} className={btn(menu === 'align')}>
          <AlignIcon size={size} strokeWidth={1.75} /><ChevronDown size={14} />
        </button>
        {menu === 'align' ? (
          <span className={`${MENU} absolute left-0 top-full z-10 mt-1.5 flex w-[150px] flex-col`}>
            {(['left', 'center', 'right'] as const).map((align) => {
              const Icon = ALIGN[align];
              return (
                <button key={align} type="button" className={`${pick} ${on.align === align ? 'bg-[var(--cv-float-hover)]' : ''}`}
                  onClick={() => { run().setTextAlign(align).run(); setMenu(null); }}>
                  <Icon size={MENU_ICON} />{t(`canvas.words.${align}`)}
                </button>
              );
            })}
          </span>
        ) : null}
      </span>
      {line}
      {one(t('canvas.words.bold'), <Bold size={size} strokeWidth={1.75} />, () => run().toggleBold().run(), on.bold)}
      {one(t('canvas.words.strike'), <Strikethrough size={size} strokeWidth={1.75} />, () => run().toggleStrike().run(), on.strike)}
      {one(t('canvas.words.italic'), <Italic size={size} strokeWidth={1.75} />, () => run().toggleItalic().run(), on.italic)}
      {one(t('canvas.words.underline'), <UnderlineIcon size={size} strokeWidth={1.75} />, () => run().toggleUnderline().run(), on.underline)}
      {line}
      {one(t('canvas.keys.undo'), <Undo2 size={size - 2} strokeWidth={1.75} />, () => run().undo().run(), false, !on.undo)}
      {one(t('canvas.keys.redo'), <Redo2 size={size - 2} strokeWidth={1.75} />, () => run().redo().run(), false, !on.redo)}
      {onExpand ? (
        <>
          {line}
          {one(t('canvas.words.expand'), <Maximize2 size={size - 1} strokeWidth={1.75} />, onExpand)}
        </>
      ) : null}
    </div>
  );
}

/**
 * A note opened large, over the whole window. Its top is a title bar like the app's: clear of the window's own buttons
 * and dragging the window, with the note's name as a Markdown file (a double click renames it), its download and the ×.
 * Under it, the bar and the words in a page's column. Closed with the ×, or Escape. Without `onChange` it only shows
 * them (a Markdown file added to a note's panel): no bar, nothing written.
 */
export function DocSheet({ name, text, onChange, onRename, onClose }: {
  name: string; text: string; onChange?: (text: string) => void; onRename?: (name: string) => void; onClose: () => void;
}) {
  const t = useT();
  const editor = useDoc({ text, editable: Boolean(onChange), placeholder: t('canvas.words.placeholder'), onChange: onChange ?? (() => {}) });
  const [draft, setDraft] = React.useState<string | null>(null);
  const cancel = React.useRef(false);
  React.useEffect(() => { if (onChange) editor?.commands.focus('end'); }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || (event.target as Element | null)?.closest?.('[data-sheet-name]')) return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  /* a note's name as a Markdown file; a file's own name as it is */
  const file = /\.(md|markdown|txt)$/i.test(name) ? name : `${name}.md`;
  const done = () => {
    if (draft !== null && !cancel.current && draft.trim() !== name) onRename?.(draft.trim());
    setDraft(null);
  };
  return createPortal(
    <div role="dialog" aria-label={file} className="cv-fade fixed inset-0 z-[300] flex flex-col bg-[var(--cv-sheet-back)] text-[var(--cv-ink)]"
      onKeyDown={(event) => event.stopPropagation()}>
      <header data-titlebar="" className="flex h-8 shrink-0 items-center gap-1.5"
        style={{ paddingLeft: 'calc(var(--titlebar-logo-x) + 8px)', paddingRight: 'max(var(--titlebar-right-x, 0px), 8px)' }}>
        <FileText size={14} className="shrink-0 text-[var(--cv-ink-2)]" />
        {draft !== null ? (
          <input data-sheet-name="" autoFocus maxLength={120} aria-label={t('canvas.video.rename')} value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)} onFocus={(event) => event.currentTarget.select()} onBlur={done}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Escape') { cancel.current = true; event.currentTarget.blur(); }
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
            size={Math.max(2, draft.length)}
            className="h-6 min-w-[3ch] max-w-[320px] rounded-[6px] bg-[var(--cv-chip)] px-1.5 text-[13px] font-medium text-[var(--cv-ink)] outline outline-1 outline-[var(--cv-ring)] [field-sizing:content]" />
        ) : (
          <span role={onRename ? 'button' : undefined} tabIndex={onRename ? 0 : undefined} title={onRename ? t('canvas.video.renameHint') : undefined}
            onDoubleClick={() => { if (onRename) { cancel.current = false; setDraft(name); } }}
            onKeyDown={(event) => { if (onRename && (event.key === 'Enter' || event.key === 'F2')) { event.preventDefault(); cancel.current = false; setDraft(name); } }}
            className="min-w-0 max-w-[320px] truncate rounded-[4px] px-0.5 text-[13px] font-medium">{file}</span>
        )}
        <span className="flex-1" />
        <button type="button" onClick={() => saveText(file.replace(/\.(md|markdown)$/i, ''), editor ? textOf(editor) : text)}
          className="cv-tool flex h-6 items-center gap-1 rounded-[7px] bg-[var(--cv-chip)] px-2.5 text-[12.5px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]">
          <Download size={13} />{t('canvas.actions.download')}
        </button>
        <button type="button" aria-label={t('canvas.outline.close')} onClick={onClose}
          className="cv-tool flex h-6 w-7 items-center justify-center rounded-[7px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]"><X size={16} /></button>
      </header>
      <div className="cv-grow mx-3 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] bg-[var(--cv-sheet)] shadow-[var(--cv-float-shadow)]">
        {editor && onChange ? (
          <div className="flex h-12 shrink-0 items-center justify-center border-b !border-[var(--cv-float-line)]">
            <FormatBar editor={editor} large />
          </div>
        ) : null}
        <div className={`min-h-0 flex-1 overflow-y-auto ${onChange ? 'cursor-text' : ''}`} onMouseDown={(event) => { if (onChange && event.target === event.currentTarget) { event.preventDefault(); editor?.commands.focus('end'); } }}>
          <DocView editor={editor} large className="mx-auto w-full max-w-[860px] px-10 py-8" />
        </div>
      </div>
    </div>,
    document.body,
  );
}
