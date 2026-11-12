import type { Language } from '@/i18n';

/** Public destinations used by the app menu. */
export const PRODUCT_LINKS = {
  docs: 'https://openfilm.dev/docs/',
  github: 'https://github.com/openfilm/openfilm',
  feedback: 'https://github.com/openfilm/openfilm/issues/new/choose',
} as const;

export function communityChannels(language: Language) {
  const discord = language === 'zh-CN' ? 'https://discord.gg/dgk4MtNWFZ' : 'https://discord.gg/a462Rs88hF';
  return [
    { id: 'discord', href: discord },
    { id: 'github', href: 'https://github.com/openfilm/openfilm/discussions' },
  ] as const;
}

export const CREATOR_HANDLE = 'riverisbuilding';

/** Direct profile URLs. Douyin's account ID was resolved from the creator's share link. */
export const CREATOR_CHANNELS = [
  { id: 'rednote', href: 'https://www.xiaohongshu.com/user/profile/695bfa62000000003700029d' },
  { id: 'bilibili', href: 'https://space.bilibili.com/1229893183' },
  { id: 'douyin', href: 'https://www.douyin.com/user/MS4wLjABAAAALPQoqnSDKNMQsR5GNnnx_nwq-rI1MsAyqcZRNuOzKjs' },
  { id: 'instagram', href: `https://www.instagram.com/${CREATOR_HANDLE}/` },
  { id: 'youtube', href: `https://www.youtube.com/@${CREATOR_HANDLE}` },
] as const;
