/**
 * A page clip's Properties: what its page offers to change, each a property the person made of one of its layers (its
 * words, its picture, whether it shows) or of one of its CSS variables (lib/component-props), as a design tool's
 * component offers its properties. Only those, none worked out on their own. Each field paints first and writes when
 * let go, as every inspector field does; what a clip fills in is an override, and a property can go back to its
 * default. Its name is the person's: renamed with a double-click, removed from its menu. A pointer on a row outlines
 * its layer on the picture.
 */
import * as React from 'react';
import { HardDriveUpload, ImageIcon, Plus, RotateCcw } from 'lucide-react';

import { useT } from '@/i18n';
import type { FilmOverride } from '@/lib/film';
import {
  ROOT, fieldOf, isFontVar, labelOf, pathIsAt, relativeTo, valueOf, type TemplateControls, type VarField,
} from '@/lib/template-controls';
import {
  propOf, propValue, renamedProp, withProp, withPropValue, withPropsReset, withoutProp, type ComponentProp, type PropValue,
} from '@/lib/component-props';
import { joinFontFamily, splitFontFamily } from '@/lib/font-styles';
import { isLibraryClip } from '@/lib/library';
import { readResourceDragData, RESOURCE_DRAG_TYPE } from '@/lib/resource-drag';
import { ColorField, FIELD, INPUT, NumField, Section, SectionAction } from './inspector-fields';
import { FontFamilyPicker } from './FontFamilyPicker';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { pictureThumb } from './stage-menu';
import { Tooltip } from './Tooltip';

type T = ReturnType<typeof useT>;

/** What the section needs of the clip: its page as it is on the picture, its overrides and properties, the picture. */
export interface PropsHost {
  /** What the page shows now (its variables, words and pictures); null when the clip is not on the picture now. */
  read: () => Promise<TemplateControls | null>;
  overrides: () => readonly FilmOverride[] | undefined;
  /** The clip's properties (its data-props). */
  props: () => readonly ComponentProp[];
  /** Write the clip's properties. */
  setProps: (next: readonly ComponentProp[]) => void;
  /** Paints a change without writing it; null takes it back. */
  preview: (target: { at: string; n?: number }, patch: { style?: Record<string, string>; text?: string } | null) => void;
  /** The page's file, by its place in the project: a picture put in is named from its folder. */
  page: string;
  /** The project's pictures, by their place in the project, each with where its thumbnail is read from. */
  pictures: () => Array<{ path: string; name: string; url?: string }>;
  /** One from this computer, brought into the project: its place there (null: none picked). */
  pickPicture?: () => Promise<string | null>;
  /** Outline a layer of the page on the picture (a row pointed at); null: none. */
  point?: (target: { at: string; n?: number } | null) => void;
  /**
   * A line of words, whose box follows its words: a preview of its look refits its box as it goes, and a write needs no
   * take-back first (`settle` drops the previews not shown yet, so none comes after it).
   */
  fits?: boolean;
  settle?: () => void;
  /** Play the part of the clip a motion is in (its way in, its loop, its way out), so a change to it is seen. */
  playMotion?: (slot: 'in' | 'loop' | 'out') => void;
}

const PICTURE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i;

/* a page clip off the picture is read again now and then: the playhead may come to it */
const OFF_PICTURE_EVERY_MS = 1500;

const isNamedColor = (v: string) => typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('color', v);

const sameAt = (a: { at: string; n?: number }, b: { at: string; n?: number }) => a.at === b.at && (a.n ?? null) === (b.n ?? null);

