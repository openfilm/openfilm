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
  "version": "0.3.2",
  "date": "2026-11-09",
  "notes": {
    "en": [
      {
        "kind": "fixed",
        "text": "Switch projects reliably in the Windows desktop app, including when opening a project from the tab bar."
      },
      {
        "kind": "new",
        "text": "Duplicate a project into an independent copy in the same group."
      },
      {
        "kind": "fixed",
        "text": "Link media from Windows network shares that refuse system links. Preview and export use the original files."
      },
      {
        "kind": "fixed",
        "text": "Open editors refresh the timeline after missed file notifications and keep newer edits when requests finish out of order."
      },
      {
        "kind": "improved",
        "text": "Canvas videos show a first frame at rest, play on hover, and support frame capture and in-place renaming."
      },
      {
        "kind": "new",
        "text": "Add text, image and video references to writing nodes on the canvas."
      },
      {
        "kind": "improved",
        "text": "Use Alt and Shift to select layers, organize compatible timeline tracks with undo, and view mixed audio waveforms on compound clips."
      },
      {
        "kind": "improved",
        "text": "Editing-project exports keep the look automatically. Supported settings stay editable, and you can link or copy the source media."
      },
      {
        "kind": "improved",
        "text": "Jianying and CapCut drafts retain editable subtitle styling and supported clip settings. Renaming a draft keeps copied and rendered media linked."
      },
      {
        "kind": "improved",
        "text": "Visible thumbnails load first, paused previews refresh when images arrive, and export progress is accessible from the project title bar."
      },
      {
        "kind": "new",
        "text": "Generate video with TBC mischief 1 and Grok Imagine Video 1.5 Lite through OpenRouter in Studio and the CLI."
      },
      {
        "kind": "fixed",
        "text": "Recover Windows exports when an encoder briefly holds a file after a browser crash, and mark transparent HEVC as straight alpha."
      },
      {
        "kind": "fixed",
        "text": "Reconnect OpenFilm when credentials expire. Chat history deduplicates sessions, keeps attachment types and extensions, and can undo a same-size text rewrite."
      },
      {
        "kind": "fixed",
        "text": "Fix duplicate library categories, narrow layout previews, long example durations, size units, prerelease ordering and MCP tool labels."
      }
    ],
    "zh-CN": [
      {
        "kind": "fixed",
        "text": "修复 Windows 桌面版切换项目和从标签栏打开项目时卡住的问题。"
      },
      {
        "kind": "new",
        "text": "可以在同一分组中复制项目，打开独立副本继续编辑。"
      },
      {
        "kind": "fixed",
        "text": "Windows 网络共享不允许创建系统链接时，仍可引用原素材进行预览和导出。"
      },
      {
        "kind": "fixed",
        "text": "打开的工程会在文件通知漏报后刷新时间轴，避免迟到的旧结果覆盖新编辑。"
      },
      {
        "kind": "improved",
        "text": "画布视频静止时显示首帧，悬停播放，可截取画面并直接改名。"
      },
      {
        "kind": "new",
        "text": "画布写作节点可以添加文本、图片和视频作为参考。"
      },
      {
        "kind": "improved",
        "text": "图层可用 Alt 和 Shift 多选。时间轴可整理兼容轨道并撤销，复合片段显示混合音频波形。"
      },
      {
        "kind": "improved",
        "text": "导出剪辑工程时自动保留画面效果。目标软件支持的参数仍可编辑，素材可引用或复制。"
      },
      {
        "kind": "improved",
        "text": "剪映和 CapCut 草稿保留可编辑字幕样式及受支持的片段参数。草稿改名后，复制和渲染的素材仍能找到。"
      },
      {
        "kind": "improved",
        "text": "优先加载可见缩略图，图片加载后刷新暂停预览，项目顶栏可查看导出进度。"
      },
      {
        "kind": "new",
        "text": "Studio 和命令行的 OpenRouter 服务新增 TBC mischief 1 和 Grok Imagine Video 1.5 Lite 视频模型。"
      },
      {
        "kind": "fixed",
        "text": "修复 Windows 导出时浏览器崩溃后编码器短暂占用文件导致的续跑失败。透明 HEVC 会标记为直通 Alpha。"
      },
      {
        "kind": "fixed",
        "text": "OpenFilm 凭据失效时提示重新登录。修复对话重复、附件类型或扩展名丢失，以及等长文本改写撤销漏掉的问题。"
      },
      {
        "kind": "fixed",
        "text": "修复素材分类重复、窄窗口布局预览、长示例时长、大小单位、预发布版本排序和 MCP 工具名称显示。"
      }
    ],
    "ja": [
      {
        "kind": "fixed",
        "text": "Windows デスクトップ版でプロジェクトの切り替えやタブバーからの起動が止まる問題を修正しました。"
      },
      {
        "kind": "new",
        "text": "同じグループにプロジェクトを複製し、独立したコピーを編集できます。"
      },
      {
        "kind": "fixed",
        "text": "システムリンクを作れない Windows の共有フォルダでも、元の素材を参照してプレビューと書き出しができます。"
      },
      {
        "kind": "fixed",
        "text": "ファイル変更通知を逃してもタイムラインを更新し、遅い応答で新しい編集が上書きされないようにしました。"
      },
      {
        "kind": "improved",
        "text": "キャンバスの動画は停止時に先頭フレームを表示し、ホバーで再生します。フレームの保存とその場での名前変更にも対応します。"
      },
      {
        "kind": "new",
        "text": "キャンバスの文章ノードにテキスト、画像、動画の参照を追加できます。"
      },
      {
        "kind": "improved",
        "text": "Alt と Shift でレイヤーを選択し、互換性のあるトラックを整理して取り消せます。複合クリップにはミックス音声の波形が表示されます。"
      },
      {
        "kind": "improved",
        "text": "編集プロジェクトの書き出しでは効果が自動で保持されます。対応する設定は編集でき、素材は参照またはコピーできます。"
      },
      {
        "kind": "improved",
        "text": "剪映と CapCut の下書きに編集可能な字幕スタイルと対応するクリップ設定を残します。名前を変えてもコピー済み素材とレンダリング素材の参照を保持します。"
      },
      {
        "kind": "improved",
        "text": "表示中のサムネイルを優先し、画像の読み込み後に停止中のプレビューを更新します。書き出しの進捗はプロジェクトのタイトルバーから確認できます。"
      },
      {
        "kind": "new",
        "text": "Studio と CLI の OpenRouter で、TBC mischief 1 と Grok Imagine Video 1.5 Lite による動画生成に対応しました。"
      },
      {
        "kind": "fixed",
        "text": "Windows でブラウザーがクラッシュした後にエンコーダーがファイルを一時的に保持しても書き出しを再開できます。透明 HEVC をストレートアルファとして記録します。"
      },
      {
        "kind": "fixed",
        "text": "OpenFilm の資格情報が失効した場合は再ログインを案内します。会話の重複、添付ファイルの種類と拡張子、同じ長さの書き換えの取り消しを修正しました。"
      },
      {
        "kind": "fixed",
        "text": "素材カテゴリの重複、狭いウィンドウのレイアウト、長いサンプルの時間表示、サイズ単位、プレリリースの順序と MCP ツール名を修正しました。"
      }
    ],
    "ko": [
      {
        "kind": "fixed",
        "text": "Windows 데스크톱 앱에서 프로젝트를 전환하거나 탭 표시줄에서 열 때 멈추는 문제를 수정했습니다."
      },
      {
        "kind": "new",
        "text": "같은 그룹에 프로젝트를 복제해 독립적으로 편집할 수 있습니다."
      },
      {
        "kind": "fixed",
        "text": "시스템 링크를 허용하지 않는 Windows 네트워크 공유의 원본을 참조해 미리 보고 내보낼 수 있습니다."
      },
      {
        "kind": "fixed",
        "text": "파일 변경 알림을 놓쳐도 타임라인을 새로 고치며, 늦게 도착한 응답이 최신 편집을 덮어쓰지 않습니다."
      },
      {
        "kind": "improved",
        "text": "캔버스 동영상은 정지 시 첫 프레임을 표시하고 마우스를 올리면 재생됩니다. 프레임을 캡처하고 이름을 바로 바꿀 수 있습니다."
      },
      {
        "kind": "new",
        "text": "캔버스의 글쓰기 노드에 텍스트, 이미지, 동영상 참고 자료를 추가할 수 있습니다."
      },
      {
        "kind": "improved",
        "text": "Alt와 Shift로 레이어를 선택하고 호환되는 트랙을 정리한 뒤 실행 취소할 수 있습니다. 복합 클립에는 믹스 파형이 표시됩니다."
      },
      {
        "kind": "improved",
        "text": "편집 프로젝트를 내보낼 때 효과를 자동으로 유지합니다. 지원되는 설정은 편집할 수 있고 원본 미디어는 연결하거나 복사할 수 있습니다."
      },
      {
        "kind": "improved",
        "text": "剪映과 CapCut 초안에 편집 가능한 자막 스타일과 지원되는 클립 설정이 유지됩니다. 초안 이름을 바꿔도 복사 및 렌더링한 미디어 연결을 유지합니다."
      },
      {
        "kind": "improved",
        "text": "보이는 썸네일부터 불러오고 이미지가 준비되면 일시 정지된 미리 보기를 갱신합니다. 프로젝트 제목 표시줄에서 내보내기 진행 상황을 확인할 수 있습니다."
      },
      {
        "kind": "new",
        "text": "Studio와 CLI의 OpenRouter에서 TBC mischief 1 및 Grok Imagine Video 1.5 Lite 동영상 모델을 사용할 수 있습니다."
      },
      {
        "kind": "fixed",
        "text": "Windows에서 브라우저 충돌 후 인코더가 잠시 파일을 잡고 있어도 내보내기를 재개합니다. 투명 HEVC에는 스트레이트 알파를 표시합니다."
      },
      {
        "kind": "fixed",
        "text": "OpenFilm 자격 증명이 만료되면 다시 로그인하도록 안내합니다. 대화 중복과 첨부 파일 유형 및 확장자, 같은 길이의 텍스트 수정 실행 취소를 바로잡았습니다."
      },
      {
        "kind": "fixed",
        "text": "라이브러리 분류 중복, 좁은 창 레이아웃, 긴 예제의 시간 표시, 크기 단위, 시험판 정렬과 MCP 도구 이름 표시를 수정했습니다."
      }
    ],
    "es": [
      {
        "kind": "fixed",
        "text": "Corrige el bloqueo al cambiar de proyecto o abrirlo desde las pestañas en Windows."
      },
      {
        "kind": "new",
        "text": "Duplica un proyecto dentro del mismo grupo y edita la copia de forma independiente."
      },
      {
        "kind": "fixed",
        "text": "Vincula los originales de carpetas de red de Windows que rechazan enlaces del sistema y úsalos al previsualizar o exportar."
      },
      {
        "kind": "fixed",
        "text": "La línea de tiempo se actualiza aunque falte un aviso del sistema y las respuestas atrasadas no sobrescriben ediciones recientes."
      },
      {
        "kind": "improved",
        "text": "Los videos del lienzo muestran el primer fotograma en reposo, se reproducen al pasar el cursor y permiten capturar fotogramas y cambiar el nombre."
      },
      {
        "kind": "new",
        "text": "Añade texto, imágenes y videos de referencia a los nodos de escritura del lienzo."
      },
      {
        "kind": "improved",
        "text": "Selecciona capas con Alt y Shift, organiza pistas compatibles con opción de deshacer y consulta la forma de onda mezclada de los clips compuestos."
      },
      {
        "kind": "improved",
        "text": "Al exportar un proyecto de edición, los efectos se conservan automáticamente. Los ajustes compatibles siguen siendo editables y puedes vincular o copiar los medios originales."
      },
      {
        "kind": "improved",
        "text": "Los borradores de Jianying y CapCut conservan el estilo editable de los subtítulos y los ajustes compatibles de clips. Los medios siguen vinculados al renombrar el borrador."
      },
      {
        "kind": "improved",
        "text": "Carga primero las miniaturas visibles, actualiza la vista en pausa al cargar imágenes y consulta el progreso de exportación desde la barra del proyecto."
      },
      {
        "kind": "new",
        "text": "Genera video con TBC mischief 1 y Grok Imagine Video 1.5 Lite mediante OpenRouter en Studio y la CLI."
      },
      {
        "kind": "fixed",
        "text": "Reanuda la exportación en Windows cuando el codificador retiene un archivo tras un fallo del navegador y marca HEVC transparente con alfa recto."
      },
      {
        "kind": "fixed",
        "text": "Vuelve a conectar OpenFilm cuando caducan las credenciales. El chat evita sesiones duplicadas, conserva tipos y extensiones de adjuntos y deshace cambios de texto del mismo tamaño."
      },
      {
        "kind": "fixed",
        "text": "Corrige categorías repetidas, vistas de diseño estrechas, duraciones largas, unidades de tamaño, orden de versiones previas y etiquetas de herramientas MCP."
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
