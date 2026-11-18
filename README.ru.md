<p align="center">
  <img src="docs/logo-light.svg#gh-light-mode-only" alt="OpenFilm" height="48">
  <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="OpenFilm" height="48">
</p>
<p align="center">AI-агент для видео с открытым исходным кодом.</p>
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

[![OpenFilm: агент делает фильм у вас на глазах, а потом вы меняете его вручную](docs/openfilm.webp)](https://openfilm.dev)

---

### О проекте

OpenFilm превращает любого агента для программирования в видеоагента и даёт редакторы, в которых можно изменить всё, что он сделает.

Вы и агент работаете над одним и тем же фильмом, вместе и в реальном времени. Всё, что меняет агент, вы видите сразу; всё, что меняете вы, видит и агент. Большую часть работы делает агент; вы указываете на что угодно и просите изменить или меняете сами.

- **Фильм делает агент.** Используйте Claude Code, Codex, любого другого агента для программирования или встроенного в десктопное приложение. Он находит видеоматериалы, музыку и голоса, пишет каждую сцену и монтирует их вместе, пока вы смотрите.
- **Укажите на что угодно.** Клип, момент, отрезок таймлайна, место в кадре, строку субтитров, карточку на холсте. Укажите, скажите, чего хотите, и агент точно поймёт, что вы имеете в виду.
- **Меняйте вручную.** Внутри любой сцены перемещайте, масштабируйте и поворачивайте любой элемент, переписывайте его текст, меняйте цвет, шрифт и размер и анимируйте его, вплоть до отдельных слов. На таймлайне подрезайте, разрезайте и переставляйте клипы, меняйте их скорость, громкость, плавное появление и затухание, кадрируйте, делайте цветокоррекцию и удаляйте фон, редактируйте субтитры и закадровый голос. Ваши правки попадают в те же файлы, и агент продолжает работу с их учётом.

### Установка

**Десктопное приложение.** [Скачайте его для macOS или Windows](https://github.com/openfilm/openfilm/releases/latest). В нём есть всё необходимое, вплоть до встроенного агента, и оно работает с Claude Code или Codex, если вы уже ими пользуетесь.

**Ваш собственный агент для программирования.** Добавьте навык (нужны Node 22.2+ и ffmpeg), а затем попросите сделать фильм:

```bash
npx skills add openfilm/openfilm
```

> Сделай 20-секундное видео к запуску моего CLI, с музыкой.

### Редакторы

Каждый редактор — это свой способ работать над одним и тем же фильмом, и в каждом вы работаете вместе с агентом. В OpenFilm их четыре, а новые официальные редакторы уже в разработке — для самых разных людей: достаточно простые, чтобы разобрался любой, и профессиональные рабочие места для тех, кому они нужны. Редакторы следуют открытому стандарту Сообщества, поэтому любой может создать свой и поделиться им.

- **Просмотр**: смотрите фильм в полном размере. Щёлкните по моменту, протяните по отрезку или обведите часть кадра, и агент поймёт, на что вы указываете.
- **Монтаж**: полноценный таймлайн с клипами, текстом, субтитрами, закадровым голосом и звуком. Перемещайте, масштабируйте и меняйте стиль чего угодно внутри сцены. Экспортируйте видео или перенесите таймлайн в Final Cut Pro, Premiere Pro или DaVinci Resolve.
- **Холст**: доска для планирования, где рядом лежат заметки, изображения, клипы и голоса. Сгенерируйте каждый элемент через свои сервисы, а затем отправьте их на таймлайн по порядку.
- **Цвет**: цветокоррекция каждого клипа со скопами, цветовыми кругами и кривыми, из log-материала камеры или с LUT в формате `.cube`. Что видите в превью, то и получите при экспорте.

Все четыре работают с одной библиотекой: ваши собственные материалы в папках, подключённые по ссылке, а не скопированные, и найденные снова, если вы их переместите, а рядом — бесплатная музыка, звуковые эффекты, голоса и стикеры от OpenFilm.

### Сообщество

Сообщество — это открытый стандарт для всего, что можно добавить в OpenFilm, и создавать для него может любой.

- **Плагины** расширяют сам OpenFilm новыми редакторами и коннекторами к внешним сервисам. Собственные редакторы OpenFilm — тоже плагины, сделанные так же, как и любые другие.
- **Навыки** учат агента, как делать фильмы определённого вида.
- **Материалы** — это музыка, звуковые эффекты, переходы, эффекты, стили текста, стикеры и шаблоны.
- **Примеры** — это готовые проекты, на которых можно учиться и которые можно ремиксовать.

Каждый из них — обычная папка. Добавьте его из окна «Сообщество» в OpenFilm или создайте свой: [сделайте плагин](packages/openfilm/plugins/README.md), [напишите навык](https://github.com/openfilm/community/blob/main/SPEC.md), [поделитесь материалами](https://github.com/openfilm/community/blob/main/assets/CONTRIBUTING.md) или поделитесь готовым фильмом как примером, а затем добавьте его в список в [openfilm/community](https://github.com/openfilm/community).

### Как это работает

Фильм — это папка с `film.html`: дорожки клипов, оформленные с помощью CSS.

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

Каждая сцена — это веб-страница, единственная функция которой, `frame(t)`, рисует любой момент всем, что умеет рисовать браузер (three.js, WebGL, canvas, SVG, CSS, GSAP, видео), и всегда одну и ту же картинку для одного и того же `t`, поэтому она рендерится одинаково на любой машине, агент может проверить каждый кадр, а фреймворки вроде Remotion или HyperFrames не нужны.

```js
window.film = {
  frame(t) { /* нарисовать всю картинку на t-й секунде */ },
};
```

**Ваши правки остаются вашими.** Когда вы вручную меняете что-то внутри сцены, например текст, цвет, положение или размер, OpenFilm сохраняет это в `overrides` клипа, а не в коде страницы. Агент может переписать страницу, а ваши правки всё равно применятся. Полный формат описан в [SPEC.md](packages/openfilm/SPEC.md).

### Участие в разработке

Чтобы запустить OpenFilm из исходников или отправить pull request, прочитайте [CONTRIBUTING.md](CONTRIBUTING.md). Об ошибках сообщайте в [Issues](https://github.com/openfilm/openfilm/issues), приложив отчёт из Settings → Developer → Copy report, а о проблемах безопасности — как описано в [SECURITY.md](SECURITY.md).

### Star History

<a href="https://www.star-history.com/#openfilm/openfilm&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date&theme=dark">
    <img alt="Star History of openfilm/openfilm" src="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date">
  </picture>
</a>
