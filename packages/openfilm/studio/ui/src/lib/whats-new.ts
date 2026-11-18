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
  "version": "0.4.0",
  "date": "2026-11-18",
  "notes": {
    "en": [
      {
        "kind": "new",
        "text": "Plugins: Edit, Canvas and the new Screening editor are plugins you turn on or off, and anyone can make one."
      },
      {
        "kind": "new",
        "text": "The Community (early testing): find, add and publish plugins, skills, library packs and examples. A project's own skills reach your agent only after you allow them."
      },
      {
        "kind": "new",
        "text": "Clips and the elements of a page move by keyframes, with masks, text animated letter by letter or word by word, and 3D placement."
      },
      {
        "kind": "new",
        "text": "Animate effects: blur, glow, brightness, contrast, saturation, grayscale, hue and invert, around an anchor point you choose."
      },
      {
        "kind": "new",
        "text": "Grade footage with .cube, OpenColorIO and ASC color files at its own bit depth, and try the Color editor (beta)."
      },
      {
        "kind": "new",
        "text": "Connectors let your agent reach Dropbox, Frame.io, Notion, Vimeo, Adobe and Canva."
      },
      {
        "kind": "new",
        "text": "Links to a clip, a moment, a stretch or a canvas node open in Studio wherever they come from."
      },
      {
        "kind": "new",
        "text": "Export to a bitrate or a file size. Sound is brought to -14 LUFS by default and kept from clipping."
      },
      {
        "kind": "new",
        "text": "My voices: make a voice from your own recording. Voice-over can be a dialogue in two voices."
      },
      {
        "kind": "new",
        "text": "Remove a video's background and retouch faces on your computer, in preview and in export."
      },
      {
        "kind": "new",
        "text": "Preview the timeline by moving the mouse (S), and zoom it with + and -."
      },
      {
        "kind": "new",
        "text": "Projects work like a file browser: folders, grid and detail views, drag and drop, and batch moves."
      },
      {
        "kind": "new",
        "text": "New models: Seedance 2.5 Flash and Seedream 5.5, Doubao's full voice list and speech recognition 2.0, and Google pictures from reference images."
      },
      {
        "kind": "improved",
        "text": "Exports of footage are several times faster, and exports on the graphics chip are smaller and sharper."
      },
      {
        "kind": "improved",
        "text": "Media from this computer no longer takes room twice, and moved or renamed media is found again."
      },
      {
        "kind": "improved",
        "text": "A picture, clip or voice a service made shows its prompt, model and service."
      },
      {
        "kind": "improved",
        "text": "Agents get a short system prompt and the skills of the plugins you have on. Model lists and agent updates are checked in the background."
      },
      {
        "kind": "improved",
        "text": "Service keys are sealed with your system's keychain, and Studio uses your proxy."
      },
      {
        "kind": "improved",
        "text": "A paid generation is not lost or paid twice when the app restarts."
      },
      {
        "kind": "fixed",
        "text": "Drafts for other editing apps keep subtitle styles, separate audio rows and a talking head's own sound."
      },
      {
        "kind": "fixed",
        "text": "Local models install and run in the desktop app, on Windows too."
      },
      {
        "kind": "fixed",
        "text": "Recordings of hours open, play and show their waveform. Caption tracks survive the agent's writes, and a corrected caption word keeps its timing."
      },
      {
        "kind": "fixed",
        "text": "Many smaller fixes. The changelog on GitHub lists every change."
      }
    ],
    "zh-CN": [
      {
        "kind": "new",
        "text": "插件：剪辑、画布和新的放映都是插件，可以单独打开或关闭；任何人都能做插件。"
      },
      {
        "kind": "new",
        "text": "社区（测试版）：查找、添加和发布插件、技能、素材包和示例。项目自带的技能要你允许后，智能体才会读到。"
      },
      {
        "kind": "new",
        "text": "片段和页面里的元素可以用关键帧动起来，支持蒙版、按字或按词的文字动画，以及 3D 摆放。"
      },
      {
        "kind": "new",
        "text": "效果可以做动画：模糊、发光、亮度、对比度、饱和度、灰度、色相和反相，并可选择变换中心点。"
      },
      {
        "kind": "new",
        "text": "用 .cube、OpenColorIO 和 ASC 色彩文件按素材原有位深调色，也可以试用调色编辑器（测试版）。"
      },
      {
        "kind": "new",
        "text": "连接器让智能体能用上 Dropbox、Frame.io、Notion、Vimeo、Adobe 和 Canva。"
      },
      {
        "kind": "new",
        "text": "指向某个片段、某一时刻、某一段或画布节点的链接，无论从哪里点开都会在 Studio 里打开。"
      },
      {
        "kind": "new",
        "text": "导出可以指定码率或文件大小；声音默认调到 -14 LUFS，并防止爆音。"
      },
      {
        "kind": "new",
        "text": "我的声音：用你自己的录音做一个声音。配音也可以是两个声音的对话。"
      },
      {
        "kind": "new",
        "text": "在本机去除视频背景、修饰人脸，预览和导出都生效。"
      },
      {
        "kind": "new",
        "text": "移动鼠标即可预览时间线（S 键开关），用 + 和 - 缩放时间线。"
      },
      {
        "kind": "new",
        "text": "项目管理像文件浏览器：文件夹、大图和详细列表、拖放和批量移动。"
      },
      {
        "kind": "new",
        "text": "新模型：Seedance 2.5 Flash 和 Seedream 5.5，豆包完整音色列表和语音识别 2.0，Google 按参考图生成图片。"
      },
      {
        "kind": "improved",
        "text": "以素材为主的片子导出快好几倍；用显卡导出的文件更小、画面更清晰。"
      },
      {
        "kind": "improved",
        "text": "从本机导入的素材不再占两份空间，移动或改名的素材也能自动找回。"
      },
      {
        "kind": "improved",
        "text": "服务生成的图片、视频或配音会显示它的提示词、模型和服务商。"
      },
      {
        "kind": "improved",
        "text": "智能体拿到的是一份简短的系统提示，加上已打开插件自带的技能；模型列表和智能体更新在后台检查。"
      },
      {
        "kind": "improved",
        "text": "服务的密钥用系统钥匙串加密保存，Studio 也会走你设置的代理。"
      },
      {
        "kind": "improved",
        "text": "付费生成在应用重启后不会丢失，也不会重复扣费。"
      },
      {
        "kind": "fixed",
        "text": "导出给其他剪辑软件的草稿保留字幕样式、独立的音频轨，以及口播视频自带的声音。"
      },
      {
        "kind": "fixed",
        "text": "桌面端可以安装和运行本地模型，Windows 上也可以。"
      },
      {
        "kind": "fixed",
        "text": "几个小时的录音也能打开、播放并显示波形；智能体写入后字幕轨不会丢失；改正字幕里的词会保留它的时间。"
      },
      {
        "kind": "fixed",
        "text": "还有许多小修复，GitHub 上的更新日志列出了全部改动。"
      }
    ],
    "ja": [
      {
        "kind": "new",
        "text": "プラグイン：編集、キャンバス、新しい試写はプラグインになり、個別にオン・オフできます。誰でもプラグインを作れます。"
      },
      {
        "kind": "new",
        "text": "コミュニティ（テスト版）：プラグイン、スキル、素材パック、サンプルを探して追加・公開できます。プロジェクト付属のスキルは、許可するまでエージェントに読まれません。"
      },
      {
        "kind": "new",
        "text": "クリップやページ内の要素をキーフレームで動かせます。マスク、文字・単語単位のテキストアニメーション、3D 配置にも対応。"
      },
      {
        "kind": "new",
        "text": "エフェクトをアニメーションできます：ぼかし、グロー、明るさ、コントラスト、彩度、グレースケール、色相、反転。基準点も選べます。"
      },
      {
        "kind": "new",
        "text": ".cube、OpenColorIO、ASC のカラーファイルで素材本来のビット深度のままグレーディングでき、カラーエディター（ベータ）も試せます。"
      },
      {
        "kind": "new",
        "text": "コネクタで、エージェントが Dropbox、Frame.io、Notion、Vimeo、Adobe、Canva を使えます。"
      },
      {
        "kind": "new",
        "text": "クリップ、時刻、区間、キャンバスのノードへのリンクは、どこから開いても Studio で開きます。"
      },
      {
        "kind": "new",
        "text": "ビットレートやファイルサイズを指定して書き出せます。音声は既定で -14 LUFS に整え、音割れを防ぎます。"
      },
      {
        "kind": "new",
        "text": "マイボイス：自分の録音から声を作れます。ナレーションを 2 人の声の対話にもできます。"
      },
      {
        "kind": "new",
        "text": "動画の背景除去と顔のレタッチをこのコンピューターで行い、プレビューと書き出しの両方に反映します。"
      },
      {
        "kind": "new",
        "text": "マウスを動かしてタイムラインをプレビュー（S キー）、+ と - でズームできます。"
      },
      {
        "kind": "new",
        "text": "プロジェクト管理がファイルブラウザーのようになりました：フォルダー、アイコン・詳細表示、ドラッグ＆ドロップ、一括移動。"
      },
      {
        "kind": "new",
        "text": "新しいモデル：Seedance 2.5 Flash と Seedream 5.5、Doubao の全ボイスと音声認識 2.0、参照画像からの Google 画像生成。"
      },
      {
        "kind": "improved",
        "text": "素材中心の書き出しが数倍速くなり、グラフィックチップでの書き出しは小さく、画質も向上しました。"
      },
      {
        "kind": "improved",
        "text": "このコンピューターから取り込んだ素材が容量を二重に使わなくなり、移動・名前変更した素材も自動で見つけ直します。"
      },
      {
        "kind": "improved",
        "text": "サービスが作った画像、クリップ、音声は、プロンプト、モデル、サービスを表示します。"
      },
      {
        "kind": "improved",
        "text": "エージェントには短いシステムプロンプトと、オンのプラグインのスキルが渡ります。モデル一覧とエージェントの更新はバックグラウンドで確認します。"
      },
      {
        "kind": "improved",
        "text": "サービスのキーはシステムのキーチェーンで保護され、Studio はプロキシ設定に従います。"
      },
      {
        "kind": "improved",
        "text": "有料の生成は、アプリを再起動しても失われず、二重に課金されません。"
      },
      {
        "kind": "fixed",
        "text": "他の編集アプリ向けの下書きで、字幕スタイル、別々の音声トラック、トーキングヘッドの音声が保たれます。"
      },
      {
        "kind": "fixed",
        "text": "デスクトップアプリでローカルモデルをインストール・実行できます。Windows でも動きます。"
      },
      {
        "kind": "fixed",
        "text": "数時間の録音も開いて再生でき、波形も表示されます。エージェントが書き込んでも字幕トラックは消えず、修正した字幕の単語はタイミングを保ちます。"
      },
      {
        "kind": "fixed",
        "text": "その他多数の修正。GitHub の変更履歴にすべての変更があります。"
      }
    ],
    "ko": [
      {
        "kind": "new",
        "text": "플러그인: 편집, 캔버스, 새로운 시사는 각각 켜고 끌 수 있는 플러그인입니다. 누구나 플러그인을 만들 수 있습니다."
      },
      {
        "kind": "new",
        "text": "커뮤니티(테스트 버전): 플러그인, 스킬, 소재 팩, 예제를 찾아 추가하고 게시할 수 있습니다. 프로젝트에 딸린 스킬은 허용해야만 에이전트가 읽습니다."
      },
      {
        "kind": "new",
        "text": "클립과 페이지 요소를 키프레임으로 움직일 수 있습니다. 마스크, 글자·단어 단위 텍스트 애니메이션, 3D 배치도 지원합니다."
      },
      {
        "kind": "new",
        "text": "효과를 애니메이션할 수 있습니다: 흐림, 글로우, 밝기, 대비, 채도, 흑백, 색조, 반전. 기준점도 고를 수 있습니다."
      },
      {
        "kind": "new",
        "text": ".cube, OpenColorIO, ASC 색상 파일로 소재 본래의 비트 심도 그대로 색 보정하고, 컬러 편집기(베타)도 써 볼 수 있습니다."
      },
      {
        "kind": "new",
        "text": "커넥터로 에이전트가 Dropbox, Frame.io, Notion, Vimeo, Adobe, Canva를 쓸 수 있습니다."
      },
      {
        "kind": "new",
        "text": "클립, 시점, 구간, 캔버스 노드로 가는 링크는 어디서 열어도 Studio에서 열립니다."
      },
      {
        "kind": "new",
        "text": "비트레이트나 파일 크기를 정해 내보낼 수 있습니다. 소리는 기본으로 -14 LUFS에 맞추고 클리핑을 막습니다."
      },
      {
        "kind": "new",
        "text": "내 목소리: 내 녹음으로 목소리를 만들 수 있습니다. 내레이션을 두 목소리의 대화로도 만들 수 있습니다."
      },
      {
        "kind": "new",
        "text": "영상 배경 제거와 얼굴 보정을 이 컴퓨터에서 처리하고, 미리보기와 내보내기에 모두 적용합니다."
      },
      {
        "kind": "new",
        "text": "마우스를 움직여 타임라인을 미리 보고(S 키), + 와 - 로 확대·축소할 수 있습니다."
      },
      {
        "kind": "new",
        "text": "프로젝트 관리가 파일 탐색기처럼 바뀌었습니다: 폴더, 아이콘·자세히 보기, 끌어 놓기, 일괄 이동."
      },
      {
        "kind": "new",
        "text": "새 모델: Seedance 2.5 Flash와 Seedream 5.5, Doubao 전체 음성 목록과 음성 인식 2.0, 참조 이미지로 만드는 Google 그림."
      },
      {
        "kind": "improved",
        "text": "소재 위주의 내보내기가 몇 배 빨라졌고, 그래픽 칩으로 내보낸 파일은 더 작고 선명합니다."
      },
      {
        "kind": "improved",
        "text": "이 컴퓨터에서 가져온 소재가 공간을 두 번 차지하지 않고, 옮기거나 이름을 바꾼 소재도 다시 찾아냅니다."
      },
      {
        "kind": "improved",
        "text": "서비스가 만든 그림, 클립, 음성은 프롬프트, 모델, 서비스를 보여 줍니다."
      },
      {
        "kind": "improved",
        "text": "에이전트는 짧은 시스템 프롬프트와 켜 둔 플러그인의 스킬을 받습니다. 모델 목록과 에이전트 업데이트는 백그라운드에서 확인합니다."
      },
      {
        "kind": "improved",
        "text": "서비스 키는 시스템 키체인으로 보호되고, Studio는 프록시 설정을 따릅니다."
      },
      {
        "kind": "improved",
        "text": "유료 생성은 앱을 다시 시작해도 사라지거나 두 번 결제되지 않습니다."
      },
      {
        "kind": "fixed",
        "text": "다른 편집 앱용 초안에서 자막 스타일, 분리된 오디오 트랙, 토킹 헤드의 소리가 유지됩니다."
      },
      {
        "kind": "fixed",
        "text": "데스크톱 앱에서 로컬 모델을 설치하고 실행할 수 있습니다. Windows에서도 됩니다."
      },
      {
        "kind": "fixed",
        "text": "몇 시간짜리 녹음도 열고 재생하며 파형을 보여 줍니다. 에이전트가 써도 자막 트랙이 사라지지 않고, 고친 자막 단어는 타이밍을 유지합니다."
      },
      {
        "kind": "fixed",
        "text": "그 밖의 많은 수정. GitHub 변경 기록에 모든 변경이 있습니다."
      }
    ],
    "es": [
      {
        "kind": "new",
        "text": "Plugins: Edición, Lienzo y la nueva Proyección son plugins que activas o desactivas, y cualquiera puede crear uno."
      },
      {
        "kind": "new",
        "text": "La Comunidad (en pruebas): busca, añade y publica plugins, habilidades, paquetes de la biblioteca y ejemplos. Las habilidades propias de un proyecto solo llegan a tu agente cuando las permites."
      },
      {
        "kind": "new",
        "text": "Los clips y los elementos de una página se mueven con fotogramas clave, con máscaras, texto animado por letras o palabras y colocación en 3D."
      },
      {
        "kind": "new",
        "text": "Anima efectos: desenfoque, brillo difuso, luminosidad, contraste, saturación, escala de grises, tono e inversión, alrededor del punto de anclaje que elijas."
      },
      {
        "kind": "new",
        "text": "Etalona con archivos de color .cube, OpenColorIO y ASC a la profundidad de bits original, y prueba el editor de Color (beta)."
      },
      {
        "kind": "new",
        "text": "Los conectores dejan que tu agente use Dropbox, Frame.io, Notion, Vimeo, Adobe y Canva."
      },
      {
        "kind": "new",
        "text": "Los enlaces a un clip, un momento, un tramo o un nodo del lienzo se abren en Studio vengan de donde vengan."
      },
      {
        "kind": "new",
        "text": "Exporta a una tasa de bits o un tamaño de archivo. El sonido se lleva a -14 LUFS por defecto y se evita que sature."
      },
      {
        "kind": "new",
        "text": "Mis voces: crea una voz a partir de tu propia grabación. La locución puede ser un diálogo a dos voces."
      },
      {
        "kind": "new",
        "text": "Quita el fondo de un vídeo y retoca caras en tu ordenador, en la vista previa y al exportar."
      },
      {
        "kind": "new",
        "text": "Previsualiza la línea de tiempo moviendo el ratón (S) y haz zoom con + y -."
      },
      {
        "kind": "new",
        "text": "Los proyectos funcionan como un explorador de archivos: carpetas, vistas de iconos y detalles, arrastrar y soltar, y movimientos por lotes."
      },
      {
        "kind": "new",
        "text": "Modelos nuevos: Seedance 2.5 Flash y Seedream 5.5, la lista completa de voces de Doubao y su reconocimiento de voz 2.0, e imágenes de Google a partir de imágenes de referencia."
      },
      {
        "kind": "improved",
        "text": "Las exportaciones de metraje son varias veces más rápidas, y las del chip gráfico ocupan menos y se ven mejor."
      },
      {
        "kind": "improved",
        "text": "El material de este ordenador ya no ocupa el doble, y el material movido o renombrado se vuelve a encontrar."
      },
      {
        "kind": "improved",
        "text": "Una imagen, un clip o una voz que hizo un servicio muestran su prompt, su modelo y su servicio."
      },
      {
        "kind": "improved",
        "text": "Los agentes reciben un prompt de sistema breve y las habilidades de los plugins activos. Las listas de modelos y las actualizaciones de agentes se comprueban en segundo plano."
      },
      {
        "kind": "improved",
        "text": "Las claves de los servicios se guardan selladas con el llavero del sistema, y Studio usa tu proxy."
      },
      {
        "kind": "improved",
        "text": "Una generación de pago no se pierde ni se cobra dos veces si la app se reinicia."
      },
      {
        "kind": "fixed",
        "text": "Los borradores para otras apps de edición conservan el estilo de los subtítulos, las pistas de audio separadas y el sonido propio de una persona hablando a cámara."
      },
      {
        "kind": "fixed",
        "text": "Los modelos locales se instalan y funcionan en la app de escritorio, también en Windows."
      },
      {
        "kind": "fixed",
        "text": "Las grabaciones de horas se abren, se reproducen y muestran su forma de onda. Las pistas de subtítulos sobreviven a lo que escribe el agente, y una palabra corregida conserva su tiempo."
      },
      {
        "kind": "fixed",
        "text": "Muchas correcciones menores. El registro de cambios en GitHub recoge cada cambio."
      }
    ]
  }
};

/** -1, 0 or 1 as `a` is older than, the same as or newer than `b` (x.y.z; a pre-release is older than its release). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const at = v.indexOf('-');
    return { parts: (at < 0 ? v : v.slice(0, at)).split('.').map((n) => Number(n) || 0), pre: at < 0 ? '' : v.slice(at + 1) };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.parts[i] ?? 0) - (y.parts[i] ?? 0);
    if (d) return Math.sign(d);
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return Math.sign(x.pre.localeCompare(y.pre, 'en', { numeric: true }));
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
