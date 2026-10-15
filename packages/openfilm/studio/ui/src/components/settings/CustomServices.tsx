/**
 * Settings → Services, under which service makes each kind of media: the person's custom services. Any service at an
 * address (one they run on this computer, their own voice, an API not listed), with its key and their words on what it
 * does and how it is called (or where its docs are). OpenFilm does not call one itself: their agent reads those words
 * in `openfilm get` and calls it with `openfilm get call` (studio/server/custom-services.mjs).
 */
import React from 'react';
import { Plus, Server } from 'lucide-react';
import { useT } from '@/i18n';
import type { OwnService, OwnServiceFields, ProvidersHook } from '@/lib/providers';
import { SettingsButton, SettingsField, SettingsGroup, SettingsInset, SettingsItem, SettingsStatus, settingsError, settingsLink } from './ui';

/** Whether the last change that failed was to one of the person's own services (it is said under its form). */
export const customProblem = (hook: ProvidersHook) => hook.problemFor === 'custom' || Boolean(hook.state?.custom.some((s) => s.id === hook.problemFor));

/** The person's own services: each with what it does and how it is called, and a form to add one. */
export function CustomServices({ hook }: { hook: ProvidersHook }) {
  const t = useT();
  const services = hook.state?.custom ?? [];
  const [open, setOpen] = React.useState<string | null>(null);
  if (!hook.state) return null;
  return (
    <SettingsGroup title={t('settings.providers.own.title')} footnote={t('settings.providers.own.note')}>
      {services.map((service) => (
        <SettingsItem
          key={service.id}
          mark={<Server size={16} />}
          title={service.name}
          badge={service.last4 ? <SettingsStatus tone="muted"><span className="font-mono tabular-nums">•••• {service.last4}</span></SettingsStatus> : null}
          description={(
            <>
              <span className="font-mono text-[13px] text-[var(--text-faint)]">{service.url}</span>
              {service.note ? <span className="mt-0.5 block whitespace-pre-line">{service.note}</span> : null}
            </>
          )}
          control={open === service.id ? null : (
            <>
              <SettingsButton variant="quiet" disabled={hook.busy === service.id} onClick={() => void hook.removeService(service.id)}>{t('settings.providers.own.remove')}</SettingsButton>
              <SettingsButton onClick={() => setOpen(service.id)}>{t('settings.providers.own.edit')}</SettingsButton>
            </>
          )}
        >
          {open === service.id ? <ServiceForm hook={hook} service={service} onDone={() => setOpen(null)} /> : null}
        </SettingsItem>
      ))}
      {open === '' ? (
        <div className="py-4"><ServiceForm hook={hook} service={null} onDone={() => setOpen(null)} /></div>
      ) : (
        <div className="py-4">
          <SettingsButton onClick={() => setOpen('')}><Plus size={15} strokeWidth={2} />{t('settings.providers.own.add')}</SettingsButton>
        </div>
      )}
    </SettingsGroup>
  );
}

/**
 * A service's name, address, key and what it does (how it is called, or its docs): added (`service` null) or changed.
 * Where the key goes is not asked: the agent writes {key} where the service's docs want it, else it goes as
 * `Authorization: Bearer` (a service set up when this was asked keeps its answer).
 */
function ServiceForm({ hook, service, onDone }: { hook: ProvidersHook; service: OwnService | null; onDone: () => void }) {
  const t = useT();
  const [fields, setFields] = React.useState<OwnServiceFields>({ name: service?.name ?? '', url: service?.url ?? '', note: service?.note ?? '' });
  const [key, setKey] = React.useState('');
  const [dropKey, setDropKey] = React.useState(false);
  const busy = hook.busy === (service?.id ?? 'custom');
  const set = (name: keyof OwnServiceFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFields((f) => ({ ...f, [name]: e.target.value }));
  const save = async () => {
    if (busy || !fields.name.trim() || !fields.url.trim()) return;
    /* changed without a key typed: the one it has stays (unless taken away) */
    const sent: OwnServiceFields = { ...fields, ...(key.trim() ? { key: key.trim() } : dropKey || !service ? { key: '' } : {}) };
    if (await hook.saveService(service?.id ?? null, sent)) onDone();
  };
  const label = (text: string, field: React.ReactNode) => (
    <label className="flex flex-col gap-1.5 text-[13.5px] text-[var(--text-muted)]">{text}{field}</label>
  );
  return (
    /* under its row, it lines up with the row's words; a new one stands on its own */
    <form className={service ? 'pl-[52px]' : ''} onSubmit={(e) => { e.preventDefault(); void save(); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onDone(); } }}>
      <SettingsInset>
        {label(t('settings.providers.own.name'), <SettingsField autoFocus value={fields.name} onChange={set('name')} placeholder={t('settings.providers.own.namePlaceholder')} />)}
        {label(t('settings.providers.own.url'), <SettingsField value={fields.url} onChange={set('url')} placeholder="http://localhost:8000" spellCheck={false} className="font-mono placeholder:font-sans" />)}
        {label(t('settings.providers.own.key'), (
          <SettingsField type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => { setKey(e.target.value); setDropKey(false); }}
            placeholder={service?.last4 && !dropKey ? t('settings.providers.own.keyKeep').replaceAll('{last4}', service.last4) : t('settings.providers.own.keyOptional')}
            className="font-mono placeholder:font-sans" />
        ))}
        {service?.last4 && !key && !dropKey ? (
          <button type="button" className={`${settingsLink} self-start text-[13.5px]`} onClick={() => setDropKey(true)}>{t('settings.providers.own.removeKey')}</button>
        ) : null}
        {label(t('settings.providers.own.what'), (
          <textarea value={fields.note} onChange={set('note')} rows={4} maxLength={2000} placeholder={t('settings.providers.own.whatPlaceholder')}
            className="w-full min-w-0 resize-y rounded-[8px] border border-[var(--border)] bg-transparent px-3 py-2 text-[14px] leading-[1.5] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] hover:border-[var(--border-strong)] focus:border-[var(--text-muted)]" />
        ))}
        {hook.problem && hook.problemFor === (service?.id ?? 'custom') ? <p className={settingsError} role="alert">{hook.problem}</p> : null}
        <div className="flex justify-end gap-2">
          <SettingsButton variant="quiet" onClick={onDone}>{t('settings.providers.cancel')}</SettingsButton>
          <SettingsButton type="submit" variant="primary" disabled={busy || !fields.name.trim() || !fields.url.trim()}>{t('settings.providers.save')}</SettingsButton>
        </div>
      </SettingsInset>
    </form>
  );
}
