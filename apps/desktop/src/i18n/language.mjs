/** Studio's languages: the app's own words (the menu bar, its dialogs, the install window) come in each of them. */
export const LANGUAGES = ['en', 'zh-CN', 'ja', 'ko', 'es'];

/**
 * The language the app speaks: the one Studio's page is in (or was last shown in), else the system's as Studio picks
 * it (its i18n `languageFor`): `zh-Hans-CN` and `zh` are Simplified Chinese, `es-MX` is Spanish.
 * @param {string | null | undefined} saved
 * @param {readonly string[]} [system] the system's preferred languages, most preferred first
 */
export function appLanguage(saved, system = []) {
  if (saved && LANGUAGES.includes(saved)) return saved;
  for (const tag of system) {
    const lower = String(tag).toLowerCase();
    if (lower.startsWith('zh')) {
      if (/^zh-(hant|tw|hk|mo)\b/.test(lower)) continue;
      return 'zh-CN';
    }
    const base = lower.split('-')[0];
    if (LANGUAGES.includes(base)) return base;
  }
  return 'en';
}
