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
  "version": "0.4.1",
  "date": "2026-11-19",
  "notes": {
    "en": [
      {
        "kind": "new",
        "text": "Mark a timeline range with I and O or the Time Range menu, then export just that range."
      },
      {
        "kind": "new",
        "text": "Stop a task and continue with the selected model. Switch agents to pass the request and saved progress to the next agent in the same conversation."
      },
      {
        "kind": "improved",
        "text": "Drag a clip onto the center of another to preview a replacement, then confirm it. Drop by an edge to insert, and use the timeline boundary to collapse track controls."
      },
      {
        "kind": "improved",
        "text": "Linked clips follow the main track during a drag. Selecting a marker previews its frame, and playback starts from the marker."
      },
      {
        "kind": "improved",
        "text": "Library menus open the first Community subcategory and mark media already on the timeline."
      },
      {
        "kind": "improved",
        "text": "Turn off music or sound-effect generation in Services. OpenFilm keeps track of paid requests whose outcomes are uncertain so it can recover them."
      },
      {
        "kind": "improved",
        "text": "Long films open and scrub more smoothly. Studio can use playback copies for hard-to-decode footage and restores the preview when moving between editors."
      },
      {
        "kind": "fixed",
        "text": "After a timeline jump, Play waits for the selected frame and starts as soon as it is ready, even when the chapter takes several seconds to load."
      },
      {
        "kind": "improved",
        "text": "New timeline jumps take priority while a chapter loads. Studio starts preparing the next page earlier during playback."
      },
      {
        "kind": "improved",
        "text": "Exports keep the timeline as it was when queued. Progress shows the current stage, including mixing, muxing and saving."
      },
      {
        "kind": "fixed",
        "text": "The chat stays steady as processing, commands and replies come in. The conversation title opens history and new-chat actions."
      },
      {
        "kind": "fixed",
        "text": "OpenFilm retries interrupted model requests and shows connection details if a request fails. Studio can reconnect after a failed restart and copy diagnostics while disconnected."
      },
      {
        "kind": "fixed",
        "text": "On Windows, closing the window while a task, export or generation is running minimizes it. Installer updates protect projects and media."
      },
      {
        "kind": "fixed",
        "text": "The project list can recover from a damaged index, and personal assets can move with the projects folder."
      },
      {
        "kind": "fixed",
        "text": "Doubao has more voice previews. Seedream sends small reference images directly, and completed media failures stop polling."
      }
    ],
    "zh-CN": [
      {
        "kind": "new",
        "text": "用 I、O 或「时间区域」菜单选定片段，只导出标记的时间范围。"
      },
      {
        "kind": "new",
        "text": "停止任务后可用当前选择的模型继续。切换智能体时，原请求和已记录的进度会交给新智能体，在同一轮接着做。"
      },
      {
        "kind": "improved",
        "text": "把片段拖到另一个片段中间可预览并确认替换，拖到边缘可插入。也可以从时间轴边界收起轨道控制。"
      },
      {
        "kind": "improved",
        "text": "拖动主轨时，关联片段实时跟随。选择标记可预览画面，播放时从标记位置开始。"
      },
      {
        "kind": "improved",
        "text": "打开社区分类会选中第一个子分类。时间轴上已使用的素材会标为「已添加」。"
      },
      {
        "kind": "improved",
        "text": "可以在服务设置里关闭音乐或音效生成。付费请求结果未明时，OpenFilm 会保留原请求以便恢复。"
      },
      {
        "kind": "improved",
        "text": "长项目打开和拖动预览更流畅。难解码的素材可用播放副本，切换编辑器后会恢复预览。"
      },
      {
        "kind": "fixed",
        "text": "跳转时间轴后，点播放会等待当前位置的画面。即使章节需要几秒加载，画面就绪后也会自动播放。"
      },
      {
        "kind": "improved",
        "text": "章节加载期间继续点时间轴，新的跳转优先响应。顺序播放时，Studio 会更早准备下一页。"
      },
      {
        "kind": "improved",
        "text": "导出以加入队列时的时间轴为准，进度会显示混音、封装、保存等阶段。"
      },
      {
        "kind": "fixed",
        "text": "思考、运行命令和回复切换时，聊天位置更稳定。点击会话标题可打开历史或新建会话。"
      },
      {
        "kind": "fixed",
        "text": "模型连接中断可自动重试，失败时可查看连接详情。Studio 重启失败后可重连，断线期间也能复制诊断信息。"
      },
      {
        "kind": "fixed",
        "text": "Windows 上关闭窗口时，运行中的任务、导出和生成会继续。安装更新时会保护项目和个人素材。"
      },
      {
        "kind": "fixed",
        "text": "项目索引损坏时可以恢复列表，个人素材库也可以随项目文件夹移动。"
      },
      {
        "kind": "fixed",
        "text": "豆包语音补充了试听。Seedream 可直接发送小参考图，媒体任务确认失败后会停止轮询。"
      }
    ],
    "ja": [
      {
        "kind": "new",
        "text": "I と O キー、または「時間範囲」メニューでタイムラインの範囲を設定し、その範囲だけを書き出せます。"
      },
      {
        "kind": "new",
        "text": "停止したタスクを選択中のモデルで再開できます。エージェントを切り替えると、同じ会話で元の依頼と進捗が引き継がれます。"
      },
      {
        "kind": "improved",
        "text": "クリップの中央にドラッグして置換をプレビューし、確認できます。端にドロップすると挿入し、タイムラインの境界からトラック操作を折りたためます。"
      },
      {
        "kind": "improved",
        "text": "メイントラックをドラッグすると連結されたクリップも追従します。マーカーを選ぶとそのフレームを確認でき、再生もそこから始まります。"
      },
      {
        "kind": "improved",
        "text": "コミュニティのカテゴリを開くと最初のサブカテゴリが選ばれ、タイムラインで使っている素材には追加済みの印が付きます。"
      },
      {
        "kind": "improved",
        "text": "サービス設定で音楽や効果音の生成をオフにできます。結果が不明な有料リクエストは復旧できるように保持します。"
      },
      {
        "kind": "improved",
        "text": "長い作品の表示やスクラブが滑らかになりました。デコードしにくい素材には再生用コピーを使え、エディター切り替え後もプレビューが復帰します。"
      },
      {
        "kind": "fixed",
        "text": "タイムラインを移動して再生すると、選んだ位置のフレームが表示できるまで待機します。読み込みに数秒かかる章も、準備ができると再生が始まります。"
      },
      {
        "kind": "improved",
        "text": "章の読み込み中も、新しいタイムライン移動が優先されます。再生中は次のページの準備を早めに開始します。"
      },
      {
        "kind": "improved",
        "text": "書き出しにはキューに追加した時点のタイムラインが使われ、ミキシング、結合、保存などの進捗が表示されます。"
      },
      {
        "kind": "fixed",
        "text": "処理、コマンド実行、返信の切り替え時にチャットが安定しました。会話のタイトルから履歴や新規チャットを開けます。"
      },
      {
        "kind": "fixed",
        "text": "モデル接続が切れたときに再試行し、失敗時は接続の詳細を表示します。Studio の再起動失敗後にも再接続でき、オフラインでも診断情報をコピーできます。"
      },
      {
        "kind": "fixed",
        "text": "Windows ではタスクや書き出し、生成の実行中にウィンドウを閉じると最小化されます。更新時はプロジェクトや個人の素材が保護されます。"
      },
      {
        "kind": "fixed",
        "text": "プロジェクト一覧はインデックスが壊れても復旧でき、個人の素材ライブラリをプロジェクトフォルダと一緒に移動できます。"
      },
      {
        "kind": "fixed",
        "text": "Doubao の音声サンプルが増えました。Seedream の小さい参照画像は直接送信され、失敗が確定したメディア生成は状態確認を終了します。"
      }
    ],
    "ko": [
      {
        "kind": "new",
        "text": "I와 O 또는 시간 범위 메뉴로 타임라인 구간을 지정하고 그 구간만 내보낼 수 있습니다."
      },
      {
        "kind": "new",
        "text": "중지한 작업을 현재 선택한 모델로 이어갈 수 있습니다. 에이전트를 바꾸면 원래 요청과 저장한 진행 내역을 같은 대화에서 인계합니다."
      },
      {
        "kind": "improved",
        "text": "클립 중앙에 드래그하면 교체를 미리 보고 확인할 수 있습니다. 가장자리에 놓으면 삽입되며 타임라인 경계에서 트랙 컨트롤을 접을 수 있습니다."
      },
      {
        "kind": "improved",
        "text": "메인 트랙을 드래그하면 연결된 클립이 따라 움직입니다. 마커를 선택하면 해당 프레임이 보이고 그 지점에서 재생됩니다."
      },
      {
        "kind": "improved",
        "text": "커뮤니티 분류를 열면 첫 하위 분류가 선택되며 타임라인에 사용된 소재에 추가됨 표시가 붙습니다."
      },
      {
        "kind": "improved",
        "text": "서비스 설정에서 음악이나 효과음 생성을 끌 수 있습니다. 결과가 불확실한 유료 요청은 복구할 수 있도록 보관합니다."
      },
      {
        "kind": "improved",
        "text": "긴 프로젝트를 더 부드럽게 열고 탐색할 수 있습니다. 디코딩하기 어려운 소재에는 재생용 복사본을 쓰고 편집기 전환 후 미리보기를 복구합니다."
      },
      {
        "kind": "fixed",
        "text": "타임라인을 이동한 뒤 재생을 누르면 선택한 위치의 프레임을 기다립니다. 챕터를 불러오는 데 몇 초가 걸려도 준비되면 재생이 시작됩니다."
      },
      {
        "kind": "improved",
        "text": "챕터를 불러오는 동안에도 새 타임라인 이동이 우선됩니다. 재생 중에는 다음 페이지를 더 일찍 준비합니다."
      },
      {
        "kind": "improved",
        "text": "내보내기는 대기열에 추가한 시점의 타임라인을 사용하며 믹싱, 파일 결합, 저장 등 현재 단계를 표시합니다."
      },
      {
        "kind": "fixed",
        "text": "처리 중, 명령 실행, 답변 사이를 전환할 때 대화 위치가 안정적입니다. 대화 제목을 눌러 기록을 열거나 새 대화를 시작할 수 있습니다."
      },
      {
        "kind": "fixed",
        "text": "모델 연결이 끊기면 재시도하고 실패 시 연결 상세 정보를 표시합니다. Studio 재시작 실패 후에도 다시 연결하고 오프라인에서 진단 정보를 복사할 수 있습니다."
      },
      {
        "kind": "fixed",
        "text": "Windows에서 작업, 내보내기 또는 생성 중 창을 닫으면 최소화됩니다. 업데이트 시 프로젝트와 개인 소재를 보호합니다."
      },
      {
        "kind": "fixed",
        "text": "인덱스가 손상돼도 프로젝트 목록을 복구할 수 있고 개인 소재 라이브러리를 프로젝트 폴더와 함께 옮길 수 있습니다."
      },
      {
        "kind": "fixed",
        "text": "Doubao 음성 미리듣기가 늘었습니다. Seedream의 작은 참조 이미지는 직접 전송하고 실패한 미디어 작업은 상태 조회를 마칩니다."
      }
    ],
    "es": [
      {
        "kind": "new",
        "text": "Marca un intervalo de la línea de tiempo con I y O o desde el menú Intervalo de tiempo y exporta solo ese tramo."
      },
      {
        "kind": "new",
        "text": "Detén una tarea y continúala con el modelo seleccionado. Al cambiar de agente, el nuevo recibe la solicitud y el progreso en la misma conversación."
      },
      {
        "kind": "improved",
        "text": "Arrastra un clip al centro de otro para previsualizar y confirmar el reemplazo. Suéltalo en un borde para insertar y usa el límite de la línea de tiempo para plegar los controles de pista."
      },
      {
        "kind": "improved",
        "text": "Los clips vinculados siguen a la pista principal al arrastrarla. Al seleccionar un marcador se muestra su fotograma y la reproducción comienza ahí."
      },
      {
        "kind": "improved",
        "text": "Las categorías de la Comunidad abren su primera subcategoría y la biblioteca marca los archivos ya usados en la línea de tiempo."
      },
      {
        "kind": "improved",
        "text": "Desactiva la generación de música o efectos sonoros desde Servicios. OpenFilm conserva las solicitudes de pago de resultado incierto para poder recuperarlas."
      },
      {
        "kind": "improved",
        "text": "Los proyectos largos se abren y recorren con mayor fluidez. Studio puede usar copias de reproducción para archivos difíciles de decodificar y recupera la vista previa al cambiar de editor."
      },
      {
        "kind": "fixed",
        "text": "Al saltar en la línea de tiempo, Reproducir espera el fotograma elegido y comienza en cuanto esté listo, aunque el capítulo tarde varios segundos en cargar."
      },
      {
        "kind": "improved",
        "text": "Los saltos nuevos en la línea de tiempo tienen prioridad mientras se abre un capítulo. Durante la reproducción, Studio prepara antes la página siguiente."
      },
      {
        "kind": "improved",
        "text": "La exportación usa la línea de tiempo tal como estaba al entrar en la cola. El progreso muestra las etapas de mezcla, multiplexado y guardado."
      },
      {
        "kind": "fixed",
        "text": "El chat mantiene su posición al pasar del procesamiento a los comandos y las respuestas. El título de la conversación abre el historial y la opción de iniciar un chat."
      },
      {
        "kind": "fixed",
        "text": "OpenFilm reintenta las solicitudes interrumpidas y muestra los detalles de conexión si fallan. Studio puede reconectarse tras un reinicio fallido y copiar el diagnóstico sin conexión."
      },
      {
        "kind": "fixed",
        "text": "En Windows, cerrar la ventana durante una tarea, exportación o generación minimiza la aplicación. Las actualizaciones protegen los proyectos y los archivos personales."
      },
      {
        "kind": "fixed",
        "text": "La lista de proyectos puede recuperarse si se daña el índice y la biblioteca personal puede moverse junto con la carpeta de proyectos."
      },
      {
        "kind": "fixed",
        "text": "Doubao tiene más muestras de voz. Seedream envía directamente las imágenes de referencia pequeñas y se deja de consultar una generación con fallo definitivo."
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
