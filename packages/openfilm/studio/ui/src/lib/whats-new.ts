/**
 * What this release brings, said to the person after an update, in every language Studio speaks (a release without them
 * all does not compile), grouped as new, improved and fixed. Only this release's: the dialog tells what the version now
 * running brings, and the changelog on GitHub keeps every release's.
 *
 * Written when a release is made (the "Version packages" pull request), in place of the release before's: the
 * changesets say everything that changed, for the changelog; these say every change a person would notice, in their
 * words, one line each (at most 24). A version without them fails the tests (whats-new.test.ts), so that pull request
 * cannot be merged until they are written.
 *
 * After an update they appear once (Studio's prefs keep `seenVersion`). A new install shows none: there is nothing it
 * was updated from.
 */
import type { Language } from '@/i18n';

export type NoteKind = 'new' | 'improved' | 'fixed';
export interface ReleaseNote { kind: NoteKind; text: string }
export interface ReleaseNotes { version: string; date: string; notes: Record<Language, ReleaseNote[]> }

export const RELEASE: ReleaseNotes = {
  version: '0.3.1',
  date: '2026-11-06',
  notes: {
    en: [
      { kind: 'new', text: 'Find reviewed CC0 assets in the Community group of the Studio library. Try the Glass Pulse sound and the Glitch transition, then add them to your timeline.' },
      { kind: 'new', text: 'Open the contribution guide from the Community group to submit an original sound, music track, transition or effect.' },
    ],
    'zh-CN': [
      { kind: 'new', text: 'Studio 素材库的「社区」分组收录审核过的 CC0 素材。可以预览玻璃脉冲音效和信号故障转场，再把它们加到时间线。' },
      { kind: 'new', text: '从「社区」分组打开投稿指南，即可提交原创音效、配乐、转场或特效。' },
    ],
    ja: [
      { kind: 'new', text: 'Studio の素材ライブラリに、審査済みの CC0 素材を集めた「コミュニティ」が加わりました。ガラスのパルスとグリッチを試聴・プレビューしてタイムラインに追加できます。' },
      { kind: 'new', text: '「コミュニティ」から投稿ガイドを開き、自作の効果音、音楽、トランジション、エフェクトを投稿できます。' },
    ],
    ko: [
      { kind: 'new', text: 'Studio 소재 라이브러리의 커뮤니티 그룹에서 검토를 거친 CC0 소재를 찾을 수 있습니다. 유리 펄스 효과음과 글리치 전환을 미리 보고 타임라인에 추가해 보세요.' },
      { kind: 'new', text: '커뮤니티 그룹에서 기여 안내를 열어 직접 만든 효과음, 음악, 전환 또는 효과를 제출할 수 있습니다.' },
    ],
    es: [
      { kind: 'new', text: 'Encuentra recursos CC0 revisados en el grupo Comunidad de la biblioteca de Studio. Prueba el sonido Pulso de cristal y la transición Fallo y añádelos a la línea de tiempo.' },
      { kind: 'new', text: 'Abre la guía de contribución desde Comunidad para enviar un sonido, una pista musical, una transición o un efecto original.' },
    ],
  },
};

/** -1, 0 or 1 as `a` is older than, the same as or newer than `b` (x.y.z; a pre-release is older than its release). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre = ''] = v.split('-');
    return { parts: core.split('.').map((n) => Number(n) || 0), pre };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.parts[i] ?? 0) - (y.parts[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** This release's notes when `version` is this release, else null. */
export function releaseNotes(version: string, release: ReleaseNotes = RELEASE): ReleaseNotes | null {
  return compareVersions(release.version, version) === 0 ? release : null;
}

/** Said on the window to show this release's notes again (Settings → About, Developer's preview). */
export const WHATS_NEW_EVENT = 'openfilm:whats-new';
export function showWhatsNew(): void {
  window.dispatchEvent(new CustomEvent(WHATS_NEW_EVENT));
}
