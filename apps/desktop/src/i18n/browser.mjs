/**
 * What the app's browser (browser.mjs) asks and says in the system's own dialogs and menus, where no page can draw
 * over it or answer for the person. `{host}` is the site's host, `{name}` a file's name.
 */
export const BROWSER_WORDS = {
  en: {
    ask: {
      camera: 'Let {host} use your camera?',
      microphone: 'Let {host} use your microphone?',
      'camera+microphone': 'Let {host} use your camera and microphone?',
      notifications: 'Let {host} show notifications?',
      'clipboard-read': 'Let {host} read what you copied?',
    },
    allow: 'Allow', deny: 'Don’t Allow', remember: 'Remember for this site',
    outside: 'Open this link in another app?', open: 'Open', cancel: 'Cancel',
    risky: '“{name}” can run programs on this computer', riskyDetail: 'Keep it only if you trust {host}.', keep: 'Keep', discard: 'Don’t Download',
    menu: { back: 'Back', forward: 'Forward', reload: 'Reload', openLink: 'Open Link in New Tab', copyLink: 'Copy Link', copyImage: 'Copy Image Address', cut: 'Cut', copy: 'Copy', paste: 'Paste' },
  },
  'zh-CN': {
    ask: {
      camera: '允许 {host} 使用摄像头吗？',
      microphone: '允许 {host} 使用麦克风吗？',
      'camera+microphone': '允许 {host} 使用摄像头和麦克风吗？',
      notifications: '允许 {host} 显示通知吗？',
      'clipboard-read': '允许 {host} 读取你复制的内容吗？',
    },
    allow: '允许', deny: '不允许', remember: '对这个网站记住我的选择',
    outside: '用其他应用打开这个链接吗？', open: '打开', cancel: '取消',
    risky: '「{name}」能在这台电脑上运行程序', riskyDetail: '只有信任 {host} 时才保留它。', keep: '保留', discard: '不下载',
    menu: { back: '后退', forward: '前进', reload: '重新加载', openLink: '在新标签页中打开链接', copyLink: '复制链接', copyImage: '复制图片地址', cut: '剪切', copy: '复制', paste: '粘贴' },
  },
  ja: {
    ask: {
      camera: '{host} にカメラの使用を許可しますか？',
      microphone: '{host} にマイクの使用を許可しますか？',
      'camera+microphone': '{host} にカメラとマイクの使用を許可しますか？',
      notifications: '{host} に通知の表示を許可しますか？',
      'clipboard-read': '{host} にコピーした内容の読み取りを許可しますか？',
    },
    allow: '許可', deny: '許可しない', remember: 'このサイトでは選択を記憶する',
    outside: 'このリンクをほかのアプリで開きますか？', open: '開く', cancel: 'キャンセル',
    risky: '「{name}」はこのコンピュータでプログラムを実行できます', riskyDetail: '{host} を信頼できる場合だけ保存してください。', keep: '保存', discard: 'ダウンロードしない',
    menu: { back: '戻る', forward: '進む', reload: '再読み込み', openLink: 'リンクを新しいタブで開く', copyLink: 'リンクをコピー', copyImage: '画像アドレスをコピー', cut: 'カット', copy: 'コピー', paste: 'ペースト' },
  },
  ko: {
    ask: {
      camera: '{host}이(가) 카메라를 쓰도록 허용할까요?',
      microphone: '{host}이(가) 마이크를 쓰도록 허용할까요?',
      'camera+microphone': '{host}이(가) 카메라와 마이크를 쓰도록 허용할까요?',
      notifications: '{host}이(가) 알림을 보여 주도록 허용할까요?',
      'clipboard-read': '{host}이(가) 복사한 내용을 읽도록 허용할까요?',
    },
    allow: '허용', deny: '허용 안 함', remember: '이 사이트에서는 선택을 기억',
    outside: '이 링크를 다른 앱으로 열까요?', open: '열기', cancel: '취소',
    risky: '「{name}」은(는) 이 컴퓨터에서 프로그램을 실행할 수 있습니다', riskyDetail: '{host}을(를) 신뢰할 때만 보관하세요.', keep: '보관', discard: '다운로드 안 함',
    menu: { back: '뒤로', forward: '앞으로', reload: '새로 고침', openLink: '새 탭에서 링크 열기', copyLink: '링크 복사', copyImage: '이미지 주소 복사', cut: '잘라내기', copy: '복사', paste: '붙여넣기' },
  },
  es: {
    ask: {
      camera: '¿Permitir que {host} use tu cámara?',
      microphone: '¿Permitir que {host} use tu micrófono?',
      'camera+microphone': '¿Permitir que {host} use tu cámara y tu micrófono?',
      notifications: '¿Permitir que {host} muestre notificaciones?',
      'clipboard-read': '¿Permitir que {host} lea lo que has copiado?',
    },
    allow: 'Permitir', deny: 'No permitir', remember: 'Recordar para este sitio',
    outside: '¿Abrir este enlace en otra app?', open: 'Abrir', cancel: 'Cancelar',
    risky: '«{name}» puede ejecutar programas en este ordenador', riskyDetail: 'Consérvalo solo si confías en {host}.', keep: 'Conservar', discard: 'No descargar',
    menu: { back: 'Atrás', forward: 'Adelante', reload: 'Recargar', openLink: 'Abrir enlace en una pestaña nueva', copyLink: 'Copiar enlace', copyImage: 'Copiar dirección de la imagen', cut: 'Cortar', copy: 'Copiar', paste: 'Pegar' },
  },
};
