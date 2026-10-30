/**
 * A turn DeepSeek Harness could not run because the model's route has no API key: `no API key for provider route
 * "deepseek-official"`, its words when only the person's DeepSeek account is signed in and the model picked (its
 * default) runs on the API. The chat says so in its own words and offers a model of the account instead. Read from
 * the error's words, so a turn kept from before says it too.
 */
import type { LocalAgentSessionInfo } from './desktop-bridge';

type ConfigOptions = NonNullable<LocalAgentSessionInfo['configOptions']>;

const NO_KEY = /\bno API key for provider route "([^"]+)"/i;

/**
 * The DeepSeek route that has no key, or null when the turn failed for something else. Another provider's route (an
 * OpenAI-compatible one the person added) is left to DeepSeek Harness's own words, which name the key it needs.
 */
export function routeWithoutKey(error: string | null | undefined): string | null {
  const route = NO_KEY.exec(String(error ?? ''))?.[1] ?? null;
  return route && /^deepseek/i.test(route) ? route : null;
}

type AccountModel = { configId: string; value: string; name: string };

/** A model value's route: `["deepseek-account", "<model>"]` → `deepseek-account`. */
function routeOf(value: unknown): unknown {
  if (typeof value !== 'string') return null;
  try { return (JSON.parse(value) as unknown[])?.[0]; } catch { return null; }
}

/** The menu's model choices that run on the person's DeepSeek account, named as its button names them. */
function accountModels(options: ConfigOptions | undefined): AccountModel[] {
  const option = options?.find((o) => o.category === 'model');
  return (option?.options ?? []).flatMap((choice) => (choice && 'value' in choice && typeof choice.value === 'string' && routeOf(choice.value) === 'deepseek-account'
    ? [{ configId: option!.id, value: choice.value, name: String(choice.name ?? choice.value).split(' · ')[0] }]
    : []));
}

/**
 * The first model on the person's DeepSeek account (its value is `["deepseek-account", "<model>"]`), named as the
 * menu's button names it (the part before " · DeepSeek Account"); null when the agent offers none, as when no account
 * is signed in.
 */
export function accountModel(options: ConfigOptions | undefined): AccountModel | null {
  return accountModels(options)[0] ?? null;
}

/** The account's model the person is on now (`value`, picked here or in the menu), or null when it is not one of them. */
export function accountModelOf(options: ConfigOptions | undefined, value: unknown): AccountModel | null {
  return accountModels(options).find((model) => model.value === value) ?? null;
}