export function PropertiesSection({ host, commit }: {
  host: PropsHost;
  /** Writes the clip's next overrides (null: none left). */
  commit: (next: FilmOverride[] | null) => void;
}) {
  const t = useT();
  const [controls, setControls] = React.useState<TemplateControls | null | undefined>(undefined);
  const [menu, setMenu] = React.useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const overrides = host.overrides();
  const props = host.props();
  /* a clip's length is Studio's to keep (studio/server/ops.mjs), not the person's to set: not shown */
  const shown = props.filter((p) => !(p.type === 'var' && p.var === '--clip-length'));
  const advanced = shown.filter((p) => p.type === 'var' && p.advanced);
  const ordinary = shown.filter((p) => !(p.type === 'var' && p.advanced));
  const kept = JSON.stringify(overrides ?? []);
  React.useEffect(() => {
    let live = true;
    let timer = 0;
    const read = () => {
      void host.read().catch(() => null).then((next) => {
        if (!live) return;
        setControls((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
        if (!next) timer = window.setTimeout(read, OFF_PICTURE_EVERY_MS);
      });
    };
    /* the picture shows a written change a moment after it is kept */
    timer = window.setTimeout(read, 120);
    return () => { live = false; window.clearTimeout(timer); };
  }, [host, kept]);
  /* nothing stays outlined once the section goes (another clip in hand) */
  React.useEffect(() => () => { host.point?.(null); }, [host]);

  const set = (prop: ComponentProp, value: PropValue | null) => commit(withPropValue(overrides, prop, value));
  /* the page's variables not offered yet: what the + offers */
  const vars = (controls?.vars ?? []).filter((v) => !propOf(props, 'var', v.name));
  const add = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({
      x: r.left, y: r.bottom + 4,
      items: vars.length
        ? vars.map((v) => ({ id: `var:${v.name}`, label: labelOf(v.name), hint: v.name, onSelect: () => host.setProps(withProp(props, { name: labelOf(v.name), type: 'var', var: v.name })) }))
        : [{ id: 'no-vars', label: t('inspector.propsNoVars'), disabled: true, onSelect: () => {} }],
    });
  };
  const rowMenu = (e: React.MouseEvent, prop: ComponentProp) => {
    e.preventDefault();
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { id: 'rename', label: t('inspector.propRename'), onSelect: () => setRenaming(prop.name) },
        { id: 'remove', label: t('inspector.propRemove'), onSelect: () => host.setProps(withoutProp(props, prop.name)) },
      ],
    });
  };
  const pointing = (prop: ComponentProp) => {
    const target = prop.type === 'var' ? null : { at: prop.at, ...(prop.n ? { n: prop.n } : {}) };
    return target ? {
      onPointerEnter: () => host.point?.(target),
      onPointerLeave: () => host.point?.(null),
      onFocus: () => host.point?.(target),
      onBlur: () => host.point?.(null),
    } : {};
  };

  const field = (prop: ComponentProp): React.ReactNode => {
    const value = propValue(overrides, prop);
    switch (prop.type) {
      case 'text': {
        /* the page's own words: by the property's selector, else by the path the stage names them by */
        const own = (controls?.texts.find((x) => sameAt(x, prop)) ?? controls?.texts.find((x) => (x.n ?? null) === (prop.n ?? null) && pathIsAt(x.at, prop.at)))?.value ?? '';
        const target = { at: prop.at, ...(prop.n ? { n: prop.n } : {}) };
        return (
          <WordsInput
            label={prop.name}
            value={typeof value === 'string' ? value : own}
            onCommit={(next) => set(prop, next === own ? null : next)}
            onPreview={(next) => host.preview(target, next == null ? null : { text: next })}
          />
        );
      }
      case 'image': {
        const own = controls?.images?.find((x) => sameAt(x, prop))?.src ?? '';
        /* what it draws now: the picture put in, read from the page's folder, else the page's own */
        const src = typeof value === 'string' && controls?.page ? new URL(value, controls.page).href : own;
        return <PictureInput src={src} host={host} label={prop.name} onPick={(path) => set(prop, relativeTo(host.page, path))} t={t} />;
      }
      case 'boolean':
        return <Switch label={prop.name} on={value !== false} onChange={(on) => set(prop, on ? null : false)} />;
      case 'var': {
        const own = controls?.vars.find((v) => v.name === prop.var)?.value ?? '';
        const now = typeof value === 'string' ? value : own;
        const paint = (next: string | null) => {
          if (!prop.advanced) host.preview({ at: ROOT }, next == null ? null : { style: { [prop.var]: next } });
        };
        return isFontVar(prop.var, now)
          ? <FontInput label={prop.name} value={now} onCommit={(next) => set(prop, next)} onPreview={paint} />
          : <VarInput name={prop.name} field={fieldOf(now, isNamedColor)} onCommit={(next) => set(prop, next)} onPreview={paint} />;
      }
    }
  };

  /* a thing of the library is one thing (its layers are not picked one by one): with nothing it offers, no section
     telling how to make a property of a layer of it */
  if (!shown.length && isLibraryClip(host.page)) return null;

  const section = (list: ComponentProp[], isAdvanced: boolean) => (
    <Section
      id={isAdvanced ? 'advanced-properties' : 'properties'}
      title={t(isAdvanced ? 'inspector.advancedProperties' : 'inspector.props')}
      aside={(
        <span className="flex items-center">
          {list.some((p) => propValue(overrides, p) != null) ? (
            <SectionAction label={t('inspector.propsResetAll')} onClick={() => commit(withPropsReset(overrides, list))}><RotateCcw size={11} /></SectionAction>
          ) : null}
          {!isAdvanced ? <Tooltip label={t('inspector.propsAdd')}>
            <button type="button" aria-label={t('inspector.propsAdd')} onClick={add} className="flex h-5 w-5 items-center justify-center rounded-[4px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
              <Plus size={12} />
            </button>
          </Tooltip> : null}
        </span>
      )}
    >
      {!list.length ? (
        <p className="text-[10.5px] leading-[15px] text-[var(--text-faint)]">{t('inspector.propsEmpty')}</p>
      ) : list.map((prop) => (
        <div key={prop.name} {...pointing(prop)} onContextMenu={(e) => rowMenu(e, prop)}>
          <Line
            label={renaming === prop.name ? (
              <NameInput
                value={prop.name}
                onDone={(next) => { setRenaming(null); host.setProps(renamedProp(props, prop.name, next)); }}
                onCancel={() => setRenaming(null)}
              />
            ) : prop.name}
            title={t('inspector.propRenameHint')}
            onRename={() => setRenaming(prop.name)}
            changed={propValue(overrides, prop) != null}
            onReset={() => set(prop, null)}
            t={t}
          >
            {field(prop)}
          </Line>
        </div>
      ))}
      {!controls && list.length ? (
        <p className="text-[10.5px] leading-[15px] text-[var(--text-faint)]">{t('inspector.templateOffPicture')}</p>
      ) : null}
    </Section>
  );
  return <>
    {ordinary.length || !isLibraryClip(host.page) ? section(ordinary, false) : null}
    {advanced.length ? section(advanced, true) : null}
    {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
  </>;
}

