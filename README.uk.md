<p align="center">
  <img src="docs/logo-light.svg#gh-light-mode-only" alt="OpenFilm" height="48">
  <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="OpenFilm" height="48">
</p>
<p align="center">AI-агент для відео з відкритим кодом.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/openfilm"><img alt="npm" src="https://img.shields.io/npm/v/openfilm?style=flat-square" /></a>
  <a href="https://github.com/openfilm/openfilm/actions/workflows/ci.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/openfilm/openfilm/ci.yml?style=flat-square&branch=main&label=build" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/openfilm/openfilm?style=flat-square" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.zh-TW.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.pt-BR.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.el.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://openfilm.dev"><img alt="Visit our website" src="docs/buttons/website.svg" /></a>
  <a href="https://discord.gg/a462Rs88hF"><img alt="Join our Discord" src="docs/buttons/discord.svg" /></a>
  <a href="https://www.youtube.com/@riverisbuilding"><img alt="Watch on YouTube" src="docs/buttons/youtube.svg" /></a>
</p>

[![OpenFilm: агент створює фільм у вас на очах, а потім ви змінюєте його вручну](docs/openfilm.webp)](https://openfilm.dev)

---

### Про проєкт

OpenFilm перетворює будь-якого агента для програмування на відеоагента й дає редактори, щоб змінити все, що він створить.

Ви з агентом працюєте над одним і тим самим фільмом, разом і наживо. Усе, що змінює агент, ви бачите тієї ж миті; усе, що змінюєте ви, бачить і агент. Більшість роботи робить агент: ви вказуєте на будь-що й просите змінити або змінюєте самі.

- **Фільм створює агент.** Використовуйте Claude Code, Codex, будь-якого іншого агента для програмування або вбудованого агента десктопного застосунку. Він знаходить відеоматеріал, музику й голоси, пише кожну сцену та монтує їх докупи, поки ви дивитеся.
- **Вказуйте на будь-що.** Кліп, мить, відрізок таймлайну, місце в кадрі, рядок субтитрів, картку на полотні. Вкажіть на це, скажіть, чого хочете, і агент точно зрозуміє, про що ви.
- **Змінюйте вручну.** У будь-якій сцені переміщуйте, масштабуйте й обертайте будь-який елемент, переписуйте його текст, змінюйте колір, шрифт і розмір та анімуйте його, навіть слово за словом. На таймлайні обрізайте, розділяйте й переставляйте кліпи, змінюйте їхню швидкість, гучність, появу та згасання, кадруйте, робіть кольорокорекцію, вирізайте фон і редагуйте субтитри та закадровий голос. Ваші правки потрапляють у ті самі файли, і агент працює далі, спираючись на них.

### Встановлення

**Десктопний застосунок.** [Завантажте його для macOS або Windows](https://github.com/openfilm/openfilm/releases/latest). У ньому вже є все потрібне, аж до вбудованого агента, а якщо ви вже користуєтеся Claude Code чи Codex, він працює і з ними.

**Ваш власний агент для програмування.** Додайте навичку (потрібні Node 22.2+ і ffmpeg), а тоді попросіть зробити фільм:

```bash
npx skills add openfilm/openfilm
```

> Зроби 20-секундне відео до запуску мого CLI, з музикою.

### Редактори

Кожен редактор — це інший спосіб працювати над тим самим фільмом, і в кожному ви працюєте разом з агентом. OpenFilm має чотири, а ще більше офіційних редакторів уже в розробці для різних людей: настільки простих, що впорається будь-хто, і професійних робочих місць для тих, кому вони потрібні. Редактори відповідають відкритому стандарту Спільноти, тож будь-хто може створити власний і поділитися ним.

- **Перегляд**: дивіться фільм на весь розмір. Клацніть на мить, протягніть по відрізку або обведіть частину кадру, і агент знатиме, на що ви вказуєте.
- **Монтаж**: повноцінний таймлайн із кліпами, текстом, субтитрами, закадровим голосом і звуком. Переміщуйте, масштабуйте й змінюйте стиль будь-чого всередині сцени. Експортуйте відео або перенесіть таймлайн у Final Cut Pro, Premiere Pro чи DaVinci Resolve.
- **Полотно**: дошка для планування, де нотатки, зображення, кліпи й голоси лежать поруч. Згенеруйте кожен елемент своїми сервісами, а потім надішліть їх на таймлайн по порядку.
- **Колір**: кольорокорекція кожного кліпу з осцилографами, колірними колесами й кривими, для log-зйомки з камери або з LUT у форматі `.cube`. Що бачите в попередньому перегляді, те й експортуєте.

Усі чотири мають спільну бібліотеку: ваші власні відео в папках, підключені, а не скопійовані, і знайдені знову, коли ви їх переміщуєте, а поруч безкоштовні музика, звукові ефекти, голоси та стікери від OpenFilm.

### Спільнота

Спільнота — це відкритий стандарт для всього, що можна додати в OpenFilm, і створювати для неї може будь-хто.

- **Плагіни** розширюють сам OpenFilm новими редакторами та конекторами до зовнішніх сервісів. Власні редактори OpenFilm — теж плагіни, створені так само, як і будь-чиї.
- **Навички** вчать агента, як робити певний тип фільмів.
- **Ресурси** — це музика, звукові ефекти, переходи, ефекти, стилі тексту, стікери й шаблони.
- **Приклади** — це завершені проєкти, на яких можна вчитися і з яких можна робити ремікси.

Кожен із них — звичайна папка. Додайте його у вікні Спільноти в OpenFilm або створіть власний: [зробіть плагін](packages/openfilm/plugins/README.md), [напишіть навичку](https://github.com/openfilm/community/blob/main/SPEC.md), [поділіться ресурсами](https://github.com/openfilm/community/blob/main/assets/CONTRIBUTING.md) або поділіться готовим фільмом як прикладом, а тоді додайте його до списку в [openfilm/community](https://github.com/openfilm/community).

### Як це працює

Фільм — це папка з `film.html`: доріжки кліпів, оформлені за допомогою CSS.

```html
<meta name="viewport" content="width=1920, height=1080">
<section>
  <iframe src="title.html#t=0,4"
          overrides='[{"at":"h1","text":"Aura Pods","style":{"color":"#7fd4ff"}}]'></iframe>
</section>
<section>
  <video src="assets/footage.mp4#t=12,18" at="4" style="left: 160px; top: 90px; width: 1600px; height: 700px"></video>
</section>
<section>
  <audio src="assets/music.mp3" volume="0.6"></audio>
</section>
```

Кожна сцена — це вебсторінка, єдина функція якої, `frame(t)`, малює будь-яку мить усім, що вміє малювати браузер (three.js, WebGL, canvas, SVG, CSS, GSAP, відео), і для того самого `t` завжди дає ту саму картинку, тож сцена рендериться однаково на будь-якому комп'ютері, агент може перевірити кожен кадр, а фреймворки на кшталт Remotion чи HyperFrames не потрібні.

```js
window.film = {
  frame(t) { /* намалювати повну картинку на t-й секунді */ },
};
```

**Ваші зміни залишаються вашими.** Коли ви вручну змінюєте щось усередині сцени, наприклад текст, колір, положення чи розмір, OpenFilm зберігає це в `overrides` кліпу, а не в коді сторінки. Агент може переписати сторінку, а ваші зміни все одно застосуються. Повний формат описано в [SPEC.md](packages/openfilm/SPEC.md).

### Як долучитися

Щоб запустити OpenFilm із вихідного коду або надіслати pull request, прочитайте [CONTRIBUTING.md](CONTRIBUTING.md). Про помилки повідомляйте в [Issues](https://github.com/openfilm/openfilm/issues), додаючи звіт із Settings → Developer → Copy report, а про проблеми безпеки — так, як описано в [SECURITY.md](SECURITY.md).

### Star History

<a href="https://www.star-history.com/#openfilm/openfilm&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date&theme=dark">
    <img alt="Star History of openfilm/openfilm" src="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date">
  </picture>
</a>
