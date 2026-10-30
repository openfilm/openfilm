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
  version: '0.2.7',
  date: '2026-10-30',
  notes: {
    en: [
      { kind: 'new', text: 'Zoom into the picture: pinch, or hold ⌘ (Ctrl on Windows) and scroll, to zoom about the pointer; scroll to pan. The film is drawn sharp again at any zoom.' },
      { kind: 'new', text: 'Copy and paste layers inside a page with ⌘C and ⌘V. Each copy is a new, independent element that looks exactly like its original, and all the copies of a paste are selected together.' },
      { kind: 'new', text: 'A clip\'s speed goes from 0.1× to 100×, on a slider that shows the new length as you drag. Speed in a clip\'s right-click menu lets you change it by dragging the clip\'s edge.' },
      { kind: 'new', text: 'Volume on the timeline: hover a clip and drag the thin line across its sound. The waveform grows and shrinks with it, and peaks that would distort turn orange.' },
      { kind: 'new', text: 'Keenable for web search and reading pages, under More in Settings › Providers. It works without a key.' },
      { kind: 'improved', text: 'An agent\'s write no longer undoes what you change while it works: your moves, edits and pasted layers stay, and the agent is told on its next step.' },
      { kind: 'improved', text: 'Chat: @ is the one menu, with moments, files and every skill. References sit in your words and can be dragged anywhere in the text, and files you drop, paste or attach go in at the cursor.' },
      { kind: 'improved', text: 'A click only selects. A right-click gives the full menu, the same in the picture and in Layers, with Reference in chat first.' },
      { kind: 'improved', text: 'Layers: ⌘-click adds or removes a row, Shift-click selects a range, and selected rows read as one block. In the picture, Shift-click adds or removes.' },
      { kind: 'improved', text: '⌘V pastes clips onto the track under the mouse, at the playhead.' },
      { kind: 'improved', text: 'Fade handles show on the clip under the mouse, inside its ends; drag one inward to fade.' },
      { kind: 'improved', text: 'Footage this computer can\'t decode, such as some HEVC, shows "Preparing this clip to play" with its progress instead of black, and plays as soon as its copy is ready.' },
      { kind: 'improved', text: 'Agents put a new clip on a track with room for it, instead of adding a track each time.' },
      { kind: 'improved', text: 'The viewer plays at 3× and 4× too, the sound\'s pitch kept, and J/K/L\'s 4× plays with sound. The Playback menu is laid out anew: Loop, and the speeds from 0.25× to 4× in two rows.' },
      { kind: 'improved', text: 'A picture in the chat opens in a light viewer: Esc, a click beside it or × closes it, and Download is in its right-click menu.' },
      { kind: 'improved', text: 'Settings › Agents says when Claude Code is older than the one OpenFilm was tested with, and gives the command that updates it.' },
      { kind: 'improved', text: 'Windows: looking at the agents no longer holds the windows; the installed apps are read in the background.' },
      { kind: 'improved', text: 'DeepSeek Harness: signed in only to your account, a model that needs an API key says so, and switches to the account\'s model in one click.' },
      { kind: 'fixed', text: 'If an agent\'s rewrite leaves film.html missing for a moment, the project stays open and the agent keeps working. Version history can still restore it, and the chat offers to restore it as it was before the turn.' },
      { kind: 'fixed', text: 'Editing in the picture is steadier: a copied text layer keeps its line breaks, a page\'s clip no longer flashes blank on the timeline, and clicking around the picture no longer tints it blue.' },
      { kind: 'fixed', text: 'No outline is left behind after a drag or an undo, and the Layers menu closes when you click elsewhere.' },
      { kind: 'fixed', text: 'Windows: a skill of your own or of a project is no longer emptied when OpenFilm tidies an agent\'s old session.' },
      { kind: 'fixed', text: 'Exports: ProRes footage with sound no longer comes out black, and videos with transparency (WebM, Apple HEVC) stay transparent instead of showing a solid color.' },
      { kind: 'fixed', text: 'A new project starts in the subtitle look you used last, and its burned-in subtitles match what Studio shows.' },
    ],
    'zh-CN': [
      { kind: 'new', text: '画面可以缩放：双指捏合，或按住 ⌘（Windows 上为 Ctrl）滚动滚轮，以指针为中心缩放；滚动即可平移。任意缩放下画面都会重新清晰绘制。' },
      { kind: 'new', text: '页面里的图层可以用 ⌘C、⌘V 复制粘贴。每个副本都是独立的新元素，和原来一模一样；一次粘贴出来的副本会一起选中。' },
      { kind: 'new', text: '片段速度支持 0.1× 到 100×，用滑杆调整，拖动时显示新的时长。在片段的右键菜单里打开“速度”，就能拖片段边缘改速度。' },
      { kind: 'new', text: '时间线上直接调音量：鼠标放到片段上，拖动声音上那条细线。波形会跟着变大变小，会失真的峰值显示为橙色。' },
      { kind: 'new', text: '新增 Keenable，用于网页搜索和读取网页，在 设置 › 服务商 › 更多 里，不需要密钥也能用。' },
      { kind: 'improved', text: 'Agent 写入时不再撤销你在它工作期间的改动：你的移动、编辑和粘贴的图层都会保留，并在它下一步时告诉它。' },
      { kind: 'improved', text: '对话：只保留 @ 一个菜单，里面有时间点、文件和全部 skill。引用嵌在文字里，可以拖到任意位置；拖入、粘贴或添加的文件插在光标处。' },
      { kind: 'improved', text: '左键只选中，右键出完整菜单；画面和图层面板里的菜单一样，“引用到对话”排在第一个。' },
      { kind: 'improved', text: '图层面板：⌘ 点击加选或取消，Shift 点击选中一段范围，选中的行连成一整块。画面里 Shift 点击加选或取消。' },
      { kind: 'improved', text: '⌘V 会把片段粘贴到鼠标所在的轨道，位置在播放头。' },
      { kind: 'improved', text: '淡入淡出的小圆点只在鼠标所在的片段上显示，位于片段两端内侧；往里拖即可淡入淡出。' },
      { kind: 'improved', text: '这台电脑解不了的素材（比如部分 HEVC）不再黑屏，而是显示“正在准备这段素材”和进度，副本一好就能播放。' },
      { kind: 'improved', text: 'Agent 会把新片段放进有空位的轨道，不再每次新建一条轨道。' },
      { kind: 'improved', text: '预览可以 3× 和 4× 播放，声音音调不变，J/K/L 快进到 4× 时也带声音。播放设置菜单重新设计：循环播放，以及 0.25× 到 4× 的速度，分两行排列。' },
      { kind: 'improved', text: '对话里的图片改用轻量预览：按 Esc、点旁边或 × 关闭，右键菜单里可以下载。' },
      { kind: 'improved', text: '设置 › 智能体：Claude Code 比 OpenFilm 测试过的版本旧时会提示，并给出更新命令。' },
      { kind: 'improved', text: 'Windows：查看智能体时窗口不再卡住，已安装的应用改在后台读取。' },
      { kind: 'improved', text: 'DeepSeek Harness：只登录了账号时，选到需要 API key 的模型会说明原因，并可一键换成账号能用的模型。' },
      { kind: 'fixed', text: 'Agent 重写时 film.html 暂时不见，项目也不会关闭，Agent 会继续工作；版本历史照样能恢复，对话里也会提供恢复成这一轮开始前的样子。' },
      { kind: 'fixed', text: '画面编辑更稳定：复制的文字图层换行和原来一致，编辑页面时时间线上的片段不再闪成空白，在画面外点击也不再蒙上一层蓝色。' },
      { kind: 'fixed', text: '拖动或撤销后不会留下选中框，图层右键菜单点击别处就会关闭。' },
      { kind: 'fixed', text: 'Windows：OpenFilm 清理 Agent 的旧会话时，不会再清空你自己或项目里的 skill。' },
      { kind: 'fixed', text: '导出：带声音的 ProRes 素材不再导出成黑屏，带透明通道的视频（WebM、Apple HEVC）保持透明，不再显示纯色背景。' },
      { kind: 'fixed', text: '新项目沿用你上次用的字幕样式，烧录的字幕和 Studio 里看到的一致。' },
    ],
    ja: [
      { kind: 'new', text: '画面を拡大できます。ピンチするか、⌘（Windows では Ctrl）を押しながらスクロールすると、ポインタを中心に拡大し、スクロールで移動します。どの倍率でも鮮明に描き直されます。' },
      { kind: 'new', text: 'ページ内のレイヤーを ⌘C・⌘V でコピー＆ペーストできます。各コピーは元とまったく同じ見た目の独立した新しい要素で、一度に貼り付けたコピーはまとめて選択されます。' },
      { kind: 'new', text: 'クリップの速度は 0.1× から 100× まで。スライダーでドラッグ中に新しい長さが表示されます。クリップの右クリックメニューで「速度」をオンにすると、端をドラッグして速度を変えられます。' },
      { kind: 'new', text: 'タイムラインで音量を調整：クリップにポインタを合わせ、音声部分の細い線をドラッグします。波形も一緒に大きく・小さくなり、歪むピークはオレンジで示されます。' },
      { kind: 'new', text: 'Web 検索とページの読み取りに Keenable を追加しました。設定 › プロバイダ › その他 にあり、キーなしで使えます。' },
      { kind: 'improved', text: 'エージェントの書き込みが、作業中にあなたが加えた変更を取り消さなくなりました。移動・編集・貼り付けたレイヤーは残り、エージェントには次のステップで伝えられます。' },
      { kind: 'improved', text: 'チャット：メニューは @ ひとつになり、場面・ファイル・すべてのスキルが並びます。参照は文中に入り、好きな位置へドラッグできます。ドロップ・貼り付け・添付したファイルはカーソル位置に入ります。' },
      { kind: 'improved', text: 'クリックは選択だけ。右クリックで完全なメニューが開き、画面でもレイヤーでも同じで、「チャットで参照」が先頭です。' },
      { kind: 'improved', text: 'レイヤー：⌘ クリックで行を追加・解除、Shift クリックで範囲を選択し、選択した行はひとつのまとまりで表示されます。画面では Shift クリックで追加・解除します。' },
      { kind: 'improved', text: '⌘V はクリップをポインタの下のトラックの、再生ヘッドの位置に貼り付けます。' },
      { kind: 'improved', text: 'フェードのハンドルはポインタを合わせたクリップの両端の内側に表示され、内側へドラッグするとフェードします。' },
      { kind: 'improved', text: 'このコンピュータで再生できない素材（一部の HEVC など）は黒画面ではなく「このクリップを再生の準備中」と進み具合を表示し、コピーができしだい再生されます。' },
      { kind: 'improved', text: 'エージェントは新しいクリップを空きのあるトラックに置き、毎回トラックを増やさなくなりました。' },
      { kind: 'improved', text: 'ビューアは 3× と 4× でも音程を保って再生でき、J/K/L の 4× も音声付きです。再生メニューを作り直しました：ループと、0.25× から 4× までの速度を 2 行で。' },
      { kind: 'improved', text: 'チャットの画像は軽いビューアで開きます。Esc、外側のクリック、× で閉じ、右クリックメニューからダウンロードできます。' },
      { kind: 'improved', text: '設定 › エージェント：Claude Code が OpenFilm で検証した版より古いとお知らせし、更新コマンドを表示します。' },
      { kind: 'improved', text: 'Windows：エージェントを表示してもウィンドウが固まらなくなりました。インストール済みアプリはバックグラウンドで読み込みます。' },
      { kind: 'improved', text: 'DeepSeek Harness：アカウントだけでサインインしているとき、API キーが必要なモデルはその旨を伝え、アカウントで使えるモデルにワンクリックで切り替えられます。' },
      { kind: 'fixed', text: 'エージェントの書き直しで film.html が一時的になくなっても、プロジェクトは開いたままでエージェントは作業を続けます。バージョン履歴から復元でき、チャットではこのターン前の状態への復元を提案します。' },
      { kind: 'fixed', text: '画面での編集が安定しました。コピーした文字レイヤーの改行は元のまま、ページを編集してもタイムラインのクリップが空白に点滅せず、画面の外側をクリックしても青くなりません。' },
      { kind: 'fixed', text: 'ドラッグや取り消しの後に枠が残らなくなり、レイヤーのメニューはほかの場所をクリックすると閉じます。' },
      { kind: 'fixed', text: 'Windows：OpenFilm がエージェントの古いセッションを片付けるとき、あなたやプロジェクトの skill が空になることはなくなりました。' },
      { kind: 'fixed', text: '書き出し：音声付きの ProRes が黒くならず、透明部分のある動画（WebM、Apple HEVC）は単色の背景にならず透明のままです。' },
      { kind: 'fixed', text: '新しいプロジェクトは前回使った字幕スタイルで始まり、焼き込み字幕は Studio の表示と一致します。' },
    ],
    ko: [
      { kind: 'new', text: '화면 확대: 핀치하거나 ⌘(Windows는 Ctrl)를 누른 채 스크롤하면 포인터를 중심으로 확대하고, 스크롤로 이동합니다. 어떤 배율에서도 선명하게 다시 그려집니다.' },
      { kind: 'new', text: '페이지 안의 레이어를 ⌘C, ⌘V로 복사해 붙여 넣을 수 있습니다. 각 사본은 원본과 똑같이 보이는 독립된 새 요소이고, 한 번에 붙여 넣은 사본은 함께 선택됩니다.' },
      { kind: 'new', text: '클립 속도는 0.1×부터 100×까지이며, 슬라이더를 끄는 동안 새 길이를 보여 줍니다. 클립 오른쪽 클릭 메뉴에서 속도를 켜면 클립 가장자리를 끌어 속도를 바꿀 수 있습니다.' },
      { kind: 'new', text: '타임라인에서 볼륨 조절: 클립에 포인터를 올리고 소리 위의 가는 선을 끄세요. 파형이 함께 커지고 작아지며, 찌그러질 피크는 주황색으로 표시됩니다.' },
      { kind: 'new', text: '웹 검색과 페이지 읽기에 Keenable을 추가했습니다. 설정 › 제공자 › 더 보기에 있으며 키 없이도 쓸 수 있습니다.' },
      { kind: 'improved', text: '에이전트가 쓰는 내용이 그 사이에 당신이 바꾼 것을 되돌리지 않습니다. 이동, 편집, 붙여 넣은 레이어는 그대로 남고, 에이전트는 다음 단계에서 이를 알게 됩니다.' },
      { kind: 'improved', text: '채팅: 메뉴는 @ 하나로, 장면, 파일, 모든 skill이 있습니다. 참조는 문장 안에 들어가 원하는 곳으로 끌 수 있고, 끌어 놓거나 붙여 넣거나 첨부한 파일은 커서 위치에 들어갑니다.' },
      { kind: 'improved', text: '클릭은 선택만 합니다. 오른쪽 클릭은 전체 메뉴를 열며, 화면과 레이어에서 같고 \'채팅에서 참조\'가 맨 위에 있습니다.' },
      { kind: 'improved', text: '레이어: ⌘ 클릭으로 행을 추가하거나 빼고, Shift 클릭으로 범위를 선택하며, 선택한 행은 한 덩어리로 보입니다. 화면에서는 Shift 클릭으로 추가하거나 뺍니다.' },
      { kind: 'improved', text: '⌘V는 클립을 포인터 아래 트랙의 재생 헤드 위치에 붙여 넣습니다.' },
      { kind: 'improved', text: '페이드 핸들은 포인터를 올린 클립의 양 끝 안쪽에 나타나며, 안쪽으로 끌면 페이드됩니다.' },
      { kind: 'improved', text: '이 컴퓨터가 디코딩하지 못하는 영상(일부 HEVC 등)은 검은 화면 대신 \'이 클립을 재생할 준비 중\'과 진행률을 보여 주고, 사본이 준비되는 대로 재생됩니다.' },
      { kind: 'improved', text: '에이전트는 새 클립을 빈 자리가 있는 트랙에 두고, 매번 트랙을 늘리지 않습니다.' },
      { kind: 'improved', text: '뷰어가 3×와 4×로도 음높이를 유지한 채 재생하고, J/K/L의 4×도 소리와 함께 재생됩니다. 재생 메뉴를 새로 배치했습니다: 반복, 그리고 0.25×부터 4×까지의 속도를 두 줄로.' },
      { kind: 'improved', text: '채팅의 이미지는 가벼운 뷰어로 열립니다. Esc, 바깥 클릭, ×로 닫고, 오른쪽 클릭 메뉴에서 다운로드할 수 있습니다.' },
      { kind: 'improved', text: '설정 › 에이전트: Claude Code가 OpenFilm에서 검증한 버전보다 오래되면 알려 주고, 업데이트 명령을 보여 줍니다.' },
      { kind: 'improved', text: 'Windows: 에이전트를 볼 때 창이 멈추지 않습니다. 설치된 앱은 백그라운드에서 읽습니다.' },
      { kind: 'improved', text: 'DeepSeek Harness: 계정으로만 로그인했을 때 API 키가 필요한 모델은 그 이유를 알려 주고, 계정에서 쓸 수 있는 모델로 한 번에 바꿀 수 있습니다.' },
      { kind: 'fixed', text: '에이전트가 다시 쓰는 동안 film.html이 잠시 없어져도 프로젝트는 열린 채로 에이전트가 계속 작업합니다. 버전 기록에서 복원할 수 있고, 채팅은 이번 차례 전 상태로 복원하기를 제안합니다.' },
      { kind: 'fixed', text: '화면 편집이 안정적입니다. 복사한 텍스트 레이어의 줄바꿈이 원본과 같고, 페이지를 편집해도 타임라인 클립이 빈 화면으로 깜박이지 않으며, 화면 바깥을 클릭해도 파랗게 덮이지 않습니다.' },
      { kind: 'fixed', text: '끌기나 실행 취소 뒤에 테두리가 남지 않고, 레이어 메뉴는 다른 곳을 클릭하면 닫힙니다.' },
      { kind: 'fixed', text: 'Windows: OpenFilm이 에이전트의 오래된 세션을 정리할 때 내 skill이나 프로젝트의 skill이 더 이상 비워지지 않습니다.' },
      { kind: 'fixed', text: '내보내기: 소리가 있는 ProRes가 검게 나오지 않고, 투명도가 있는 영상(WebM, Apple HEVC)은 단색 배경 없이 투명하게 유지됩니다.' },
      { kind: 'fixed', text: '새 프로젝트는 마지막으로 쓴 자막 스타일로 시작하며, 입힌 자막이 Studio에서 보이는 것과 같습니다.' },
    ],
    es: [
      { kind: 'new', text: 'Haz zoom en la imagen: pellizca, o mantén ⌘ (Ctrl en Windows) y desplaza, para ampliar alrededor del puntero; desplaza para moverte. La película se vuelve a dibujar nítida a cualquier zoom.' },
      { kind: 'new', text: 'Copia y pega capas dentro de una página con ⌘C y ⌘V. Cada copia es un elemento nuevo e independiente, idéntico al original, y todas las copias de un pegado quedan seleccionadas juntas.' },
      { kind: 'new', text: 'La velocidad de un clip va de 0,1× a 100×, con un control deslizante que muestra la nueva duración mientras arrastras. Velocidad, en el menú contextual del clip, permite cambiarla arrastrando su borde.' },
      { kind: 'new', text: 'Volumen en la línea de tiempo: pasa el puntero sobre un clip y arrastra la línea fina sobre su sonido. La onda crece y se encoge con ella, y los picos que distorsionarían se ven en naranja.' },
      { kind: 'new', text: 'Keenable para buscar en la web y leer páginas, en Más, dentro de Ajustes › Proveedores. Funciona sin clave.' },
      { kind: 'improved', text: 'Lo que escribe un agente ya no deshace lo que cambias mientras trabaja: tus movimientos, ediciones y capas pegadas se quedan, y el agente lo sabe en su siguiente paso.' },
      { kind: 'improved', text: 'Chat: @ es el único menú, con momentos, archivos y todas las skills. Las referencias van dentro de tu texto y se pueden arrastrar a cualquier sitio, y los archivos que sueltas, pegas o adjuntas entran en el cursor.' },
      { kind: 'improved', text: 'Un clic solo selecciona. El clic derecho abre el menú completo, igual en la imagen y en Capas, con Referenciar en el chat primero.' },
      { kind: 'improved', text: 'Capas: ⌘-clic añade o quita una fila, Mayús-clic selecciona un rango, y las filas seleccionadas se ven como un solo bloque. En la imagen, Mayús-clic añade o quita.' },
      { kind: 'improved', text: '⌘V pega los clips en la pista bajo el puntero, en el cabezal de reproducción.' },
      { kind: 'improved', text: 'Los controles de fundido aparecen en el clip bajo el puntero, dentro de sus extremos; arrastra uno hacia dentro para hacer el fundido.' },
      { kind: 'improved', text: 'El material que este equipo no puede decodificar, como algún HEVC, muestra «Preparando este clip» con su progreso en lugar de negro, y se reproduce en cuanto su copia está lista.' },
      { kind: 'improved', text: 'Los agentes ponen un clip nuevo en una pista con hueco para él, en vez de añadir una pista cada vez.' },
      { kind: 'improved', text: 'El visor también reproduce a 3× y 4× manteniendo el tono, y el 4× de J/K/L suena. El menú de reproducción se ha reorganizado: Bucle y las velocidades de 0,25× a 4× en dos filas.' },
      { kind: 'improved', text: 'Una imagen del chat se abre en un visor ligero: Esc, un clic al lado o × lo cierran, y Descargar está en su menú contextual.' },
      { kind: 'improved', text: 'Ajustes › Agentes avisa cuando Claude Code es más antiguo que el probado con OpenFilm y da el comando para actualizarlo.' },
      { kind: 'improved', text: 'Windows: ver los agentes ya no bloquea las ventanas; las apps instaladas se leen en segundo plano.' },
      { kind: 'improved', text: 'DeepSeek Harness: con solo la cuenta iniciada, un modelo que necesita clave de API lo dice y cambia al modelo de la cuenta con un clic.' },
      { kind: 'fixed', text: 'Si al reescribirlo un agente deja film.html ausente un momento, el proyecto sigue abierto y el agente sigue trabajando. El historial de versiones aún puede restaurarlo, y el chat ofrece dejarlo como estaba antes del turno.' },
      { kind: 'fixed', text: 'Editar en la imagen es más estable: una capa de texto copiada conserva sus saltos de línea, el clip de una página ya no parpadea en blanco en la línea de tiempo, y hacer clic alrededor de la imagen ya no la tiñe de azul.' },
      { kind: 'fixed', text: 'Ya no queda ningún contorno tras arrastrar o deshacer, y el menú de Capas se cierra al hacer clic en otro sitio.' },
      { kind: 'fixed', text: 'Windows: una skill tuya o de un proyecto ya no se vacía cuando OpenFilm ordena una sesión antigua de un agente.' },
      { kind: 'fixed', text: 'Exportaciones: el material ProRes con sonido ya no sale en negro, y los vídeos con transparencia (WebM, Apple HEVC) siguen transparentes en vez de mostrar un color sólido.' },
      { kind: 'fixed', text: 'Un proyecto nuevo empieza con el estilo de subtítulos que usaste por última vez, y sus subtítulos grabados coinciden con lo que muestra Studio.' },
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