/** A property's name typed anew: kept on Enter or when left, Esc gives up. */
function NameInput({ value, onDone, onCancel }: { value: string; onDone: (next: string) => void; onCancel: () => void }) {
  const [raw, setRaw] = React.useState(value);
  const done = React.useRef(false);
  return (
    <input
      autoFocus
      value={raw}
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={() => { if (!done.current) { done.current = true; onDone(raw); } }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) { done.current = true; onDone(raw); }
        if (e.key === 'Escape') { done.current = true; onCancel(); }
      }}
      className="h-5 w-full min-w-0 rounded-[4px] bg-[var(--bg-panel)] px-1 text-[11px] text-[var(--text)] outline-none ring-1 ring-[var(--accent)]"
    />
  );
}

/** Shown or not: a switch. */
function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className="flex h-6 items-center">
      <span aria-hidden className={`relative h-[16px] w-[28px] shrink-0 rounded-full transition-colors ${on ? 'bg-[var(--switch-on)]' : 'bg-[var(--bg-field)] ring-1 ring-inset ring-[var(--border)]'}`}>
        <span className={`absolute top-[3px] h-2.5 w-2.5 rounded-full transition-all ${on ? 'left-[15px] bg-white' : 'left-[3px] bg-[var(--text-faint)]'}`} />
      </span>
    </button>
  );
}

/** A picture: its thumbnail and name; clicked, the project's pictures and one from this computer; a picture dropped. */
export function PictureInput({ src, host, label, onPick, t }: {
  src: string; host: Pick<PropsHost, 'pictures' | 'pickPicture'>; label: string; onPick: (path: string) => void; t: T;
}) {
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);
  const [over, setOver] = React.useState(false);
  const name = decodeURIComponent(src.split(/[?#]/)[0]!.split('/').pop() ?? '');
  const entries = (): ContextMenuEntry[] => {
    const list = host.pictures().slice(0, 40);
    const pick = host.pickPicture;
    return [
      ...list.map((f) => ({ id: `pic:${f.path}`, label: f.name, icon: pictureThumb(f.url), onSelect: () => onPick(f.path) })),
      ...(pick ? [
        ...(list.length ? [{ id: 'pic-sep', separator: true as const }] : []),
        { id: 'pic-computer', label: t('inspector.templatePictureComputer'), icon: <HardDriveUpload size={14} />, onSelect: () => { void pick().then((path) => { if (path && PICTURE.test(path)) onPick(path); }); } },
      ] : []),
    ];
  };
  return (
    <>
      <button
        type="button"
        aria-label={`${label}: ${t('inspector.templatePictureReplace')}`}
        title={t('inspector.templatePictureReplace')}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }); }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes(RESOURCE_DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          const file = readResourceDragData(e.dataTransfer);
          if (!file || file.saved || !PICTURE.test(file.path)) return;
          e.preventDefault();
          onPick(file.path);
        }}
        className={`${FIELD} gap-1.5 px-1 text-left ${over ? 'ring-[1.5px] ring-[var(--accent)]' : ''}`}
      >
        <span className="flex h-[18px] w-[28px] shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-[var(--bg-hover)]">
          {src ? <img src={src} alt="" className="h-full w-full object-cover" draggable={false} /> : <ImageIcon size={12} />}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text)]">{name}</span>
      </button>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={entries()} onClose={() => setMenu(null)} /> : null}
    </>
  );
}

