/**
 * What each release brings, said to the person after an update, in every language Studio speaks (a release without them
 * all does not compile), grouped as new, improved and fixed. The newest first. The dialog shows every release's under
 * the newest, so this is the history people read in their own language: the changelog on GitHub is in English.
 *
 * Written when a release is made (the "Version packages" pull request): the changesets say everything that changed,
 * for the changelog; these say every change a person would notice, in their words, one line each (at most 24). A
 * version without them fails the tests (whats-new.test.ts), so that pull request cannot be merged until they are
 * written.
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
    version: '0.2.5',
    date: '2026-10-21',
    notes: {
      en: [
        { kind: 'improved', text: 'Export › Editing project is two to four times faster and needs far less free disk space. You can choose how its pages are written; 剪映 and CapCut drafts show on the app’s home screen.' },
        { kind: 'improved', text: 'Exports keep the page’s colors in every format, and transparent HEVC and ProRes open as they should in Apple’s apps and in editors.' },
        { kind: 'improved', text: 'Exports are safer, on Windows above all: no broken file after a stop or a crash, nothing half-made left behind, and a full disk said plainly.' },
        { kind: 'new', text: 'DeepSeek Harness joins the agents the chat can use. Volume is in dB, up to +14 dB.' },
        { kind: 'improved', text: 'New project inside a folder makes it there, and renaming or moving a file keeps its subtitles.' },
        { kind: 'fixed', text: 'A mono voice exports as loud as it plays; bilingual burned-in subtitles show the translation once; ProRes footage plays and exports; the paused preview shows the exact frame.' },
      ],
      'zh-CN': [
        { kind: 'improved', text: '导出 › 剪辑工程快了 2 到 4 倍，需要的空闲磁盘空间也少得多。可以选择页面的写入方式；剪映和 CapCut 草稿会出现在它们的首页。' },
        { kind: 'improved', text: '各种格式的导出都保持页面原本的颜色；带透明的 HEVC 和 ProRes 在 Apple 的应用和剪辑软件里都能正确打开。' },
        { kind: 'improved', text: '导出更稳了，尤其在 Windows 上：停止或崩溃后不会留下损坏的文件，也不会残留半成品；磁盘满了会直接说明。' },
        { kind: 'new', text: '对话可以连接 DeepSeek Harness。音量改用 dB 显示，最高 +14 dB。' },
        { kind: 'improved', text: '在文件夹里新建项目会直接建在这个文件夹里；改名或移动文件时，字幕会跟着走。' },
        { kind: 'fixed', text: '单声道人声导出后和播放时一样响；双语字幕烧录时译文只显示一次；ProRes 素材能播放和导出；暂停时显示的就是精确的那一帧。' },
      ],
      ja: [
        { kind: 'improved', text: '書き出し › 編集プロジェクトが 2〜4 倍速くなり、必要な空き容量も大きく減りました。ページの書き出し方を選べ、剪映と CapCut の下書きはアプリのホームに表示されます。' },
        { kind: 'improved', text: 'どの形式でもページの色のまま書き出され、透過の HEVC と ProRes が Apple のアプリや編集ソフトで正しく開きます。' },
        { kind: 'improved', text: '書き出しがより安全になりました（特に Windows）。停止やクラッシュの後に壊れたファイルや作りかけのファイルが残らず、ディスクがいっぱいならそう伝えます。' },
        { kind: 'new', text: 'チャットで DeepSeek Harness を使えます。音量は dB 表示になり、最大 +14 dB です。' },
        { kind: 'improved', text: 'フォルダ内の新規プロジェクトはそのフォルダに作られ、ファイルの名前変更や移動で字幕も一緒に移ります。' },
        { kind: 'fixed', text: 'モノラルの声が再生時と同じ大きさで書き出され、二か国語の焼き込み字幕で訳が一度だけ表示され、ProRes の素材が再生・書き出しでき、一時停止中のプレビューが正確なフレームを表示します。' },
      ],
      ko: [
        { kind: 'improved', text: '내보내기 › 편집 프로젝트가 2~4배 빨라지고 필요한 여유 디스크 공간도 크게 줄었습니다. 페이지를 쓰는 방식을 고를 수 있고, 剪映와 CapCut 초안은 앱 홈 화면에 나타납니다.' },
        { kind: 'improved', text: '모든 형식에서 페이지 색 그대로 내보내고, 투명한 HEVC와 ProRes가 Apple 앱과 편집 프로그램에서 제대로 열립니다.' },
        { kind: 'improved', text: '내보내기가 더 안전해졌습니다(특히 Windows). 중지나 충돌 뒤에 깨진 파일이나 만들다 만 파일이 남지 않고, 디스크가 가득 차면 그렇게 알려 줍니다.' },
        { kind: 'new', text: '채팅에서 DeepSeek Harness를 쓸 수 있습니다. 음량은 dB로 표시되며 최대 +14 dB입니다.' },
        { kind: 'improved', text: '폴더 안에서 새 프로젝트를 만들면 그 폴더에 만들어지고, 파일 이름을 바꾸거나 옮겨도 자막이 함께 갑니다.' },
        { kind: 'fixed', text: '모노 음성이 재생할 때만큼 크게 내보내지고, 이중 언어 번인 자막의 번역이 한 번만 나오며, ProRes 소스가 재생·내보내기되고, 일시 정지한 미리 보기가 정확한 프레임을 보여 줍니다.' },
      ],
      es: [
        { kind: 'improved', text: 'Exportar › Proyecto de edición es de dos a cuatro veces más rápido y necesita mucho menos espacio libre. Puedes elegir cómo se escriben sus páginas; los borradores de 剪映 y CapCut aparecen en la pantalla de inicio de la app.' },
        { kind: 'improved', text: 'Las exportaciones mantienen los colores de la página en todos los formatos, y el HEVC y ProRes con transparencia se abren bien en las apps de Apple y en los editores.' },
        { kind: 'improved', text: 'Las exportaciones son más seguras, sobre todo en Windows: ningún archivo roto tras detenerla o un fallo, nada a medio hacer, y un disco lleno se dice con claridad.' },
        { kind: 'new', text: 'DeepSeek Harness se suma a los agentes del chat. El volumen va en dB, hasta +14 dB.' },
        { kind: 'improved', text: 'Nuevo proyecto dentro de una carpeta lo crea ahí, y al renombrar o mover un archivo sus subtítulos van con él.' },
        { kind: 'fixed', text: 'Una voz mono se exporta tan alta como suena; los subtítulos bilingües grabados muestran la traducción una vez; el material ProRes se reproduce y exporta; la vista previa en pausa muestra el fotograma exacto.' },
      ],
    },
  },
  {
    version: '0.2.4',
    date: '2026-10-20',
    notes: {
      en: [
        { kind: 'fixed', text: 'A new playback speed is heard the moment you pick it, and voices sound natural at any speed, even on long videos. The playback button shows a speed gauge, so it no longer looks like the inspector’s.' },
        { kind: 'fixed', text: 'The app’s own agent (your own key) keeps a long conversation going when it looks at many frames: older pictures are left out of each request, and a request a service finds too large is tried again with fewer.' },
      ],
      'zh-CN': [
        { kind: 'fixed', text: '换播放速度后立刻就有声音，任何速度下人声都自然，长视频也一样。播放按钮换成了速度表图标，不再和检查器的图标一样。' },
        { kind: 'fixed', text: '内置智能体（用你自己的 key）看了很多画面后，长对话也能继续：每次请求会省略较早的图片，服务嫌请求太大时会带更少的图自动重试。' },
      ],
      ja: [
        { kind: 'fixed', text: '再生速度を変えるとすぐに音が出て、どの速度でも声が自然に聞こえます。長い動画でも同じです。再生ボタンは速度計のアイコンになり、インスペクタのアイコンと区別できます。' },
        { kind: 'fixed', text: 'アプリ内蔵のエージェント（自分のキー）がたくさんのフレームを見ても、長い会話を続けられます。古い画像は各リクエストから省かれ、大きすぎると断られたリクエストは画像を減らして再試行します。' },
      ],
      ko: [
        { kind: 'fixed', text: '재생 속도를 바꾸면 바로 소리가 나고, 어떤 속도에서도 목소리가 자연스럽습니다. 긴 동영상도 마찬가지입니다. 재생 버튼은 속도계 아이콘이 되어 인스펙터 아이콘과 구별됩니다.' },
        { kind: 'fixed', text: '앱 자체 에이전트(내 키)가 많은 프레임을 봐도 긴 대화를 이어 갈 수 있습니다. 오래된 그림은 요청에서 빠지고, 너무 크다고 거절된 요청은 그림을 줄여 다시 시도합니다.' },
      ],
      es: [
        { kind: 'fixed', text: 'Una nueva velocidad de reproducción se oye en cuanto la eliges, y las voces suenan naturales a cualquier velocidad, también en vídeos largos. El botón de reproducción muestra un velocímetro y ya no se parece al del inspector.' },
        { kind: 'fixed', text: 'El agente propio de la app (tu propia clave) sigue una conversación larga aunque mire muchos fotogramas: las imágenes antiguas se omiten de cada solicitud, y una solicitud que el servicio rechaza por grande se reintenta con menos.' },
      ],
    },
  },
  {
    version: '0.2.3',
    date: '2026-10-20',
    notes: {
      en: [
        { kind: 'new', text: 'Skills: install OpenFilm’s from Discover, turn any skill on or off, and Try now starts a conversation with it. Choose a cover when you add your own.' },
        { kind: 'new', text: 'Keyboard shortcuts: use OpenFilm’s keys, Premiere Pro’s or Final Cut Pro’s, or record your own in Settings › Keyboard shortcuts.' },
        { kind: 'new', text: 'Page clips: make a layer’s words, picture or visibility a property and change it in the inspector; replace a picture right on it.' },
        { kind: 'improved', text: 'The viewer’s playback menu has loop, subtitles and speed from 0.25× to 2×, and sound keeps its pitch. Projects and tabs keep in step, and moving shows your folders as a tree.' },
        { kind: 'improved', text: 'Providers: four recommended first, the rest under More. Google transcribes speech for captions, and Microsoft Azure is set up service by service. Agents use your system’s proxy.' },
        { kind: 'fixed', text: 'On Windows, Codex from the Codex app starts, Install and Sign in open their window, and an editing-project export that can’t write to its drafts folder lands in your exports folder.' },
      ],
      'zh-CN': [
        { kind: 'new', text: 'Skill：在“发现”里安装 OpenFilm 的 skill，每个 skill 都能开关，“试一试”会用它开始一段对话。添加自己的 skill 时可以选封面。' },
        { kind: 'new', text: '快捷键：可以用 OpenFilm 的键位、Premiere Pro 或 Final Cut Pro 的键位，也可以在 设置 › 快捷键 里录自己的。' },
        { kind: 'new', text: '页面片段：把某一层的文字、图片或显示设为属性，在检查器里修改；图片可以直接在画面上替换。' },
        { kind: 'improved', text: '预览的播放菜单里有循环、字幕和 0.25× 到 2× 的速度，变速时声音保持原调。项目和标签页始终同步，移动时文件夹按层级显示。' },
        { kind: 'improved', text: '服务商：推荐的四家排在前面，其他的收在“更多”里。Google 可以转写语音做字幕，Microsoft Azure 按服务分别设置。智能体会使用系统代理。' },
        { kind: 'fixed', text: 'Windows 上：Codex 应用里的 Codex 能启动了，“安装”和“登录”会打开窗口，导出剪辑工程时草稿文件夹写不进去，草稿会放到导出文件夹。' },
      ],
      ja: [
        { kind: 'new', text: 'スキル：「見つける」から OpenFilm のスキルをインストールし、どのスキルもオン・オフでき、「試す」でそのスキルを使った会話を始められます。自分のスキルを追加するときはカバーを選べます。' },
        { kind: 'new', text: 'キーボードショートカット：OpenFilm、Premiere Pro、Final Cut Pro のキー配置から選ぶか、設定 › キーボードショートカットで自分のキーを登録できます。' },
        { kind: 'new', text: 'ページクリップ：レイヤーの文字、画像、表示をプロパティにしてインスペクタで変更できます。画像はその場で差し替えられます。' },
        { kind: 'improved', text: 'ビューアの再生メニューにループ、字幕、0.25×〜2× の速度があり、速度を変えても音の高さは変わりません。プロジェクトとタブは常に連動し、移動先のフォルダは階層で表示されます。' },
        { kind: 'improved', text: 'プロバイダ：おすすめの 4 社を先に、ほかは「その他」に。Google で音声を文字起こしして字幕にでき、Microsoft Azure はサービスごとに設定します。エージェントはシステムのプロキシを使います。' },
        { kind: 'fixed', text: 'Windows で、Codex アプリの Codex が起動し、「インストール」と「サインイン」がウィンドウを開き、編集プロジェクトの書き出しで下書きフォルダに書けないときは書き出しフォルダに保存されます。' },
      ],
      ko: [
        { kind: 'new', text: '스킬: 찾아보기에서 OpenFilm 스킬을 설치하고, 모든 스킬을 켜고 끌 수 있으며, 사용해 보기로 그 스킬과 대화를 시작합니다. 내 스킬을 추가할 때 표지를 고를 수 있습니다.' },
        { kind: 'new', text: '키보드 단축키: OpenFilm, Premiere Pro, Final Cut Pro의 키 배치 중에서 고르거나, 설정 › 키보드 단축키에서 직접 키를 지정할 수 있습니다.' },
        { kind: 'new', text: '페이지 클립: 레이어의 글자, 그림, 표시 여부를 속성으로 만들어 인스펙터에서 바꿀 수 있고, 그림은 화면에서 바로 교체할 수 있습니다.' },
        { kind: 'improved', text: '뷰어의 재생 메뉴에 반복, 자막, 0.25×~2× 속도가 있고, 속도를 바꿔도 음높이는 그대로입니다. 프로젝트와 탭이 항상 함께 맞춰지고, 옮길 때 폴더가 계층으로 보입니다.' },
        { kind: 'improved', text: '서비스 제공자: 추천 4곳을 먼저, 나머지는 더 보기에. Google로 음성을 받아써 자막을 만들고, Microsoft Azure는 서비스별로 설정합니다. 에이전트는 시스템 프록시를 사용합니다.' },
        { kind: 'fixed', text: 'Windows에서 Codex 앱의 Codex가 시작되고, 설치와 로그인이 창을 열며, 편집 프로젝트 내보내기에서 초안 폴더에 쓸 수 없으면 내보내기 폴더에 저장됩니다.' },
      ],
      es: [
        { kind: 'new', text: 'Skills: instala las de OpenFilm desde Descubrir, activa o desactiva cualquiera, y Probar empieza una conversación con ella. Elige una portada al añadir las tuyas.' },
        { kind: 'new', text: 'Atajos de teclado: usa las teclas de OpenFilm, de Premiere Pro o de Final Cut Pro, o graba las tuyas en Ajustes › Atajos de teclado.' },
        { kind: 'new', text: 'Clips de página: convierte el texto, la imagen o la visibilidad de una capa en una propiedad y cámbiala en el inspector; reemplaza una imagen directamente sobre ella.' },
        { kind: 'improved', text: 'El menú de reproducción del visor tiene bucle, subtítulos y velocidad de 0,25× a 2×, y el sonido mantiene su tono. Los proyectos y las pestañas van siempre a la par, y al mover ves tus carpetas como un árbol.' },
        { kind: 'improved', text: 'Proveedores: los cuatro recomendados primero y el resto en Más. Google transcribe la voz para subtítulos y Microsoft Azure se configura servicio por servicio. Los agentes usan el proxy del sistema.' },
        { kind: 'fixed', text: 'En Windows, Codex de la app de Codex arranca, Instalar e Iniciar sesión abren su ventana, y una exportación de proyecto de edición que no puede escribir en su carpeta de borradores queda en tu carpeta de exportaciones.' },
      ],
    },
  },
  {
    version: '0.2.2',
    date: '2026-10-19',
    notes: {
      en: [
        { kind: 'new', text: 'An export can be named where you choose its folder.' },
        { kind: 'new', text: 'Agents work when you installed only the maker’s app: Claude Code and OpenCode are found inside their apps, and Settings › Agents installs the others with their official installer.' },
        { kind: 'improved', text: 'When the app’s own agent tries its model service again, the chat says so. Final Cut Pro subtitles keep their look and size.' },
        { kind: 'fixed', text: 'On Windows, agents start again: 0.2.1 handed them the path of cmd.exe unexpanded. Connecting Cursor no longer opens the Cursor editor.' },
        { kind: 'fixed', text: 'On a Mac, an update installs when you quit, even if you open OpenFilm again right away.' },
        { kind: 'fixed', text: 'openfilm render takes frame rates like 29.97; 4K and transparent WebM footage get their contact sheets; a render that fails on Windows says why.' },
      ],
      'zh-CN': [
        { kind: 'new', text: '导出时可以在选文件夹的地方给文件起名。' },
        { kind: 'new', text: '只装了官方应用也能用智能体：Claude Code 和 OpenCode 能在它们的应用里找到，其他的在 设置 › 智能体 里用官方安装程序一键安装。' },
        { kind: 'improved', text: '内置智能体重新请求模型服务时，对话里会提示。Final Cut Pro 字幕保持原来的样式和大小。' },
        { kind: 'fixed', text: 'Windows 上智能体又能启动了：0.2.1 交给它们的 cmd.exe 路径没有展开。连接 Cursor 不会再打开 Cursor 编辑器。' },
        { kind: 'fixed', text: 'Mac 上退出时会安装更新，即使你马上又打开 OpenFilm。' },
        { kind: 'fixed', text: 'openfilm render 支持 29.97 这样的帧率；4K 和透明 WebM 视频也能生成缩略图；Windows 上渲染失败会说明原因。' },
      ],
      ja: [
        { kind: 'new', text: '書き出しのファイル名を、フォルダを選ぶ場所で付けられます。' },
        { kind: 'new', text: '公式アプリだけを入れていてもエージェントが使えます。Claude Code と OpenCode はそれぞれのアプリの中から見つけ、ほかは設定 › エージェントから公式インストーラーで入れられます。' },
        { kind: 'improved', text: 'アプリ内蔵のエージェントがモデルサービスに再試行するとき、チャットに表示します。Final Cut Pro の字幕は見た目とサイズを保ちます。' },
        { kind: 'fixed', text: 'Windows でエージェントが再び起動します。0.2.1 では cmd.exe のパスを展開せずに渡していました。Cursor に接続しても Cursor エディタは開きません。' },
        { kind: 'fixed', text: 'Mac では終了時にアップデートがインストールされます。すぐに OpenFilm を開き直しても同じです。' },
        { kind: 'fixed', text: 'openfilm render が 29.97 のようなフレームレートに対応。4K や透過 WebM の映像もコンタクトシートを作れます。Windows で失敗した書き出しは理由を表示します。' },
      ],
      ko: [
        { kind: 'new', text: '내보낼 때 폴더를 고르는 곳에서 파일 이름을 정할 수 있습니다.' },
        { kind: 'new', text: '공식 앱만 설치해도 에이전트를 쓸 수 있습니다. Claude Code와 OpenCode는 각 앱 안에서 찾고, 나머지는 설정 › 에이전트에서 공식 설치 프로그램으로 설치합니다.' },
        { kind: 'improved', text: '앱 자체 에이전트가 모델 서비스를 다시 시도하면 채팅에 알려 줍니다. Final Cut Pro 자막은 모양과 크기를 유지합니다.' },
        { kind: 'fixed', text: 'Windows에서 에이전트가 다시 시작됩니다. 0.2.1은 cmd.exe 경로를 펼치지 않고 넘겼습니다. Cursor를 연결해도 Cursor 편집기가 열리지 않습니다.' },
        { kind: 'fixed', text: 'Mac에서는 종료할 때 업데이트가 설치됩니다. 바로 OpenFilm을 다시 열어도 마찬가지입니다.' },
        { kind: 'fixed', text: 'openfilm render가 29.97 같은 프레임 레이트를 받습니다. 4K와 투명 WebM 영상도 콘택트 시트가 만들어지고, Windows에서 실패한 렌더는 이유를 알려 줍니다.' },
      ],
      es: [
        { kind: 'new', text: 'Una exportación se puede nombrar donde eliges su carpeta.' },
        { kind: 'new', text: 'Los agentes funcionan aunque solo tengas la app de su fabricante: Claude Code y OpenCode se encuentran dentro de sus apps, y Ajustes › Agentes instala los demás con su instalador oficial.' },
        { kind: 'improved', text: 'Cuando el agente propio de la app reintenta su servicio de modelos, el chat lo dice. Los subtítulos de Final Cut Pro mantienen su aspecto y tamaño.' },
        { kind: 'fixed', text: 'En Windows los agentes vuelven a arrancar: 0.2.1 les daba la ruta de cmd.exe sin expandir. Conectar Cursor ya no abre el editor Cursor.' },
        { kind: 'fixed', text: 'En un Mac, una actualización se instala al salir, aunque vuelvas a abrir OpenFilm enseguida.' },
        { kind: 'fixed', text: 'openfilm render acepta frecuencias como 29.97; el material 4K y los WebM transparentes tienen su hoja de contactos; un render que falla en Windows dice por qué.' },
      ],
    },
  },
  {
    version: '0.2.1',
    date: '2026-10-19',
    notes: {
      en: [
        { kind: 'new', text: 'The timeline has a main track with its magnet and linkage, and a preview axis. Moving, pasting or dropping a clip never cuts another one.' },
        { kind: 'new', text: 'Projects lists every project in your projects folder, and a project can have its own cover. Export › Editing project adds Final Cut Pro.' },
        { kind: 'improved', text: 'Preview, scrubbing and the timeline stay smooth even in big films, and exports leave the computer usable.' },
        { kind: 'improved', text: 'The chat takes any number of files and folders, where they are. Settings › Developer has Diagnostics, and each of your own models takes its context length.' },
        { kind: 'improved', text: 'The app’s own agent waits up to 15 minutes for a model that thinks before it answers, and a failed turn says why.' },
        { kind: 'fixed', text: 'Footage the browser can’t decode plays everywhere; file names with #, ? and % work; Gemini CLI, which Google no longer serves, leaves the agents.' },
      ],
      'zh-CN': [
        { kind: 'new', text: '时间线新增主轨，带主轨磁吸和联动，还有预览轴。移动、粘贴或拖入片段，都不会把别的片段切开。' },
        { kind: 'new', text: '项目页会列出项目文件夹里的所有项目，每个项目也可以设置自己的封面。导出 › 剪辑工程 新增 Final Cut Pro。' },
        { kind: 'improved', text: '预览、拖动播放头和时间线在大项目里也很流畅；导出时电脑仍然好用。' },
        { kind: 'improved', text: '对话可以添加任意多个文件和文件夹，不会复制，原样引用。设置 › 开发者 新增「诊断」；自有密钥的每个模型可以填自己的上下文长度。' },
        { kind: 'improved', text: '内置智能体等模型思考的时间延长到 15 分钟；一轮失败时会说明原因。' },
        { kind: 'fixed', text: '浏览器无法解码的视频也能在各处播放；文件名里有 #、? 和 % 也没问题；Google 已停止服务的 Gemini CLI 不再出现在智能体里。' },
      ],
      ja: [
        { kind: 'new', text: 'タイムラインにメイントラックが加わり、メイントラックのマグネットと連動、プレビュー軸も使えます。クリップを移動・貼り付け・ドロップしても、ほかのクリップが切られることはありません。' },
        { kind: 'new', text: 'プロジェクト画面にプロジェクトフォルダ内のすべてのプロジェクトが並び、プロジェクトごとにカバーを設定できます。書き出し › 編集プロジェクトに Final Cut Pro が加わりました。' },
        { kind: 'improved', text: '大きな映像でもプレビュー、スクラブ、タイムラインが滑らかで、書き出し中もパソコンを普通に使えます。' },
        { kind: 'improved', text: 'チャットにファイルやフォルダをいくつでも、コピーせずにそのまま添付できます。設定 › 開発者に「診断」が加わり、自分のキーの各モデルにコンテキスト長を設定できます。' },
        { kind: 'improved', text: 'アプリ内蔵のエージェントは、考えてから答えるモデルを最大 15 分待ちます。失敗したターンは理由を表示します。' },
        { kind: 'fixed', text: 'ブラウザで再生できない動画もどこでも再生できます。#、?、% を含むファイル名も使えます。Google が提供を終えた Gemini CLI はエージェントから外れました。' },
      ],
      ko: [
        { kind: 'new', text: '타임라인에 메인 트랙이 생기고 메인 트랙 자석과 연동, 미리보기 축을 쓸 수 있습니다. 클립을 옮기거나 붙여 넣거나 끌어 놓아도 다른 클립이 잘리지 않습니다.' },
        { kind: 'new', text: '프로젝트 화면에 프로젝트 폴더의 모든 프로젝트가 보이고, 프로젝트마다 표지를 정할 수 있습니다. 내보내기 › 편집 프로젝트에 Final Cut Pro가 추가되었습니다.' },
        { kind: 'improved', text: '큰 영상에서도 미리보기, 스크러빙, 타임라인이 부드럽고, 내보내는 동안에도 컴퓨터를 편하게 쓸 수 있습니다.' },
        { kind: 'improved', text: '채팅에 파일과 폴더를 개수 제한 없이, 복사하지 않고 그대로 첨부할 수 있습니다. 설정 › 개발자에 "진단"이 생겼고, 내 키의 모델마다 컨텍스트 길이를 정할 수 있습니다.' },
        { kind: 'improved', text: '앱 자체 에이전트는 생각한 뒤 답하는 모델을 최대 15분 기다리고, 실패한 턴은 이유를 알려 줍니다.' },
        { kind: 'fixed', text: '브라우저가 디코딩하지 못하는 영상도 어디서나 재생됩니다. #, ?, %가 들어간 파일 이름도 됩니다. Google이 서비스를 끝낸 Gemini CLI는 에이전트에서 빠졌습니다.' },
      ],
      es: [
        { kind: 'new', text: 'La línea de tiempo tiene una pista principal con su imán y la vinculación, y un eje de vista previa. Mover, pegar o soltar un clip nunca corta otro.' },
        { kind: 'new', text: 'Proyectos muestra todos los proyectos de tu carpeta de proyectos, y cada proyecto puede tener su propia portada. Exportar › Proyecto de edición añade Final Cut Pro.' },
        { kind: 'improved', text: 'La vista previa, el desplazamiento y la línea de tiempo van fluidos incluso en películas grandes, y exportar deja el equipo usable.' },
        { kind: 'improved', text: 'El chat admite cualquier número de archivos y carpetas, donde están, sin copiarlos. Ajustes › Desarrollador tiene Diagnóstico, y cada modelo de tu propia clave admite su longitud de contexto.' },
        { kind: 'improved', text: 'El agente propio de la app espera hasta 15 minutos a un modelo que piensa antes de responder, y un turno fallido dice por qué.' },
        { kind: 'fixed', text: 'El vídeo que el navegador no puede decodificar se reproduce en todas partes; los nombres de archivo con #, ? y % funcionan; Gemini CLI, que Google ya no ofrece, deja los agentes.' },
      ],
    },
  },
  {
    version: '0.2.0',
    date: '2026-10-17',
    notes: {
      en: [
        { kind: 'new', text: 'Tabs: each open project in a tab of its own. The projects window has Examples to start a new film from.' },
        { kind: 'new', text: 'Skills: type / in the chat to make a film with one, or open Community for the official skills and the examples. Ten official skills, including replicate: give it a video and it makes yours like it.' },
        { kind: 'new', text: 'Saved: your own library of files and clips, the same in every project. Right-click a clip and choose Add to Saved.' },
        { kind: 'new', text: 'Your own key takes several models, each with its own service and key. Settings › Services sets who makes each kind of media, and Settings › General › Storage where new projects go.' },
        { kind: 'improved', text: 'The examples and skills show at once, even on a slow connection, and a project with thousands of files plays smoothly as soon as it opens.' },
        { kind: 'fixed', text: 'Your own key works again; a film with hundreds of sounds exports on Windows; when Codex can’t start, the chat says why.' },
      ],
      'zh-CN': [
        { kind: 'new', text: '标签页：每个打开的项目一个标签页。项目窗口新增「示例」，可以从示例开始做新片。' },
        { kind: 'new', text: 'Skill：在对话里输入 / 选一个 Skill 来做片，或打开「社区」查看官方 Skill 和示例。新增十个官方 Skill，包括 replicate：给它一个视频，按它的样子做你的片。' },
        { kind: 'new', text: '收藏：你自己的素材库，每个项目里都一样。在片段上右键选择「收藏」。' },
        { kind: 'new', text: '自有密钥可以添加多个模型，每个用自己的服务和密钥。设置 › 服务 选择每类媒体由谁生成，设置 › 通用 › 存储位置 选择新项目放在哪里。' },
        { kind: 'improved', text: '示例和 Skill 打开即显示，网络慢也不用等；文件上千的项目一打开就能流畅播放。' },
        { kind: 'fixed', text: '自有密钥恢复可用；Windows 上声音很多的影片可以正常导出；Codex 无法启动时，对话里会说明原因。' },
      ],
      ja: [
        { kind: 'new', text: 'タブ：開いているプロジェクトはそれぞれ専用のタブに。プロジェクトウィンドウに「サンプル」が加わり、そこから新しい映像を始められます。' },
        { kind: 'new', text: 'スキル：チャットで / を入力してスキルで映像を作るか、「コミュニティ」で公式スキルとサンプルを見られます。公式スキルは 10 種類、replicate もあります：動画を渡すと、それに似せてあなたの映像を作ります。' },
        { kind: 'new', text: 'コレクション：どのプロジェクトでも同じ、自分専用のファイルとクリップの置き場所。クリップを右クリックして「コレクションに追加」を選びます。' },
        { kind: 'new', text: '自分のキーで複数のモデルを、それぞれ専用のサービスとキーで使えます。設定 › サービスで各メディアの生成先を、設定 › 一般 › 保存場所で新しいプロジェクトの場所を選べます。' },
        { kind: 'improved', text: 'サンプルとスキルは回線が遅くてもすぐに表示され、ファイルが数千あるプロジェクトも開いてすぐ滑らかに再生できます。' },
        { kind: 'fixed', text: '自分のキーが再び使えるようになりました。Windows で音の多い映像を書き出せます。Codex が起動できないとき、チャットに理由が表示されます。' },
      ],
      ko: [
        { kind: 'new', text: '탭: 열린 프로젝트마다 탭 하나. 프로젝트 창에 "예시"가 생겨 예시에서 새 영상을 시작할 수 있습니다.' },
        { kind: 'new', text: '스킬: 채팅에서 /를 입력해 스킬로 영상을 만들거나, "커뮤니티"에서 공식 스킬과 예시를 볼 수 있습니다. 공식 스킬 10개, replicate 포함: 영상을 주면 그와 닮은 내 영상을 만듭니다.' },
        { kind: 'new', text: '보관함: 모든 프로젝트에서 같은 나만의 파일과 클립 보관 장소. 클립을 마우스 오른쪽 버튼으로 클릭하고 "보관함에 추가"를 고르세요.' },
        { kind: 'new', text: '내 키로 여러 모델을 각자의 서비스와 키로 쓸 수 있습니다. 설정 › 서비스에서 미디어별 생성 서비스를, 설정 › 일반 › 저장 위치에서 새 프로젝트 위치를 고릅니다.' },
        { kind: 'improved', text: '예시와 스킬은 연결이 느려도 바로 보이고, 파일이 수천 개인 프로젝트도 열자마자 부드럽게 재생됩니다.' },
        { kind: 'fixed', text: '내 키가 다시 작동합니다. Windows에서 소리가 많은 영상도 내보낼 수 있습니다. Codex가 시작되지 않으면 채팅에서 이유를 알려 줍니다.' },
      ],
      es: [
        { kind: 'new', text: 'Pestañas: cada proyecto abierto en su propia pestaña. La ventana de proyectos tiene Ejemplos para empezar una película nueva desde uno.' },
        { kind: 'new', text: 'Skills: escribe / en el chat para hacer una película con una, o abre Comunidad para ver las skills oficiales y los ejemplos. Diez skills oficiales, entre ellas replicate: dale un video y hace la tuya como él.' },
        { kind: 'new', text: 'Guardados: tu propia biblioteca de archivos y clips, la misma en todos los proyectos. Haz clic derecho en un clip y elige Añadir a Guardados.' },
        { kind: 'new', text: 'Tu propia clave admite varios modelos, cada uno con su servicio y su clave. Ajustes › Servicios elige quién hace cada tipo de medio, y Ajustes › General › Almacenamiento dónde van los proyectos nuevos.' },
        { kind: 'improved', text: 'Los ejemplos y las skills aparecen al instante, incluso con una conexión lenta, y un proyecto con miles de archivos se reproduce con fluidez nada más abrirlo.' },
        { kind: 'fixed', text: 'Tu propia clave vuelve a funcionar; una película con cientos de sonidos se exporta en Windows; cuando Codex no puede iniciarse, el chat dice por qué.' },
      ],
    },
  },
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
