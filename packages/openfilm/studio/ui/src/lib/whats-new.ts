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
  date: '2026-11-07',
  notes: {
    en: [
      { kind: 'fixed', text: "Click any library asset to download and preview automatically, including stickers and templates. Download icons only indicate status; waiting uses a compact loading bar." },
      { kind: 'fixed', text: "Codex usage percentages stay on one line. Google Antigravity and DeepSeek Harness appear first among optional agents." },
      { kind: 'fixed', text: 'Disable or enable selected clips with Shift+E or the clip menu, with undo and redo. Timing, source trims and volume stay in place.' },
      { kind: 'fixed', text: 'Jianying and CapCut drafts keep complete video and audio sources, native speeds and editable source handles on processed footage.' },
      { kind: 'fixed', text: 'Transparent exports keep edge colors when resized or motion-blurred. Changes between transparent and opaque frames no longer drop output frames.' },
      { kind: 'new', text: 'Find reviewed CC0 assets in the Community group of the Studio library. Try the Glass Pulse sound and the Glitch transition, then add them to your timeline.' },
      { kind: 'new', text: 'Open the contribution guide from the Community group to submit an original sound, music track, transition or effect.' },
    ],
    'zh-CN': [
      { kind: 'fixed', text: "单击素材即可自动下载并预览，贴纸和模板也适用；下载图标仅表示状态，等待时只显示加载条。" },
      { kind: 'fixed', text: "Codex 用量百分比保持单行显示；「还可以接入的智能体」优先列出 Google Antigravity 和 DeepSeek Harness。" },
      { kind: 'fixed', text: '按 Shift+E 或使用素材右键菜单，可以单独禁用、启用选中的素材，并支持撤销重做。位置、入出点和音量都会保留。' },
      { kind: 'fixed', text: '导出到剪映或 CapCut 时保留完整视频、音频和原生变速；带处理效果的视频也保留可继续修剪的素材余量。' },
      { kind: 'fixed', text: '修复透明视频缩放、运动模糊时的亮边混色，以及透明与不透明画面切换时的导出丢帧。' },
      { kind: 'new', text: 'Studio 素材库的「社区」分组收录审核过的 CC0 素材。可以预览玻璃脉冲音效和信号故障转场，再把它们加到时间线。' },
      { kind: 'new', text: '从「社区」分组打开投稿指南，即可提交原创音效、配乐、转场或特效。' },
    ],
    ja: [
      { kind: 'fixed', text: "ステッカーやテンプレートもクリックで自動取得・プレビューします。ダウンロードのアイコンは状態表示のみで、待機中は読み込みバーを表示します。" },
      { kind: 'fixed', text: "Codex の使用率は1行で表示します。追加できるエージェントは Google Antigravity、DeepSeek Harness の順に表示します。" },
      { kind: 'fixed', text: 'Shift+E またはクリップメニューで選択クリップを無効化・有効化でき、取り消しとやり直しにも対応します。位置、トリム、音量は保持されます。' },
      { kind: 'fixed', text: 'Jianying と CapCut への書き出しで、映像・音声の全長と再生速度を保持します。加工した映像もトリムを延長できます。' },
      { kind: 'fixed', text: '透明映像の拡大縮小とモーションブラーで明るい縁が生じる混色を修正し、透明・不透明の切り替わりによるフレーム欠落も修正しました。' },
      { kind: 'new', text: 'Studio の素材ライブラリに、審査済みの CC0 素材を集めた「コミュニティ」が加わりました。ガラスのパルスとグリッチを試聴・プレビューしてタイムラインに追加できます。' },
      { kind: 'new', text: '「コミュニティ」から投稿ガイドを開き、自作の効果音、音楽、トランジション、エフェクトを投稿できます。' },
    ],
    ko: [
      { kind: 'fixed', text: "스티커와 템플릿도 클릭하면 자동 다운로드 후 미리 봅니다. 다운로드 아이콘은 상태만 표시하고 대기 중에는 로딩 바를 표시합니다." },
      { kind: 'fixed', text: "Codex 사용률이 한 줄로 표시됩니다. 추가 에이전트 목록에서 Google Antigravity와 DeepSeek Harness를 먼저 표시합니다." },
      { kind: 'fixed', text: 'Shift+E 또는 클립 메뉴로 선택한 클립을 비활성화하거나 활성화하고 실행 취소와 다시 실행을 할 수 있습니다. 위치, 트림과 음량은 유지됩니다.' },
      { kind: 'fixed', text: 'Jianying 및 CapCut으로 내보낼 때 전체 비디오와 오디오 원본, 재생 속도를 유지합니다. 효과를 적용한 영상도 트림을 늘릴 수 있습니다.' },
      { kind: 'fixed', text: '투명 영상의 크기 조절과 모션 블러에서 밝은 테두리가 생기는 색 혼합을 수정하고, 투명도 전환 시 내보내기 프레임이 누락되는 문제를 수정했습니다.' },
      { kind: 'new', text: 'Studio 소재 라이브러리의 커뮤니티 그룹에서 검토를 거친 CC0 소재를 찾을 수 있습니다. 유리 펄스 효과음과 글리치 전환을 미리 보고 타임라인에 추가해 보세요.' },
      { kind: 'new', text: '커뮤니티 그룹에서 기여 안내를 열어 직접 만든 효과음, 음악, 전환 또는 효과를 제출할 수 있습니다.' },
    ],
    es: [
      { kind: 'fixed', text: "Haz clic en cualquier recurso, incluidas pegatinas y plantillas, para descargarlo y previsualizarlo automáticamente. El icono solo indica el estado; la espera muestra una barra." },
      { kind: 'fixed', text: "El porcentaje de uso de Codex queda en una línea. Google Antigravity y DeepSeek Harness encabezan los agentes opcionales." },
      { kind: 'fixed', text: 'Desactiva o activa los clips seleccionados con Mayús+E o su menú, con deshacer y rehacer. Se conservan la posición, los recortes y el volumen.' },
      { kind: 'fixed', text: 'Los borradores de Jianying y CapCut conservan las fuentes completas de vídeo y audio, las velocidades nativas y el margen para ampliar los recortes del vídeo procesado.' },
      { kind: 'fixed', text: 'Las exportaciones transparentes conservan el color de los bordes al escalar y aplicar desenfoque de movimiento. Los cambios de transparencia ya no eliminan fotogramas.' },
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