/** A custom property that names a font: the font picker over its first family, the fallbacks after it kept. */
function FontInput({ label, value, onCommit, onPreview }: {
  label: string; value: string; onCommit: (value: string) => void; onPreview: (value: string | null) => void;
}) {
  const [family, rest] = splitFontFamily(value);
  return (
    <FontFamilyPicker
      label={label}
      value={family}
      sample=""
      onPreview={(next) => onPreview(joinFontFamily(next, rest))}
      onRevert={() => onPreview(null)}
      onCommit={(next) => onCommit(joinFontFamily(next, rest))}
      className={FIELD}
    />
  );
}

/** A property: its name on the left (a double-click renames it), its field, and going back to its default. */
function Line({ label, title, changed, onReset, onRename, t, children }: {
  label: React.ReactNode; title: string; changed: boolean; onReset: () => void; onRename: () => void; t: T; children: React.ReactNode;
}) {
  const reset = changed ? (
    <SectionAction label={t('inspector.propReset')} onClick={onReset}><RotateCcw size={11} /></SectionAction>
  ) : <span className="w-5" />;
  const name = (
    <span className="min-w-0 truncate text-[11px] text-[var(--text-muted)]" title={title} onDoubleClick={onRename}>
      {changed ? <span aria-hidden className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)] align-middle" /> : null}
      {label}
    </span>
  );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_20px] items-center gap-1.5">
      {name}
      <div className="min-w-0">{children}</div>
      {reset}
    </div>
  );
}

/** A custom property's field by its kind: a color, a number with its unit, or words. */
function VarInput({ name, field, onCommit, onPreview }: {
  name: string;
  field: VarField;
  onCommit: (value: string) => void;
  onPreview: (value: string | null) => void;
}) {
  const label = labelOf(name);
  if (field.kind === 'color') {
    return <ColorField label={label} value={field.value} onCommit={onCommit} onPreview={onPreview} />;
  }
  if (field.kind === 'number') {
    const step = Number.isInteger(field.value) && Math.abs(field.value) >= 2 ? 1 : 0.1;
    return (
      <NumField
        label={label}
        bare
        value={field.value}
        step={step}
        {...(field.unit ? { unit: field.unit } : {})}
        onCommit={(n) => onCommit(valueOf({ ...field, value: n }))}
        onPreview={(n) => onPreview(valueOf({ ...field, value: n }))}
        onRevert={() => onPreview(null)}
      />
    );
  }
  return (
    <TypedInput
      label={label}
      value={field.value}
      onCommit={(v) => onCommit(valueOf({ ...field, value: v }))}
    />
  );
}

/** One line typed and kept when left or on Enter; Esc gives up. */
function TypedInput({ label, value, onCommit }: { label: string; value: string; onCommit: (value: string) => void }) {
  const [raw, setRaw] = React.useState(value);
  React.useEffect(() => setRaw(value), [value]);
  const cancelled = React.useRef(false);
  return (
    <div className={FIELD}>
      <input
        aria-label={label}
        value={raw}
        spellCheck={false}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={() => {
          if (cancelled.current) { cancelled.current = false; return; }
          if (raw.trim() && raw !== value) onCommit(raw);
          else setRaw(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { cancelled.current = true; setRaw(value); (e.target as HTMLInputElement).blur(); }
        }}
        className={`${INPUT} pl-2`}
      />
    </div>
  );
}

/** A layer's words: the picture follows as they are typed, kept when left or on Enter (Shift+Enter: a new line). */
function WordsInput({ label, value, onCommit, onPreview }: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  onPreview: (value: string | null) => void;
}) {
  const [raw, setRaw] = React.useState(value);
  const typing = React.useRef(false);
  React.useEffect(() => { if (!typing.current) setRaw(value); }, [value]);
  const cancelled = React.useRef(false);
  return (
    <textarea
      aria-label={label}
      value={raw}
      rows={Math.min(4, Math.max(1, raw.split('\n').length))}
      onChange={(e) => { typing.current = true; setRaw(e.target.value); onPreview(e.target.value); }}
      onBlur={() => {
        typing.current = false;
        if (cancelled.current) { cancelled.current = false; return; }
        if (raw !== value) onCommit(raw);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
        if (e.key === 'Escape') {
          cancelled.current = true;
          typing.current = false;
          setRaw(value);
          onPreview(null);
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      className="w-full resize-none rounded-[5px] bg-[var(--bg-field)] px-2 py-1 text-[11.5px] leading-[1.5] text-[var(--text)] outline-none ring-1 ring-inset ring-transparent transition hover:ring-[var(--border)] focus:bg-[var(--bg-panel)] focus:ring-[1.5px] focus:ring-[var(--accent)]"
    />
  );
}
