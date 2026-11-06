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
  version: '0.3.0',
  date: '2026-11-06',
  notes: {
    en: [
      { kind: 'new', text: 'The canvas: a board beside the edit where you lay out notes, pictures, clips, voice-over, music and sound, wire them into each other and make each with your services. Send what you made to the timeline in order.' },
      { kind: 'new', text: 'A project can have several canvases, each also seen as a storyboard. ⌘E (Ctrl+E) switches between the edit and the canvas, and each stays as you left it.' },
      { kind: 'new', text: 'OpenFilm\'s library in the assets drawer: footage, voices, sounds, music, text, stickers, filters, effects, transitions and templates, free to use in any film.' },
      { kind: 'new', text: 'Agents look in the library first: they search it by what you mean, in any language, and make something only when nothing there fits.' },
      { kind: 'new', text: 'Templates ask for your own clips before they go in, and play as one compound clip that you can open and edit. A film can be a clip of another film.' },
      { kind: 'new', text: 'Skills live in the library: Discover OpenFilm\'s and the community\'s, install them, or try one in a conversation without installing it.' },
      { kind: 'new', text: 'OpenFilm as a service: sign in once and make voice-over, music, sound, pictures and video without keys of your own.' },
      { kind: 'new', text: 'New services: OpenRouter for pictures and video, Inworld and Cartesia for voice-over timed word by word, and Google\'s Gemini Omni for clips with their own sound.' },
      { kind: 'new', text: 'Record sound from the microphone straight onto the timeline.' },
      { kind: 'new', text: 'Caption tracks: words on the picture are tracks you can see, style and edit, with 18 looks to start from. Your agent translates them with its own model.' },
      { kind: 'new', text: 'Clips can move: put a motion from the library on a clip, or have the agent write one.' },
      { kind: 'new', text: 'Undo a chat turn: the last reply\'s Undo puts the project\'s files back as the turn found them, and its message back in the composer.' },
      { kind: 'new', text: 'A voice chosen in the library\'s Voices goes into the chat as a reference, and the agent makes the voice-over in it.' },
      { kind: 'improved', text: 'The inspector shows the categories that fit what you selected, right above their controls. A locked track\'s clip can be looked at.' },
      { kind: 'improved', text: 'Project and conversation cards show a summary, the film\'s cover and their actions on a bar at the top. Untitled conversations are New chat.' },
      { kind: 'improved', text: 'Settings › Services is one page, with OpenFilm first and the connected services ahead. Each service\'s card links its own pricing page.' },
      { kind: 'improved', text: 'A master-quality export keeps dark, smooth gradients smooth: frames are taken without loss, footage is copied near the original, and HEVC is written in 10 bits.' },
      { kind: 'improved', text: 'Exports can bring the sound to a delivery loudness, such as -14 LUFS, with true peaks held under -1 dBTP.' },
      { kind: 'improved', text: 'Detach audio works on several selected videos at once, one undo.' },
      { kind: 'improved', text: 'Dragging a layer on a heavy page keeps its frame with the picture. Bring to front and Send to back move only the clip, not its whole track.' },
      { kind: 'improved', text: 'Moving the library to another disk never leaves a project in two places, and nothing is deleted for good when the Recycle Bin can\'t take it.' },
      { kind: 'fixed', text: 'A script or agent that changes film.html while Studio is open is no longer reverted by Studio on its second change.' },
      { kind: 'fixed', text: 'A clip trimmed to the very end of its file no longer makes the export fail.' },
      { kind: 'fixed', text: 'An exported mix no longer comes out half a second shorter than the film.' },
    ],
    'zh-CN': [
      { kind: 'new', text: '画布：剪辑旁边的一块白板，可以摆笔记、图片、视频、配音、音乐和音效，把它们连起来，用你的服务逐个生成。做好的内容可以按顺序送到时间线。' },
      { kind: 'new', text: '一个项目可以有多个画布，每个画布也能看成分镜。⌘E（Ctrl+E）在剪辑和画布之间切换，两边都保持你离开时的样子。' },
      { kind: 'new', text: '素材库在素材抽屉里：视频素材、音色、音效、音乐、文字、贴纸、滤镜、特效、转场和模板，任何影片都能免费使用。' },
      { kind: 'new', text: 'Agent 先找素材库：按你的意思检索，任何语言都行，里面没有合适的才去生成。' },
      { kind: 'new', text: '模板加入前会先要你自己的素材，加入后是一个复合片段，可以打开编辑。一部影片也可以作为另一部影片的片段。' },
      { kind: 'new', text: '技能放进了素材库：发现 OpenFilm 官方和社区的技能，可以安装，也可以不安装直接在对话里试用。' },
      { kind: 'new', text: 'OpenFilm 服务：登录一次，就能生成配音、音乐、音效、图片和视频，不需要自己的密钥。' },
      { kind: 'new', text: '新服务：OpenRouter 生成图片和视频，Inworld 和 Cartesia 提供逐词对齐的配音，Google 的 Gemini Omni 生成自带声音的视频。' },
      { kind: 'new', text: '可以直接用麦克风录音到时间线上。' },
      { kind: 'new', text: '字幕轨：画面上的文字都是轨道，可以查看、设置样式和编辑，有 18 种样式可选。你的 Agent 会用它自己的模型翻译字幕。' },
      { kind: 'new', text: '片段可以动起来：从素材库给片段加一个动效，或者让 Agent 写一个。' },
      { kind: 'new', text: '撤销一轮对话：最后一条回复的「撤销」会把项目文件恢复成这一轮开始时的样子，并把消息放回输入框。' },
      { kind: 'new', text: '在素材库「音色」里选的音色可以作为引用放进对话，Agent 会用这个音色配音。' },
      { kind: 'improved', text: '属性面板按你选中的内容显示对应的分类，分类就在控件上方。锁定轨道上的片段也能查看。' },
      { kind: 'improved', text: '项目和对话的悬停卡片会显示摘要、影片封面，操作放在顶部一栏。未命名的对话显示为「新对话」。' },
      { kind: 'improved', text: '设置 › 服务合成一页：OpenFilm 在最前，已连接的服务排在前面。每个服务的卡片都链接到它自己的价格页。' },
      { kind: 'improved', text: 'master 画质导出不再让深色渐变出现色带：截帧无损，素材副本接近原片，HEVC 以 10 位输出。' },
      { kind: 'improved', text: '导出可以把声音调到交付要求的响度，比如 -14 LUFS，真峰值控制在 -1 dBTP 以下。' },
      { kind: 'improved', text: '「分离音频」可以对多个选中的视频一次完成，一步撤销。' },
      { kind: 'improved', text: '在内容较重的页面上拖动图层，选框会跟着画面走。「移到最前 / 最后」只移动当前片段，不再移动整条轨道。' },
      { kind: 'improved', text: '把素材库移到另一块磁盘时，项目不会再同时留在两处；回收站放不下时也不会永久删除任何东西。' },
      { kind: 'fixed', text: 'Studio 开着时，用脚本或 Agent 修改 film.html，第二次修改不会再被 Studio 改回去。' },
      { kind: 'fixed', text: '片段剪到素材的最末尾时，导出不再失败。' },
      { kind: 'fixed', text: '导出的混音不再比影片短半秒。' },
    ],
    ja: [
      { kind: 'new', text: 'キャンバス：編集の隣のボードに、メモ、画像、動画、ナレーション、音楽、効果音を並べてつなぎ、あなたのサービスで一つずつ生成できます。作ったものは順番どおりにタイムラインへ送れます。' },
      { kind: 'new', text: '1つのプロジェクトに複数のキャンバスを持て、それぞれ絵コンテとしても見られます。⌘E（Ctrl+E）で編集とキャンバスを切り替え、どちらも離れたときのままです。' },
      { kind: 'new', text: '素材ドロワーに OpenFilm のライブラリ：映像素材、ボイス、効果音、音楽、テキスト、ステッカー、フィルター、エフェクト、トランジション、テンプレートを、どの作品でも無料で使えます。' },
      { kind: 'new', text: 'エージェントはまずライブラリを探します。意味で検索し、どの言語でも通じ、合うものがないときだけ生成します。' },
      { kind: 'new', text: 'テンプレートは入れる前にあなたの素材を求め、開いて編集できる1つの複合クリップとして入ります。作品を別の作品のクリップにもできます。' },
      { kind: 'new', text: 'スキルはライブラリに：OpenFilm とコミュニティのスキルを見つけてインストールするか、インストールせずに会話で試せます。' },
      { kind: 'new', text: 'サービスとしての OpenFilm：一度サインインすれば、自分のキーなしでナレーション、音楽、効果音、画像、動画を作れます。' },
      { kind: 'new', text: '新しいサービス：画像と動画の OpenRouter、単語ごとにタイミングが合う Inworld と Cartesia のナレーション、音声付きクリップを作る Google の Gemini Omni。' },
      { kind: 'new', text: 'マイクの音をそのままタイムラインに録音できます。' },
      { kind: 'new', text: '字幕トラック：画面上の文字はトラックとして表示・スタイル設定・編集でき、18種類のスタイルから始められます。翻訳はエージェントが自分のモデルで行います。' },
      { kind: 'new', text: 'クリップを動かせます：ライブラリのモーションをクリップに付けるか、エージェントに書かせます。' },
      { kind: 'new', text: '会話のターンを取り消し：最後の返信の「元に戻す」で、プロジェクトのファイルがそのターンの始まりの状態に戻り、メッセージも入力欄に戻ります。' },
      { kind: 'new', text: 'ライブラリの「ボイス」で選んだ声を会話に参照として入れると、エージェントがその声でナレーションを作ります。' },
      { kind: 'improved', text: 'インスペクターは選んだものに合うカテゴリーを、操作のすぐ上に表示します。ロックされたトラックのクリップも確認できます。' },
      { kind: 'improved', text: 'プロジェクトと会話のカードに概要、作品のカバー、上部の操作バーを表示します。名前のない会話は「新しいチャット」です。' },
      { kind: 'improved', text: '設定 › サービスは1ページに：OpenFilm が先頭、接続済みのサービスが前に並びます。各サービスのカードから料金ページへ移動できます。' },
      { kind: 'improved', text: 'マスター画質の書き出しで、暗く滑らかなグラデーションに縞が出なくなりました：フレームは劣化なく取り込み、素材のコピーは元に近く、HEVC は10ビットで書き出します。' },
      { kind: 'improved', text: '書き出しで音を納品用のラウドネス（例：-14 LUFS）に合わせ、トゥルーピークを -1 dBTP 未満に抑えられます。' },
      { kind: 'improved', text: '「オーディオを分離」を、選んだ複数の動画に一度に、取り消し1回でできます。' },
      { kind: 'improved', text: '重いページでレイヤーをドラッグしても、枠が画像についてきます。「最前面へ／最背面へ」はトラック全体ではなくそのクリップだけを動かします。' },
      { kind: 'improved', text: 'ライブラリを別のディスクに移しても、プロジェクトが2か所に残ることはなく、ごみ箱に入らないときも完全に削除されることはありません。' },
      { kind: 'fixed', text: 'Studio を開いたままスクリプトやエージェントが film.html を変えても、2回目の変更が Studio に戻されることはなくなりました。' },
      { kind: 'fixed', text: 'ファイルの最後までトリムしたクリップで書き出しが失敗しなくなりました。' },
      { kind: 'fixed', text: '書き出したミックスが作品より0.5秒短くなることはなくなりました。' },
    ],
    ko: [
      { kind: 'new', text: '캔버스: 편집 옆 보드에 메모, 이미지, 영상, 내레이션, 음악, 효과음을 놓고 서로 연결해 내 서비스로 하나씩 만들 수 있습니다. 만든 것은 순서대로 타임라인에 보낼 수 있습니다.' },
      { kind: 'new', text: '프로젝트마다 캔버스를 여러 개 둘 수 있고, 각각 스토리보드로도 볼 수 있습니다. ⌘E(Ctrl+E)로 편집과 캔버스를 전환하며, 둘 다 떠날 때 그대로 남습니다.' },
      { kind: 'new', text: '에셋 서랍의 OpenFilm 라이브러리: 영상 소스, 보이스, 효과음, 음악, 텍스트, 스티커, 필터, 이펙트, 트랜지션, 템플릿을 어떤 작품에서나 무료로 쓸 수 있습니다.' },
      { kind: 'new', text: '에이전트는 먼저 라이브러리를 찾습니다. 뜻으로, 어떤 언어로든 검색하고, 맞는 것이 없을 때만 새로 만듭니다.' },
      { kind: 'new', text: '템플릿은 넣기 전에 내 소스를 요청하고, 열어서 편집할 수 있는 하나의 복합 클립으로 들어갑니다. 작품을 다른 작품의 클립으로 쓸 수도 있습니다.' },
      { kind: 'new', text: '스킬은 라이브러리에: OpenFilm과 커뮤니티의 스킬을 찾아 설치하거나, 설치하지 않고 대화에서 바로 써 볼 수 있습니다.' },
      { kind: 'new', text: '서비스로서의 OpenFilm: 한 번 로그인하면 내 키 없이 내레이션, 음악, 효과음, 이미지, 영상을 만들 수 있습니다.' },
      { kind: 'new', text: '새 서비스: 이미지와 영상의 OpenRouter, 단어 단위로 타이밍이 맞는 Inworld와 Cartesia 내레이션, 소리가 있는 클립을 만드는 Google의 Gemini Omni.' },
      { kind: 'new', text: '마이크 소리를 타임라인에 바로 녹음할 수 있습니다.' },
      { kind: 'new', text: '자막 트랙: 화면의 글자는 보고, 스타일을 정하고, 편집할 수 있는 트랙이며 18가지 스타일로 시작할 수 있습니다. 번역은 에이전트가 자기 모델로 합니다.' },
      { kind: 'new', text: '클립을 움직일 수 있습니다: 라이브러리의 모션을 클립에 넣거나 에이전트에게 쓰게 하세요.' },
      { kind: 'new', text: '대화 턴 되돌리기: 마지막 답장의 되돌리기로 프로젝트 파일이 그 턴이 시작될 때로 돌아가고, 메시지는 입력창으로 돌아옵니다.' },
      { kind: 'new', text: '라이브러리 보이스에서 고른 목소리를 대화에 참조로 넣으면, 에이전트가 그 목소리로 내레이션을 만듭니다.' },
      { kind: 'improved', text: '인스펙터는 선택한 것에 맞는 분류를 컨트롤 바로 위에 보여 줍니다. 잠긴 트랙의 클립도 볼 수 있습니다.' },
      { kind: 'improved', text: '프로젝트와 대화 카드에 요약, 작품 표지, 상단 작업 막대가 표시됩니다. 제목 없는 대화는 새 채팅입니다.' },
      { kind: 'improved', text: '설정 › 서비스가 한 페이지가 되었습니다. OpenFilm이 맨 앞, 연결된 서비스가 앞에 옵니다. 각 서비스 카드에서 요금 페이지로 갈 수 있습니다.' },
      { kind: 'improved', text: '마스터 화질로 내보낼 때 어둡고 부드러운 그라데이션에 띠가 생기지 않습니다: 프레임은 손실 없이, 소스 사본은 원본에 가깝게, HEVC는 10비트로 씁니다.' },
      { kind: 'improved', text: '내보내기에서 소리를 납품 라우드니스(예: -14 LUFS)에 맞추고 트루 피크를 -1 dBTP 아래로 유지할 수 있습니다.' },
      { kind: 'improved', text: '오디오 분리를 선택한 여러 영상에 한 번에, 되돌리기 한 번으로 할 수 있습니다.' },
      { kind: 'improved', text: '무거운 페이지에서 레이어를 끌어도 테두리가 그림을 따라옵니다. 맨 앞으로/맨 뒤로는 트랙 전체가 아니라 그 클립만 옮깁니다.' },
      { kind: 'improved', text: '라이브러리를 다른 디스크로 옮겨도 프로젝트가 두 곳에 남지 않고, 휴지통이 받지 못할 때도 영구 삭제되지 않습니다.' },
      { kind: 'fixed', text: 'Studio가 열린 동안 스크립트나 에이전트가 film.html을 바꿔도, 두 번째 변경을 Studio가 되돌리지 않습니다.' },
      { kind: 'fixed', text: '파일 끝까지 트림한 클립 때문에 내보내기가 실패하지 않습니다.' },
      { kind: 'fixed', text: '내보낸 믹스가 작품보다 0.5초 짧게 나오지 않습니다.' },
    ],
    es: [
      { kind: 'new', text: 'El lienzo: un tablero junto a la edición donde colocas notas, imágenes, clips, locución, música y sonidos, los conectas entre sí y creas cada uno con tus servicios. Lo que hagas pasa a la línea de tiempo en orden.' },
      { kind: 'new', text: 'Un proyecto puede tener varios lienzos, y cada uno se ve también como guion gráfico. ⌘E (Ctrl+E) cambia entre la edición y el lienzo, y cada uno queda como lo dejaste.' },
      { kind: 'new', text: 'La biblioteca de OpenFilm en el panel de recursos: metraje, voces, sonidos, música, textos, pegatinas, filtros, efectos, transiciones y plantillas, libres para usar en cualquier película.' },
      { kind: 'new', text: 'Los agentes buscan primero en la biblioteca, por lo que quieres decir y en cualquier idioma, y solo crean algo cuando nada encaja.' },
      { kind: 'new', text: 'Las plantillas piden tus propios clips antes de entrar y se reproducen como un clip compuesto que puedes abrir y editar. Una película puede ser un clip de otra.' },
      { kind: 'new', text: 'Las habilidades están en la biblioteca: descubre las de OpenFilm y de la comunidad, instálalas o prueba una en una conversación sin instalarla.' },
      { kind: 'new', text: 'OpenFilm como servicio: inicia sesión una vez y crea locución, música, sonidos, imágenes y vídeo sin claves propias.' },
      { kind: 'new', text: 'Nuevos servicios: OpenRouter para imágenes y vídeo, Inworld y Cartesia para locuciones sincronizadas palabra por palabra, y Gemini Omni de Google para clips con su propio sonido.' },
      { kind: 'new', text: 'Graba sonido del micrófono directamente en la línea de tiempo.' },
      { kind: 'new', text: 'Pistas de subtítulos: el texto sobre la imagen son pistas que ves, editas y das estilo, con 18 estilos para empezar. Tu agente los traduce con su propio modelo.' },
      { kind: 'new', text: 'Los clips pueden moverse: pon un movimiento de la biblioteca en un clip o pide al agente que lo escriba.' },
      { kind: 'new', text: 'Deshacer un turno del chat: el botón Deshacer de la última respuesta devuelve los archivos del proyecto a como estaban al empezar el turno, y su mensaje al cuadro de texto.' },
      { kind: 'new', text: 'Una voz elegida en Voces de la biblioteca entra en el chat como referencia, y el agente hace la locución con ella.' },
      { kind: 'improved', text: 'El inspector muestra las categorías que corresponden a lo seleccionado, justo encima de sus controles. Un clip de una pista bloqueada se puede consultar.' },
      { kind: 'improved', text: 'Las tarjetas de proyecto y de conversación muestran un resumen, la portada de la película y sus acciones en una barra arriba. Las conversaciones sin título son Chat nuevo.' },
      { kind: 'improved', text: 'Ajustes › Servicios es una sola página, con OpenFilm primero y los servicios conectados delante. La tarjeta de cada servicio enlaza su página de precios.' },
      { kind: 'improved', text: 'Una exportación en calidad máster mantiene suaves los degradados oscuros: los fotogramas se toman sin pérdida, el metraje se copia casi como el original y el HEVC se escribe en 10 bits.' },
      { kind: 'improved', text: 'Las exportaciones pueden llevar el sonido a una sonoridad de entrega, como -14 LUFS, con los picos reales por debajo de -1 dBTP.' },
      { kind: 'improved', text: 'Separar audio funciona en varios vídeos seleccionados a la vez, con un solo deshacer.' },
      { kind: 'improved', text: 'Al arrastrar una capa en una página pesada, su marco sigue a la imagen. Traer al frente y Enviar al fondo mueven solo el clip, no toda su pista.' },
      { kind: 'improved', text: 'Mover la biblioteca a otro disco ya no deja un proyecto en dos sitios, y nada se borra para siempre cuando la Papelera no puede recibirlo.' },
      { kind: 'fixed', text: 'Si un script o un agente cambia film.html con Studio abierto, Studio ya no deshace su segundo cambio.' },
      { kind: 'fixed', text: 'Un clip recortado hasta el final de su archivo ya no hace fallar la exportación.' },
      { kind: 'fixed', text: 'La mezcla exportada ya no sale medio segundo más corta que la película.' },
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
