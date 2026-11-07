/**
 * Settings › Keyboard shortcuts: the editor's actions (lib/keymap) in tabs (Timeline, Player, Basic, Other), two
 * columns of an action and its keys, and the scheme they come from: OpenFilm, Premiere Pro, Final Cut Pro X, or one of
 * three custom ones.
 *
 * A built-in scheme is read-only: clicking a key there copies the scheme into a free custom slot first, and says so.
 * In a custom scheme a click records the next keys pressed (Esc cancels); keys another action has are offered to it
 * only after "Replace". Restore defaults sets the custom scheme back to the scheme it was copied from. Nothing is kept
 * until Save; Cancel lets the changes go.
 */
import React from 'react';
import { X } from 'lucide-react';
import { useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import {
  ACTIONS, BUILT_IN_SCHEMES, comboCaps, comboOf, conflictOf, copyOf, CUSTOM_SLOTS, editable, FIXED_KEYS, isBuiltIn, KEY_TABS,
  keymapFor, restoreDefaults, withKey, withoutKeys, type ActionId, type CustomSlot, type KeyPrefs, type KeyTab, type SchemeId,
} from '@/lib/keymap';
import { MAC, saveKeyPrefs, useKeyPrefs } from '@/lib/keymap-store';
import { SettingsSelect } from './SettingsSelect';
import { SettingsButton, SettingsPage, SettingsSegmented, settingsError } from './ui';

/** The built-in schemes are named for the app whose keys they give. */
const SCHEME_NAMES: Record<(typeof BUILT_IN_SCHEMES)[number], string> = { openfilm: 'OpenFilm', premiere: 'Premiere Pro', fcp: 'Final Cut Pro X' };

/** A row: its words and keys; `held`: combinations pressed while another is held (K, then J). */
type Row = { id: string; label: string; keys: readonly string[]; action?: ActionId; held?: readonly (readonly string[])[] };

/** A combination as key caps: its modifiers, then its key. */
function Caps({ combo }: { combo: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {comboCaps(combo, MAC).map((cap, i) => (
        <kbd key={i} className="inline-flex h-6 min-w-6 items-center justify-center rounded-[5px] border border-[var(--border)] bg-[var(--bg-panel)] px-1.5 font-sans text-[12.5px] leading-none text-[var(--text-muted)]">
          {cap}
        </kbd>
      ))}
    </span>
  );
}

/** An action's keys, one combination after another. */
function KeyList({ keys, none }: { keys: readonly string[]; none: string }) {
  if (!keys.length) return <span className="text-[13px] text-[var(--text-faint)]">{none}</span>;
  return (
    <span className="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1">
      {keys.map((combo, i) => (
        <React.Fragment key={combo}>
          {i > 0 ? <span className="text-[12px] text-[var(--text-faint)]">/</span> : null}
          <Caps combo={combo} />
        </React.Fragment>
      ))}
    </span>
  );
}

export function ShortcutsSection() {
  const t = useT();
  const saved = useKeyPrefs();
  const [draft, setDraft] = React.useState<KeyPrefs>(saved);
  const [tab, setTab] = React.useState<KeyTab>('timeline');
  const [recording, setRecording] = React.useState<ActionId | null>(null);
  const [pending, setPending] = React.useState<{ id: ActionId; combo: string; other: ActionId } | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  /* the schemes kept changed elsewhere while nothing here is changed: show them */
  const dirtyRef = React.useRef(dirty);
  dirtyRef.current = dirty;
  React.useEffect(() => { if (!dirtyRef.current) setDraft(saved); }, [saved]);

  const schemeName = React.useCallback((id: SchemeId) => (isBuiltIn(id) ? SCHEME_NAMES[id] : t('settings.shortcuts.customName').replace('{n}', id.slice(-1))), [t]);
  const actionName = React.useCallback((id: ActionId) => t(`settings.shortcuts.actions.${id}`), [t]);
  const keymap = React.useMemo(() => keymapFor(draft, draft.scheme, MAC), [draft]);
  const custom = isBuiltIn(draft.scheme) ? null : draft.scheme as CustomSlot;

  /* a key pressed while recording is the action's new key; Esc stops recording, a click anywhere else too */
  const recordRef = React.useRef<(combo: string) => void>(() => {});
  recordRef.current = (combo) => {
    if (!recording || !custom) return;
    setRecording(null);
    const other = conflictOf(keymap, recording, combo, MAC);
    if (other) setPending({ id: recording, combo, other });
    else setDraft((d) => withKey(d, custom, recording, combo, MAC));
  };
  React.useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) { setRecording(null); return; }
      const combo = comboOf(e, MAC);
      if (combo) recordRef.current(combo);
    };
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.(`[data-recording]`)) setRecording(null);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); };
  }, [recording]);

  const chooseScheme = (id: SchemeId) => {
    setRecording(null);
    setPending(null);
    setError(null);
    if (!isBuiltIn(id) && !draft.custom[id]) {
      /* an empty custom slot starts as a copy of the scheme shown */
      setDraft({ scheme: id, custom: { ...draft.custom, [id]: copyOf(draft, draft.scheme, MAC) } });
      setNotice(t('settings.shortcuts.started').replace('{to}', schemeName(id)).replace('{from}', schemeName(draft.scheme)));
      return;
    }
    setDraft({ ...draft, scheme: id });
    setNotice(null);
  };

  const startRecording = (id: ActionId) => {
    setPending(null);
    setError(null);
    if (custom) { setNotice(null); setRecording(id); return; }
    const ready = editable(draft, MAC);
    if (!ready) { setNotice(t('settings.shortcuts.full')); return; }
    setDraft(ready.prefs);
    setNotice(t('settings.shortcuts.copied').replace('{from}', schemeName(draft.scheme)).replace('{to}', schemeName(ready.slot)));
    setRecording(id);
  };

  const replace = () => {
    if (!pending || !custom) return;
    setDraft((d) => withKey(d, custom, pending.id, pending.combo, MAC));
    setPending(null);
  };

  const restore = () => {
    if (!custom) return;
    setRecording(null);
    setPending(null);
    setNotice(null);
    setDraft((d) => restoreDefaults(d, custom, MAC));
  };

  const cancel = () => {
    setDraft(saved);
    setRecording(null);
    setPending(null);
    setNotice(null);
    setError(null);
  };

  const save = async () => {
    setRecording(null);
    setPending(null);
    setSaving(true);
    try {
      await saveKeyPrefs(draft);
      setNotice(null);
      setError(null);
    } catch (e) {
      setError(t('settings.shortcuts.saveFailed').replace('{error}', e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  const actionRows: Row[] = ACTIONS
    .filter((a) => a.tab === tab && (a.id !== 'refer' || studioHost?.refer))
    .map((a) => ({ id: a.id, label: actionName(a.id), keys: keymap[a.id], action: a.id }));
  /* Other: the keys that are always the same, after the actions */
  const fixedRows: Row[] = tab !== 'other' ? [] : [
    ...(studioHost?.settings ? [{ id: 'settings', label: t('settings.title'), keys: ['mod+,'] }] : []),
    ...(() => {
      /* stop held, then back or forward: a frame that way */
      const stop = keymap['shuttle-stop'][0];
      const held = [keymap['shuttle-back'][0], keymap['shuttle-forward'][0]].flatMap((step) => (stop && step ? [[stop, step]] : []));
      return [{ id: 'shuttle-hold', label: t('settings.shortcuts.shuttleHold'), keys: [], held }];
    })(),
    ...FIXED_KEYS.map((row) => ({ id: row.label, label: t(`settings.shortcuts.${row.label}`), keys: row.keys })),
  ];

  const renderRow = (row: Row) => {
    const id = row.action;
    const on = id && recording === id;
    const caps = row.held
      ? (
        <span className="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1">
          {row.held.map((combos, i) => (
            <React.Fragment key={combos.join(' ')}>
              {i > 0 ? <span className="text-[12px] text-[var(--text-faint)]">/</span> : null}
              <span className="inline-flex items-center gap-1">
                {combos.flatMap((combo, j) => [
                  ...(j > 0 ? [<span key={`p${j}`} className="text-[12px] text-[var(--text-faint)]">+</span>] : []),
                  <Caps key={j} combo={combo} />,
                ])}
              </span>
            </React.Fragment>
          ))}
        </span>
      )
      : <KeyList keys={row.keys} none={t('settings.shortcuts.none')} />;
    const conflict = pending && pending.id === id ? pending : null;
    return (
      <div key={row.id} className="py-1">
        <div className="group flex min-h-[36px] items-center justify-between gap-4">
          <span className="min-w-0 text-[14px] leading-snug text-[var(--text)]">{row.label}</span>
          {id ? (
            <span className="flex shrink-0 items-center gap-1">
              {custom && row.keys.length && !on ? (
                <button type="button" aria-label={`${t('settings.shortcuts.clear')}: ${row.label}`} title={t('settings.shortcuts.clear')}
                  onClick={() => { setPending(null); setDraft((d) => withoutKeys(d, custom, id, MAC)); }}
                  className="flex h-6 w-6 items-center justify-center rounded-[5px] text-[var(--text-faint)] opacity-0 transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:opacity-100 group-hover:opacity-100">
                  <X size={13} />
                </button>
              ) : null}
              <button type="button" data-recording={on ? '' : undefined}
                aria-label={`${row.label}: ${custom ? t('settings.shortcuts.change') : t('settings.shortcuts.editCopy')}`}
                title={custom ? t('settings.shortcuts.change') : t('settings.shortcuts.editCopy')}
                onClick={() => (on ? setRecording(null) : startRecording(id))}
                className={`flex min-h-8 max-w-[220px] items-center justify-end rounded-[7px] px-2 py-1 transition ${
                  on ? 'bg-[var(--bg-pressed)] ring-1 ring-[var(--accent)]' : pending?.id === id ? 'ring-1 ring-[var(--err)]' : 'hover:bg-[var(--bg-hover)]'
                }`}>
                {on ? <span className="text-[13px] text-[var(--text-muted)]">{t('settings.shortcuts.recording')}</span> : conflict ? <Caps combo={conflict.combo} /> : caps}
              </button>
            </span>
          ) : <span className="flex max-w-[220px] shrink-0 justify-end px-2">{caps}</span>}
        </div>
        {/* the keys pressed are another action's: replace, or keep things as they are */}
        {conflict ? (
          <div role="alert" className="mb-1 mt-1.5 flex flex-col gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--bg-panel)] px-3 py-2.5">
            <span className="text-[13.5px] leading-snug text-[var(--text)]">
              {t('settings.shortcuts.conflict').replace('{keys}', comboCaps(conflict.combo, MAC).join(MAC ? '' : '+')).replace('{action}', actionName(conflict.other))}
            </span>
            <span className="flex justify-end gap-2">
              <SettingsButton className="h-8" onClick={() => setPending(null)}>{t('settings.shortcuts.cancel')}</SettingsButton>
              <SettingsButton className="h-8" variant="primary" onClick={replace}>{t('settings.shortcuts.replace')}</SettingsButton>
            </span>
          </div>
        ) : null}
      </div>
    );
  };

  /* two columns, filled top to bottom, the left one first */
  const columns = (rows: Row[]) => {
    const half = Math.ceil(rows.length / 2);
    return [rows.slice(0, half), rows.slice(half)];
  };

  const schemeOptions = [...BUILT_IN_SCHEMES, ...CUSTOM_SLOTS].map((id) => ({ value: id as SchemeId, label: schemeName(id) }));

  return (
    <SettingsPage note={t('settings.shortcuts.hint')}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SettingsSegmented<KeyTab>
          label={t('settings.sections.shortcuts')}
          value={tab}
          onChange={(next) => { setTab(next); setRecording(null); }}
          options={KEY_TABS.map((id) => ({ value: id, label: t(`settings.shortcuts.tabs.${id}`) }))}
        />
        <SettingsSelect<SchemeId> label={t('settings.shortcuts.scheme')} value={draft.scheme} options={schemeOptions} onChange={chooseScheme} width={200} />
      </div>
      {notice ? <p role="status" className="mb-3 text-[13.5px] leading-relaxed text-[var(--text-muted)]">{notice}</p> : null}
      <div className="@container">
        <div className="grid grid-cols-1 gap-x-8 @xl:grid-cols-2">
          {columns(actionRows).map((rows, i) => (
            <div key={i} className={`flex flex-col ${i === 1 ? '@xl:border-l @xl:border-[var(--border)] @xl:pl-8' : ''}`}>{rows.map(renderRow)}</div>
          ))}
        </div>
        {fixedRows.length ? (
          <>
            <p className="mt-3 border-t border-[var(--border)] pt-3 text-[13px] text-[var(--text-faint)]">{t('settings.shortcuts.fixed')}</p>
            <div className="grid grid-cols-1 gap-x-8 @xl:grid-cols-2">
              {columns(fixedRows).map((rows, i) => (
                <div key={i} className={`flex flex-col ${i === 1 ? '@xl:border-l @xl:border-[var(--border)] @xl:pl-8' : ''}`}>{rows.map(renderRow)}</div>
              ))}
            </div>
          </>
        ) : null}
      </div>
      {error ? <p className={`mt-3 ${settingsError}`}>{error}</p> : null}
      <div className="mt-5 flex items-center justify-between gap-3">
        <SettingsButton onClick={restore} disabled={!custom}>{t('settings.shortcuts.restore')}</SettingsButton>
        <span className="flex gap-2">
          <SettingsButton onClick={cancel} disabled={!dirty || saving}>{t('settings.shortcuts.cancel')}</SettingsButton>
          <SettingsButton variant="primary" onClick={() => { void save(); }} disabled={!dirty || saving}>{t('settings.shortcuts.save')}</SettingsButton>
        </span>
      </div>
    </SettingsPage>
  );
}
