/**
 * What each release brings, said to the person after an update: a few lines a release, in every language Studio
 * speaks (a release without them all does not compile), grouped as new, improved and fixed. The newest first.
 *
 * Written when a release is made (the "Version packages" pull request): the changesets say everything that changed,
 * for the changelog; these say what a person would notice, in their words, at most six lines. A version without them
 * fails the tests (whats-new.test.ts), so that pull request cannot be merged until they are written.
 *
 * After an update the release notes since the version last shown appear once (lib's notesToShow; Studio's prefs keep
 * `seenVersion`). A new install shows none: there is nothing it was updated from.
 */
import type { Language } from '@/i18n';

export type NoteKind = 'new' | 'improved' | 'fixed';
export interface ReleaseNote { kind: NoteKind; text: string }
export interface ReleaseNotes { version: string; date: string; notes: Record<Language, ReleaseNote[]> }

export const RELEASES: readonly ReleaseNotes[] = [
  {
    version: '0.1.7',
    date: '2026-10-14',
    notes: {
      en: [
        { kind: 'new', text: 'Settings › Providers takes services of your own (your voice, a transcription server on this computer, an API that isn’t listed), and your agent can use them.' },
        { kind: 'new', text: 'A title can be restyled together with every title like it (“All like it”), and several layers picked together scale and turn by their box.' },
        { kind: 'new', text: 'Your own key: each model gets the reasoning efforts it takes, and the chat’s model menu offers them.' },
        { kind: 'improved', text: 'Markers have a row of their own under the ruler, and the timeline shows the main track by its look.' },
        { kind: 'improved', text: 'Claude Code runs on your Claude subscription and signs in its own way; its model menu shows its four current models.' },
        { kind: 'fixed', text: 'On Windows, command windows no longer flash up while the app checks or talks to your agents.' },
      ],
      'zh-CN': [
        { kind: 'new', text: '设置 › 服务商 可以添加你自己的服务（自己的声音、本机的转写服务、未列出的 API），智能体可以直接使用。' },
        { kind: 'new', text: '标题可以和同类标题一起改样式（「所有同类」）；多选的图层可以按整体框一起缩放、旋转。' },
        { kind: 'new', text: '自有密钥：每个模型可以设置它支持的推理档位，对话里的模型菜单会提供这些档位。' },
        { kind: 'improved', text: '标记在标尺下方有了单独的一行；时间线用外观区分主轨道。' },
        { kind: 'improved', text: 'Claude Code 只使用你的 Claude 订阅，并按官方方式授权登录；模型菜单显示它当前的四个模型。' },
        { kind: 'fixed', text: 'Windows 上检查或使用智能体时，不再不停弹出命令行窗口。' },
      ],
      ja: [
        { kind: 'new', text: '設定 › プロバイダーに自分のサービス（自分の声、このコンピューターの文字起こしサーバー、一覧にない API）を追加でき、エージェントが使えます。' },
        { kind: 'new', text: 'タイトルを同じ種類のタイトルとまとめてスタイル変更でき（「同じ種類すべて」）、複数選んだレイヤーは枠ごと拡大縮小・回転できます。' },
        { kind: 'new', text: '自分のキー：モデルごとに対応する推論の強さを設定でき、チャットのモデルメニューで選べます。' },
        { kind: 'improved', text: 'マーカーはルーラーの下に専用の行ができ、タイムラインはメイントラックを見た目で示します。' },
        { kind: 'improved', text: 'Claude Code は Claude のサブスクリプションだけで動き、公式の方法でサインインします。モデルメニューには現在の 4 つのモデルが表示されます。' },
        { kind: 'fixed', text: 'Windows で、エージェントの確認や利用のたびにコマンドウィンドウが開かなくなりました。' },
      ],
      ko: [
        { kind: 'new', text: '설정 › 제공업체에 내 서비스(내 목소리, 이 컴퓨터의 전사 서버, 목록에 없는 API)를 추가할 수 있고, 에이전트가 사용할 수 있습니다.' },
        { kind: 'new', text: '제목을 같은 종류의 제목과 함께 스타일 변경할 수 있고("같은 종류 모두"), 여러 레이어를 선택하면 상자째로 크기를 바꾸고 회전할 수 있습니다.' },
        { kind: 'new', text: '내 키: 모델마다 지원하는 추론 강도를 정할 수 있고, 채팅의 모델 메뉴에서 고를 수 있습니다.' },
        { kind: 'improved', text: '마커는 눈금자 아래 전용 줄에 놓이고, 타임라인은 메인 트랙을 모양으로 보여 줍니다.' },
        { kind: 'improved', text: 'Claude Code는 Claude 구독으로만 실행되고 공식 방식으로 로그인합니다. 모델 메뉴에는 현재의 네 모델이 나옵니다.' },
        { kind: 'fixed', text: 'Windows에서 에이전트를 확인하거나 사용할 때 명령 창이 더 이상 뜨지 않습니다.' },
      ],
      es: [
        { kind: 'new', text: 'Ajustes › Proveedores admite servicios tuyos (tu voz, un servidor de transcripción en este equipo, una API que no está en la lista), y tu agente puede usarlos.' },
        { kind: 'new', text: 'Un título puede cambiar de estilo junto con todos los títulos como él («Todos los iguales»), y varias capas seleccionadas se escalan y giran con su caja.' },
        { kind: 'new', text: 'Tu propia clave: cada modelo tiene los esfuerzos de razonamiento que admite, y el menú de modelos del chat los ofrece.' },
        { kind: 'improved', text: 'Los marcadores tienen su propia fila bajo la regla, y la línea de tiempo muestra la pista principal por su aspecto.' },
        { kind: 'improved', text: 'Claude Code funciona solo con tu suscripción de Claude e inicia sesión a su manera; su menú de modelos muestra sus cuatro modelos actuales.' },
        { kind: 'fixed', text: 'En Windows ya no se abren ventanas de comandos mientras la app revisa o usa tus agentes.' },
      ],
    },
  },
  {
    version: '0.1.6',
    date: '2026-10-13',
    notes: {
      en: [
        { kind: 'new', text: 'Export › Editing project makes a CapCut draft: your timeline opens on its home screen, ready to keep cutting. Premiere Pro and DaVinci Resolve get the XML.' },
        { kind: 'new', text: 'Settings › Agents shows whose account Claude Code and Codex use, and what is left of the Codex plan, without opening them.' },
        { kind: 'improved', text: 'Settings › About checks for updates by itself, shows the download, and restarts to update.' },
        { kind: 'fixed', text: 'A 16:9 export is exactly 1920 × 1080 (or 3840 × 2160), whatever the film’s own shape.' },
        { kind: 'fixed', text: 'Choosing where exports go opens the folder dialog in front, and it stays open.' },
      ],
      'zh-CN': [
        { kind: 'new', text: '导出 › 剪辑工程可以生成剪映草稿：时间线直接出现在剪映首页，接着剪；Premiere Pro 和 DaVinci Resolve 仍用 XML。' },
        { kind: 'new', text: '设置 › 智能体 直接显示 Claude Code 和 Codex 当前用的账号，以及 Codex 的剩余额度，不用再打开它们查看。' },
        { kind: 'new', text: '中文界面的社交平台导出新增哔哩哔哩、抖音、快手、视频号和小红书。' },
        { kind: 'improved', text: '设置 › 关于 会自动检查更新，显示下载进度，下载好后点一下即可重启更新。' },
        { kind: 'fixed', text: '16:9 导出准确为 1920 × 1080（4K 为 3840 × 2160），不再受影片自身画幅影响。' },
        { kind: 'fixed', text: '选择导出位置时，文件夹窗口会出现在最前面，不再一闪而过。' },
      ],
      ja: [
        { kind: 'new', text: '書き出し › 編集プロジェクトで CapCut の下書きを作れます。タイムラインがホーム画面に表示され、そのまま編集を続けられます。Premiere Pro と DaVinci Resolve には XML を書き出します。' },
        { kind: 'new', text: '設定 › エージェントで、Claude Code と Codex が使っているアカウントと、Codex の残りの利用枠を、それぞれを開かずに確認できます。' },
        { kind: 'improved', text: '設定 › 情報 でアップデートを自動で確認し、ダウンロードの進み具合を表示します。準備ができたら再起動で更新できます。' },
        { kind: 'fixed', text: '16:9 の書き出しは、映像自体の比率にかかわらず正確に 1920 × 1080（または 3840 × 2160）になります。' },
        { kind: 'fixed', text: '書き出し先を選ぶフォルダーのダイアログが手前に開き、すぐに閉じなくなりました。' },
      ],
      ko: [
        { kind: 'new', text: '내보내기 › 편집 프로젝트에서 CapCut 초안을 만들 수 있습니다. 타임라인이 홈 화면에 바로 나타나 이어서 편집할 수 있습니다. Premiere Pro와 DaVinci Resolve는 XML로 내보냅니다.' },
        { kind: 'new', text: '설정 › 에이전트에서 Claude Code와 Codex가 사용하는 계정과 Codex의 남은 사용량을 각각 열지 않고 볼 수 있습니다.' },
        { kind: 'improved', text: '설정 › 정보에서 업데이트를 자동으로 확인하고 다운로드 진행 상황을 보여 줍니다. 준비되면 다시 시작해 업데이트하세요.' },
        { kind: 'fixed', text: '16:9 내보내기는 영상 자체의 비율과 관계없이 정확히 1920 × 1080(또는 3840 × 2160)입니다.' },
        { kind: 'fixed', text: '내보낼 위치를 고르는 폴더 대화상자가 앞에 열리고, 바로 닫히지 않습니다.' },
      ],
      es: [
        { kind: 'new', text: 'Exportar › Proyecto de edición crea un borrador de CapCut: tu línea de tiempo aparece en su pantalla de inicio, lista para seguir editando. Premiere Pro y DaVinci Resolve reciben el XML.' },
        { kind: 'new', text: 'Ajustes › Agentes muestra qué cuenta usan Claude Code y Codex, y cuánto le queda al plan de Codex, sin abrirlos.' },
        { kind: 'improved', text: 'Ajustes › Acerca de busca actualizaciones por sí solo, muestra la descarga y se reinicia para actualizar.' },
        { kind: 'fixed', text: 'Una exportación 16:9 mide exactamente 1920 × 1080 (o 3840 × 2160), sea cual sea la forma de la película.' },
        { kind: 'fixed', text: 'Al elegir dónde exportar, el diálogo de carpetas se abre delante y no se cierra solo.' },
      ],
    },
  },
];

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

/**
 * The releases to tell of after an update from `seen` to `current`: those newer than `seen`, up to `current`, the
 * newest first. None when nothing was seen before (a new install) or nothing is newer.
 */
export function notesToShow(seen: string | null, current: string, releases: readonly ReleaseNotes[] = RELEASES): ReleaseNotes[] {
  if (!seen) return [];
  return releases.filter((r) => compareVersions(r.version, seen) > 0 && compareVersions(r.version, current) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** The notes of one release, if it has any. */
export function releaseNotes(version: string, releases: readonly ReleaseNotes[] = RELEASES): ReleaseNotes | null {
  return releases.find((r) => compareVersions(r.version, version) === 0) ?? null;
}

/** Said on the window to show releases' notes (Settings → About, Developer's preview): `detail` is the versions. */
export const WHATS_NEW_EVENT = 'openfilm:whats-new';
export function showWhatsNew(versions: string[]): void {
  window.dispatchEvent(new CustomEvent(WHATS_NEW_EVENT, { detail: versions }));
}
