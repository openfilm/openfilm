/**
 * Where the community talks, beside what it makes: OpenFilm's official groups (and, in Chinese, its WeChat group, whose
 * handle is copied) and its maker's own accounts, as round logos. Shown at the foot of the Community window's Discover;
 * it was the OpenFilm menu's Community flyout before the community became one place.
 */
import { useLanguage, useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import { communityChannels, CREATOR_CHANNELS, CREATOR_HANDLE } from '@/lib/product-links';
import { SocialLogo, type SocialPlatform } from './SocialLogo';
import { Tooltip } from './Tooltip';
import { Toast, useToast } from './Toast';
import styles from './AppMenu.module.css';

export function CommunityChannels() {
  const t = useT();
  const language = useLanguage();
  const toast = useToast();
  const chinese = language === 'zh-CN';
  const socials = CREATOR_CHANNELS.filter((channel) => chinese || channel.id === 'instagram' || channel.id === 'youtube');
  const social = (channel: { id: SocialPlatform; href: string }) => {
    const name = channel.id === 'github' ? 'GitHub' : channel.id === 'discord' ? 'Discord' : t(`appMenu.social.${channel.id}`);
    return (
      <Tooltip key={channel.id} label={name} side="top">
        <a className={styles.logo} aria-label={name} href={channel.href} target="_blank" rel="noreferrer"><SocialLogo platform={channel.id} /></a>
      </Tooltip>
    );
  };
  const weChat = (group = false) => {
    const label = t(group ? 'appMenu.weChatGroup' : 'appMenu.weChatCopy').replace('{handle}', CREATOR_HANDLE);
    return (
      <Tooltip label={label} side="top">
        <button type="button" className={styles.logo} aria-label={label} onClick={async () => {
          try {
            await navigator.clipboard.writeText(CREATOR_HANDLE);
            toast.show(t(group ? 'appMenu.weChatGroupCopied' : 'appMenu.weChatCopied').replace('{handle}', CREATOR_HANDLE));
          } catch {
            if (group) toast.show(t('appMenu.weChatGroupHint').replace('{handle}', CREATOR_HANDLE));
            else toast.showError(t('appMenu.weChatCopyFailed').replace('{handle}', CREATOR_HANDLE));
          }
        }}><SocialLogo platform="wechat" /></button>
      </Tooltip>
    );
  };
  return (
    <div className="flex flex-wrap gap-x-12 gap-y-5">
      <div role="group" aria-label={t('appMenu.officialCommunity')}>
        <p className={styles.groupLabel}>{t('appMenu.officialCommunity')}</p>
        <div className={styles.logos}>{communityChannels(studioHost ? language : 'en').map(social)}{chinese ? weChat(true) : null}</div>
      </div>
      <div role="group" aria-label={CREATOR_HANDLE}>
        <p className={styles.groupLabel}>{CREATOR_HANDLE}</p>
        <div className={styles.logos}>{chinese ? weChat() : null}{socials.map(social)}</div>
      </div>
      <Toast toast={toast.current} />
    </div>
  );
}
