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
  "version": "0.3.1",
  "date": "2026-11-08",
  "notes": {
    "en": [
      {
        "kind": "new",
        "text": "Use the built-in OpenFilm agent with your Services account. Manage the order and visibility of its Claude, GPT and DeepSeek models."
      },
      {
        "kind": "new",
        "text": "Edit your workspace layout: move and resize panels, create nested splits, undo changes, and save, import or export named layouts."
      },
      {
        "kind": "new",
        "text": "Receive system notifications when an agent finishes, fails or needs an answer while OpenFilm is in the background. Click a notification to return to its project."
      },
      {
        "kind": "new",
        "text": "Connect Google Antigravity through ACP. Install its connection component from Settings; OpenFilm opens the terminal and detects it when installation finishes."
      },
      {
        "kind": "new",
        "text": "Export editing projects with complete original media and editable trim handles for Premiere Pro, Final Cut Pro, Jianying and CapCut. Choose linked originals or full copies, or keep rendered effects."
      },
      {
        "kind": "improved",
        "text": "The canvas prepares in the background after a project opens. Its first visit shows a loading view while it becomes ready."
      },
      {
        "kind": "improved",
        "text": "Click library assets to download and preview automatically. Loading can be cancelled or retried, and templates start playing when ready."
      },
      {
        "kind": "improved",
        "text": "Discover shows an offline snapshot of official skills while refreshing the catalog. Failed downloads retain usable results and can be retried."
      },
      {
        "kind": "new",
        "text": "Discover reviewed community sounds, music, transitions and effects in the library, and open the contribution guide to submit your own."
      },
      {
        "kind": "improved",
        "text": "The app menu brings together projects, settings, documentation and community links. Reorder model and library categories by dragging; Codex usage percentages stay on one line."
      },
      {
        "kind": "improved",
        "text": "An interrupted render resumes completed chunks when its inputs match. Replaced footage invalidates old chunks; deliberately cancelled renders are cleaned up."
      },
      {
        "kind": "fixed",
        "text": "Canvas elements no longer remain over the editor. Undoing a chat turn restores its canvas and files together, without bringing removed clips back."
      },
      {
        "kind": "new",
        "text": "Disable or enable selected clips with Shift+E or the clip menu, with undo and redo. Their positions, source trims and levels stay in place."
      },
      {
        "kind": "fixed",
        "text": "Clear a timeline range with its close button or Escape, including when clips are also selected."
      },
      {
        "kind": "fixed",
        "text": "The chat drag caret clears when dragging ends or is cancelled. Relative message times choose the correct unit at hour and day boundaries."
      },
      {
        "kind": "fixed",
        "text": "Transparent exports preserve edge colors when resized or motion-blurred, and retain frames across transparency changes."
      },
      {
        "kind": "improved",
        "text": "HEVC master exports retain more fine changing texture in dark images. Encoding may take longer and produce larger files."
      },
      {
        "kind": "fixed",
        "text": "Windows installers retain library preview videos. Temporary Windows page-loading failures retry; Linux cross-disk trash and interrupted history restores work reliably."
      },
      {
        "kind": "fixed",
        "text": "Long filenames, captions and clipped transcripts keep complete Unicode characters. Media names with percent signs and skills with capitalized names or empty front matter are handled correctly."
      },
      {
        "kind": "fixed",
        "text": "Diagnostic logs redact keys and emails. Malformed cookies, invalid media ranges and backslash links are handled safely, and canvas character images stay inside the project."
      },
      {
        "kind": "fixed",
        "text": "Replaced media refreshes its preview. Damaged character records no longer hide intact ones; template framing, rgba transparency and media-use counts respect their source values."
      },
      {
        "kind": "fixed",
        "text": "Project covers retry while being drawn. Local model installation completes after provider settings refresh, and library transitions preview once per click."
      }
    ],
    "zh-CN": [
      {
        "kind": "new",
        "text": "新增内置 OpenFilm 智能体，与服务商共用账号。可以调整 Claude、GPT 和 DeepSeek 模型的显示顺序与开关。"
      },
      {
        "kind": "new",
        "text": "可以编辑工作区布局：移动、缩放面板，嵌套分栏，撤销更改，并保存、导入或导出命名布局。"
      },
      {
        "kind": "new",
        "text": "OpenFilm 在后台时，智能体完成、出错或等待回答会发送系统通知；点击通知回到对应项目。"
      },
      {
        "kind": "new",
        "text": "支持通过 ACP 连接 Google Antigravity。在设置中安装连接组件，应用会打开终端执行安装，完成后自动检测。"
      },
      {
        "kind": "new",
        "text": "导出 Premiere Pro、Final Cut Pro、剪映或 CapCut 工程时，可保留完整原片和可调整的入出点。可以引用原片、复制完整素材，或保留渲染效果。"
      },
      {
        "kind": "improved",
        "text": "项目打开后在后台准备画布。首次切入时，尚未准备好的画布会显示加载状态。"
      },
      {
        "kind": "improved",
        "text": "单击素材即可自动下载并预览；等待时可取消或重试，模板准备好后自动播放。"
      },
      {
        "kind": "improved",
        "text": "发现页在刷新目录时先显示官方技能的离线快照；部分下载失败仍保留可用结果，并支持重试。"
      },
      {
        "kind": "new",
        "text": "素材库支持发现和使用审核过的社区音效、配乐、转场与特效，并提供投稿指南入口。"
      },
      {
        "kind": "improved",
        "text": "应用菜单集中提供项目、设置、文档和社区入口；模型和素材分类支持拖动排序，Codex 用量百分比保持单行。"
      },
      {
        "kind": "improved",
        "text": "意外中断的渲染会在输入一致时复用已完成分块；替换原素材会使旧分块失效，主动取消则清理本次分块。"
      },
      {
        "kind": "fixed",
        "text": "修复画布元素覆盖剪辑区域。撤销本轮会一起恢复画布和文件，已移除的片段不会被重新合并回来。"
      },
      {
        "kind": "new",
        "text": "按 Shift+E 或使用片段菜单，可以禁用、启用选中的片段，并支持撤销重做；位置、入出点和音量都会保留。"
      },
      {
        "kind": "fixed",
        "text": "时间线范围可以点击关闭按钮或按 Esc 清除，同时选中片段时也能正常清除。"
      },
      {
        "kind": "fixed",
        "text": "对话框的拖放光标会在拖动结束或取消后清除；消息时间在小时、天的边界使用正确单位。"
      },
      {
        "kind": "fixed",
        "text": "透明视频缩放和运动模糊时保留边缘颜色，透明与不透明画面切换时不再丢帧。"
      },
      {
        "kind": "improved",
        "text": "HEVC master 导出保留更多暗场中细微变化的纹理，编码可能更慢，文件也可能更大。"
      },
      {
        "kind": "fixed",
        "text": "Windows 安装包保留素材库动态预览；临时页面加载失败会重试。修复 Linux 跨盘回收和历史恢复被回收站错误打断的问题。"
      },
      {
        "kind": "fixed",
        "text": "长文件名、字幕和截断的对话记录保留完整字符；正确处理带百分号的素材名、大小写技能名和空 front matter。"
      },
      {
        "kind": "fixed",
        "text": "诊断日志隐藏密钥和邮箱；安全处理损坏的 cookie、无效媒体范围和反斜杠链接，画布角色图片只能取自项目内。"
      },
      {
        "kind": "fixed",
        "text": "替换素材后刷新预览，损坏的角色记录不再影响其他角色；模板构图、rgba 透明度和素材使用计数保留正确结果。"
      },
      {
        "kind": "fixed",
        "text": "项目封面尚未生成时会重试；本地模型在服务设置刷新后再报告安装完成，转场预览每次点击播放一遍。"
      }
    ],
    "ja": [
      {
        "kind": "new",
        "text": "サービスと同じアカウントで内蔵 OpenFilm エージェントを利用できます。Claude、GPT、DeepSeek モデルの表示と順序を管理できます。"
      },
      {
        "kind": "new",
        "text": "ワークスペースを編集できます。パネルの移動・サイズ変更、入れ子の分割、取り消し、名前付きレイアウトの保存・読み込み・書き出しに対応します。"
      },
      {
        "kind": "new",
        "text": "バックグラウンドでエージェントが完了・失敗したときや回答を待つときにシステム通知を表示します。通知をクリックすると該当プロジェクトに戻ります。"
      },
      {
        "kind": "new",
        "text": "ACP 経由で Google Antigravity に接続できます。設定から接続コンポーネントをインストールすると、ターミナルが開き、完了後に自動検出します。"
      },
      {
        "kind": "new",
        "text": "Premiere Pro、Final Cut Pro、Jianying、CapCut 用プロジェクトに全長の元メディアと調整可能なトリムを保持できます。元ファイルの参照、全体のコピー、レンダリング効果の保持を選べます。"
      },
      {
        "kind": "improved",
        "text": "プロジェクトを開いた後、バックグラウンドでキャンバスを準備します。初回表示で準備中の場合は読み込み表示が出ます。"
      },
      {
        "kind": "improved",
        "text": "ライブラリの素材をクリックすると自動取得・プレビューします。待機のキャンセルと再試行に対応し、テンプレートは準備後に再生します。"
      },
      {
        "kind": "improved",
        "text": "カタログの更新中は公式スキルのオフライン一覧を表示します。一部の取得に失敗しても利用可能な結果を保持し、再試行できます。"
      },
      {
        "kind": "new",
        "text": "審査済みのコミュニティ効果音、音楽、トランジション、エフェクトをライブラリで利用でき、投稿ガイドも開けます。"
      },
      {
        "kind": "improved",
        "text": "アプリメニューにプロジェクト、設定、ドキュメント、コミュニティをまとめました。モデルと素材カテゴリはドラッグで並べ替えられ、Codex 使用率は1行に収まります。"
      },
      {
        "kind": "improved",
        "text": "予期せず中断したレンダリングは、入力が同じなら完成済みの部分を再利用します。素材の置き換えで古い部分は無効になり、明示的なキャンセルでは削除します。"
      },
      {
        "kind": "fixed",
        "text": "キャンバスの要素が編集画面に残る問題を修正しました。会話ターンの取り消しでキャンバスとファイルを一緒に戻し、削除したクリップが復活しなくなりました。"
      },
      {
        "kind": "new",
        "text": "Shift+E またはクリップメニューで選択クリップを無効・有効にできます。取り消しとやり直しに対応し、位置、トリム、音量を保持します。"
      },
      {
        "kind": "fixed",
        "text": "タイムラインの範囲を閉じるボタンまたは Escape で解除できます。クリップも選択されている場合に対応します。"
      },
      {
        "kind": "fixed",
        "text": "チャットのドラッグカーソルは終了・キャンセル時に消えます。メッセージ時刻は時間と日の境界で正しい単位を表示します。"
      },
      {
        "kind": "fixed",
        "text": "透明映像の拡大縮小とモーションブラーで縁の色を保持し、透明・不透明の切り替えによるフレーム欠落を修正しました。"
      },
      {
        "kind": "improved",
        "text": "HEVC master は暗い画面の細かく変化する質感をより多く保持します。エンコード時間とファイルサイズが増える場合があります。"
      },
      {
        "kind": "fixed",
        "text": "Windows インストーラーにライブラリの動画プレビューを保持し、一時的なページ読み込み失敗は再試行します。Linux の別ディスクへのごみ箱移動と履歴復元の中断も修正しました。"
      },
      {
        "kind": "fixed",
        "text": "長いファイル名、字幕、省略した会話記録で Unicode 文字を保持します。% を含む素材名、大文字を含むスキル名、空の front matter を正しく扱います。"
      },
      {
        "kind": "fixed",
        "text": "診断ログのキーとメールを伏せ、不正な cookie、メディア範囲、バックスラッシュのリンクを安全に扱います。人物画像はプロジェクト内からのみ取得します。"
      },
      {
        "kind": "fixed",
        "text": "素材の置き換えでプレビューを更新し、壊れた人物記録が他の記録を隠さなくなりました。テンプレートの配置、rgba の透明度、素材の使用数も修正しました。"
      },
      {
        "kind": "fixed",
        "text": "作成中のプロジェクト表紙を再取得します。ローカルモデルはサービス設定更新後に完了を表示し、トランジションはクリックごとに1回再生します。"
      }
    ],
    "ko": [
      {
        "kind": "new",
        "text": "서비스와 같은 계정으로 내장 OpenFilm 에이전트를 사용할 수 있습니다. Claude, GPT, DeepSeek 모델의 표시 여부와 순서를 관리하세요."
      },
      {
        "kind": "new",
        "text": "작업 공간 레이아웃을 편집하세요. 패널 이동과 크기 조절, 중첩 분할, 실행 취소, 이름을 지정한 레이아웃 저장·가져오기·내보내기를 지원합니다."
      },
      {
        "kind": "new",
        "text": "OpenFilm이 백그라운드에 있을 때 에이전트 완료, 오류, 응답 대기를 시스템 알림으로 알려줍니다. 알림을 누르면 해당 프로젝트로 돌아갑니다."
      },
      {
        "kind": "new",
        "text": "ACP로 Google Antigravity에 연결할 수 있습니다. 설정에서 연결 구성 요소 설치를 누르면 터미널을 열고 설치 완료 후 자동 감지합니다."
      },
      {
        "kind": "new",
        "text": "Premiere Pro, Final Cut Pro, Jianying, CapCut 프로젝트에 전체 원본과 조정 가능한 트림을 유지합니다. 원본 연결, 전체 복사, 렌더링 효과 유지 중 선택할 수 있습니다."
      },
      {
        "kind": "improved",
        "text": "프로젝트를 연 뒤 백그라운드에서 캔버스를 준비합니다. 처음 전환할 때 준비 중이면 로딩 상태를 표시합니다."
      },
      {
        "kind": "improved",
        "text": "라이브러리 소재를 누르면 자동 다운로드 후 미리 봅니다. 대기를 취소하거나 재시도할 수 있고 템플릿은 준비되면 재생합니다."
      },
      {
        "kind": "improved",
        "text": "카탈로그 갱신 중 공식 스킬의 오프라인 목록을 먼저 표시합니다. 일부 다운로드 실패 시에도 사용 가능한 결과를 유지하고 재시도할 수 있습니다."
      },
      {
        "kind": "new",
        "text": "검토된 커뮤니티 효과음, 음악, 전환, 효과를 라이브러리에서 찾아 사용하고 기여 가이드를 열 수 있습니다."
      },
      {
        "kind": "improved",
        "text": "앱 메뉴에서 프로젝트, 설정, 문서와 커뮤니티를 열 수 있습니다. 모델과 소재 분류는 드래그로 정렬하고 Codex 사용률은 한 줄로 표시합니다."
      },
      {
        "kind": "improved",
        "text": "예기치 않게 중단된 렌더링은 입력이 같으면 완료된 부분을 재사용합니다. 소재를 바꾸면 이전 부분을 무효화하고 직접 취소한 렌더링은 정리합니다."
      },
      {
        "kind": "fixed",
        "text": "캔버스 요소가 편집 영역에 남는 문제를 수정했습니다. 대화 턴을 취소하면 캔버스와 파일을 함께 복원하며 삭제된 클립이 다시 합쳐지지 않습니다."
      },
      {
        "kind": "new",
        "text": "Shift+E 또는 클립 메뉴에서 선택 클립을 비활성화·활성화할 수 있습니다. 실행 취소와 다시 실행을 지원하고 위치, 트림, 음량을 유지합니다."
      },
      {
        "kind": "fixed",
        "text": "타임라인 범위를 닫기 버튼이나 Escape로 지울 수 있습니다. 클립도 함께 선택된 경우에도 동작합니다."
      },
      {
        "kind": "fixed",
        "text": "채팅의 드래그 커서는 종료나 취소 후 사라집니다. 메시지 시간은 시간·일 경계에서 올바른 단위를 사용합니다."
      },
      {
        "kind": "fixed",
        "text": "투명 영상의 크기 조절과 모션 블러에서 가장자리 색을 유지하고 투명도 전환 시 프레임이 누락되지 않습니다."
      },
      {
        "kind": "improved",
        "text": "HEVC master 내보내기는 어두운 화면에서 미세하게 변하는 질감을 더 많이 유지합니다. 인코딩 시간과 파일 크기가 늘어날 수 있습니다."
      },
      {
        "kind": "fixed",
        "text": "Windows 설치 파일에 라이브러리 영상 미리보기를 포함하고 일시적 페이지 로딩 실패를 재시도합니다. Linux의 다른 디스크 휴지통 이동과 이력 복원 중단도 수정했습니다."
      },
      {
        "kind": "fixed",
        "text": "긴 파일명, 자막, 잘린 대화 기록에서 유니코드 문자를 온전히 유지합니다. %가 있는 소재명, 대문자 스킬명과 빈 front matter를 올바르게 처리합니다."
      },
      {
        "kind": "fixed",
        "text": "진단 로그의 키와 이메일을 가리고 손상된 쿠키, 잘못된 미디어 범위와 역슬래시 링크를 안전하게 처리합니다. 캐릭터 이미지는 프로젝트 내부에서만 가져옵니다."
      },
      {
        "kind": "fixed",
        "text": "소재 교체 시 미리보기를 갱신하고 손상된 캐릭터 기록이 다른 기록에 영향을 주지 않습니다. 템플릿 배치, rgba 투명도와 소재 사용 횟수도 수정했습니다."
      },
      {
        "kind": "fixed",
        "text": "생성 중인 프로젝트 표지를 다시 요청합니다. 로컬 모델은 서비스 설정 갱신 후 설치 완료를 표시하고 전환은 클릭마다 한 번 재생합니다."
      }
    ],
    "es": [
      {
        "kind": "new",
        "text": "Usa el agente OpenFilm integrado con tu cuenta de Servicios. Gestiona el orden y la visibilidad de sus modelos Claude, GPT y DeepSeek."
      },
      {
        "kind": "new",
        "text": "Edita el espacio de trabajo: mueve y redimensiona paneles, crea divisiones anidadas, deshaz cambios y guarda, importa o exporta diseños con nombre."
      },
      {
        "kind": "new",
        "text": "Recibe notificaciones cuando un agente termina, falla o espera una respuesta con OpenFilm en segundo plano. Haz clic para volver al proyecto."
      },
      {
        "kind": "new",
        "text": "Conecta Google Antigravity mediante ACP. Instala su componente desde Ajustes: OpenFilm abre el terminal y lo detecta al finalizar."
      },
      {
        "kind": "new",
        "text": "Exporta proyectos para Premiere Pro, Final Cut Pro, Jianying y CapCut con medios originales completos y recortes ajustables. Elige enlazar originales, copiarlos completos o conservar los efectos renderizados."
      },
      {
        "kind": "improved",
        "text": "El lienzo se prepara en segundo plano tras abrir un proyecto. Si aún no está listo en la primera visita, muestra el estado de carga."
      },
      {
        "kind": "improved",
        "text": "Haz clic en los recursos para descargarlos y previsualizarlos automáticamente. Puedes cancelar o reintentar la espera; las plantillas se reproducen cuando están listas."
      },
      {
        "kind": "improved",
        "text": "Descubrir muestra una copia sin conexión de las habilidades oficiales mientras actualiza el catálogo. Los fallos conservan los resultados utilizables y permiten reintentar."
      },
      {
        "kind": "new",
        "text": "Encuentra sonidos, música, transiciones y efectos comunitarios revisados en la biblioteca y abre la guía para enviar los tuyos."
      },
      {
        "kind": "improved",
        "text": "El menú reúne proyectos, ajustes, documentación y comunidad. Arrastra para ordenar modelos y categorías; el porcentaje de uso de Codex permanece en una línea."
      },
      {
        "kind": "improved",
        "text": "Un renderizado interrumpido reutiliza las partes terminadas si las entradas coinciden. Sustituir material invalida las partes antiguas; cancelar deliberadamente las elimina."
      },
      {
        "kind": "fixed",
        "text": "Los elementos del lienzo ya no cubren el editor. Deshacer un turno restaura el lienzo y sus archivos juntos, sin recuperar clips eliminados."
      },
      {
        "kind": "new",
        "text": "Activa o desactiva clips seleccionados con Mayús+E o su menú, con deshacer y rehacer. Se conservan su posición, recortes y niveles."
      },
      {
        "kind": "fixed",
        "text": "Borra un rango de la línea de tiempo con su botón de cierre o Escape, incluso si también hay clips seleccionados."
      },
      {
        "kind": "fixed",
        "text": "El cursor de arrastre del chat desaparece al terminar o cancelar. Las horas de los mensajes eligen la unidad correcta al pasar de minutos a horas o días."
      },
      {
        "kind": "fixed",
        "text": "Las exportaciones transparentes mantienen el color de los bordes al escalar o aplicar desenfoque de movimiento y no pierden fotogramas al cambiar la transparencia."
      },
      {
        "kind": "improved",
        "text": "HEVC master conserva más textura fina cambiante en imágenes oscuras. Puede tardar más y producir archivos mayores."
      },
      {
        "kind": "fixed",
        "text": "Los instaladores de Windows incluyen los vídeos de vista previa y reintentan fallos temporales de carga. Se corrigen la papelera entre discos en Linux y las restauraciones interrumpidas por errores de papelera."
      },
      {
        "kind": "fixed",
        "text": "Los nombres largos, subtítulos y transcripciones recortadas conservan los caracteres Unicode. Se manejan nombres con %, habilidades con mayúsculas y front matter vacío."
      },
      {
        "kind": "fixed",
        "text": "Los diagnósticos ocultan claves y correos. Se manejan cookies dañadas, rangos de medios inválidos y enlaces con barras inversas; las imágenes de personajes permanecen dentro del proyecto."
      },
      {
        "kind": "fixed",
        "text": "Sustituir material actualiza la vista previa. Un registro de personaje dañado no oculta los demás; se corrigen el encuadre, la transparencia rgba y los recuentos de uso."
      },
      {
        "kind": "fixed",
        "text": "Las portadas se reintentan mientras se generan. La instalación de modelos locales termina tras actualizar sus ajustes y las transiciones se reproducen una vez por clic."
      }
    ]
  }
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
