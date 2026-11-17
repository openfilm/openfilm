<p align="center">
  <a href="https://openfilm.dev">
    <img src="docs/logo-light.svg#gh-light-mode-only" alt="OpenFilm" height="48">
    <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="OpenFilm" height="48">
  </a>
</p>
<p align="center">El agente de vídeo con IA de código abierto.</p>
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
  <a href="https://openfilm.dev"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/-VISIT_OUR_WEBSITE-f0f0f0?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjEwIDggODAgODgiPjxtYXNrIGlkPSJnIiBtYXNrVW5pdHM9InVzZXJTcGFjZU9uVXNlIiB4PSIwIiB5PSIwIiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIGZpbGw9IiNmZmYiLz48cGF0aCBkPSJNMTcgMTJIMzdRNDAgMTIgNDAgMTVWMjdRNDAgMjkgMzguNSAzMC41TDMxIDM3Vjg4UTMxIDkyIDI3IDkyUTIzIDkyIDIzIDg4VjM3TDE1LjUgMzAuNVExNCAyOSAxNCAyN1YxNVExNCAxMiAxNyAxMloiIHN0cm9rZT0iIzAwMCIgc3Ryb2tlLXdpZHRoPSI3IiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PC9tYXNrPjxnIGZpbGw9IiMxMTEiIG1hc2s9InVybCgjZykiPjxyZWN0IHg9IjIyIiB5PSIxMiIgd2lkdGg9IjY0IiBoZWlnaHQ9IjIwIiByeD0iNSIvPjxyZWN0IHg9IjI1IiB5PSI0NCIgd2lkdGg9IjQ3IiBoZWlnaHQ9IjE5IiByeD0iNSIvPjwvZz48cGF0aCBmaWxsPSIjMTExIiBkPSJNMTcgMTJIMzdRNDAgMTIgNDAgMTVWMjdRNDAgMjkgMzguNSAzMC41TDMxIDM3Vjg4UTMxIDkyIDI3IDkyUTIzIDkyIDIzIDg4VjM3TDE1LjUgMzAuNVExNCAyOSAxNCAyN1YxNVExNCAxMiAxNyAxMloiLz48L3N2Zz4K&logoColor=111111"><img alt="Visit our website" src="https://img.shields.io/badge/-VISIT_OUR_WEBSITE-111111?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjEwIDggODAgODgiPjxtYXNrIGlkPSJnIiBtYXNrVW5pdHM9InVzZXJTcGFjZU9uVXNlIiB4PSIwIiB5PSIwIiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIGZpbGw9IiNmZmYiLz48cGF0aCBkPSJNMTcgMTJIMzdRNDAgMTIgNDAgMTVWMjdRNDAgMjkgMzguNSAzMC41TDMxIDM3Vjg4UTMxIDkyIDI3IDkyUTIzIDkyIDIzIDg4VjM3TDE1LjUgMzAuNVExNCAyOSAxNCAyN1YxNVExNCAxMiAxNyAxMloiIHN0cm9rZT0iIzAwMCIgc3Ryb2tlLXdpZHRoPSI3IiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PC9tYXNrPjxnIGZpbGw9IiNmZmYiIG1hc2s9InVybCgjZykiPjxyZWN0IHg9IjIyIiB5PSIxMiIgd2lkdGg9IjY0IiBoZWlnaHQ9IjIwIiByeD0iNSIvPjxyZWN0IHg9IjI1IiB5PSI0NCIgd2lkdGg9IjQ3IiBoZWlnaHQ9IjE5IiByeD0iNSIvPjwvZz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMTcgMTJIMzdRNDAgMTIgNDAgMTVWMjdRNDAgMjkgMzguNSAzMC41TDMxIDM3Vjg4UTMxIDkyIDI3IDkyUTIzIDkyIDIzIDg4VjM3TDE1LjUgMzAuNVExNCAyOSAxNCAyN1YxNVExNCAxMiAxNyAxMloiLz48L3N2Zz4K&logoColor=white"></picture></a>
  <a href="https://discord.gg/a462Rs88hF"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/-JOIN_OUR_DISCORD-f0f0f0?style=for-the-badge&logo=discord&logoColor=111111"><img alt="Join our Discord" src="https://img.shields.io/badge/-JOIN_OUR_DISCORD-111111?style=for-the-badge&logo=discord&logoColor=white"></picture></a>
  <a href="https://www.youtube.com/@riverisbuilding"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/-WATCH_ON_YOUTUBE-f0f0f0?style=for-the-badge&logo=youtube&logoColor=111111"><img alt="Watch on YouTube" src="https://img.shields.io/badge/-WATCH_ON_YOUTUBE-111111?style=for-the-badge&logo=youtube&logoColor=white"></picture></a>
</p>

[![OpenFilm: un agente hace un vídeo mientras miras y luego lo cambias a mano](docs/openfilm.webp)](https://openfilm.dev)

---

### Acerca de

OpenFilm convierte cualquier agente de programación en un agente de vídeo, con editores para cambiar todo lo que crea.

Trabajas con el agente en el mismo vídeo, juntos y en directo. Lo que cambia el agente lo ves en el momento; lo que cambias tú, el agente también lo ve. El agente hace la mayor parte del trabajo; tú señalas cualquier cosa y pides un cambio, o lo haces tú mismo.

- **El agente hace el vídeo.** Usa Claude Code, Codex, cualquier otro agente de programación o el que viene integrado en la app de escritorio. Busca metraje, música y voces, escribe cada plano y los monta mientras miras.
- **Señala cualquier cosa.** Un clip, un momento, un tramo de la línea de tiempo, un punto de la imagen, una línea de subtítulos, una tarjeta en el lienzo. Señálalo, di lo que quieres y el agente sabe exactamente a qué te refieres.
- **Cámbialo a mano.** Dentro de cualquier plano, mueve, escala y gira cualquier elemento, reescribe su texto, cambia su color, fuente y tamaño, y anímalo, incluso palabra por palabra. En la línea de tiempo, acorta, divide y reordena clips, cambia su velocidad, volumen y fundidos, recorta la imagen, grada el color y quita el fondo, y edita subtítulos y voz en off. Tus cambios quedan en los mismos archivos y el agente parte de ellos.

### Instalación

**App de escritorio.** [Descárgala para macOS o Windows](https://github.com/openfilm/openfilm/releases/latest). Trae todo lo que necesitas, incluso un agente integrado, y funciona con Claude Code o Codex si ya los usas.

**Tu propio agente de programación.** Añade la habilidad (requiere Node 22.2+ y ffmpeg) y pide un vídeo:

```bash
npx skills add openfilm/openfilm
```

> Haz un vídeo de lanzamiento de 20 segundos para mi CLI, con música.

### Editores

Cada editor es una forma distinta de trabajar en el mismo vídeo, y en todos trabajas junto al agente. OpenFilm trae cuatro, y hay más editores oficiales en desarrollo para distintos tipos de personas: tan sencillos que cualquiera puede empezar enseguida, y mesas de trabajo profesionales para quien las quiera. Los editores siguen el estándar abierto de la Comunidad, así que cualquiera puede crear uno y compartirlo.

- **Proyección**: mira el vídeo a tamaño completo. Haz clic en un momento, arrastra sobre un tramo o rodea una parte de la imagen, y el agente sabe qué estás señalando.
- **Edición**: una línea de tiempo completa con clips, texto, subtítulos, voz en off y sonido. Mueve, escala y cambia el estilo de cualquier cosa dentro de un plano. Exporta un vídeo o lleva la línea de tiempo a Final Cut Pro, Premiere Pro o DaVinci Resolve.
- **Lienzo**: un tablero para planificar, con notas, imágenes, clips y voces lado a lado. Genera cada uno con tus servicios y luego llévalos en orden a la línea de tiempo.
- **Color**: grada cada clip con scopes, ruedas de color y curvas, desde metraje log de cámara o con LUT `.cube`. Lo que ves en la vista previa es lo que exportas.

Los cuatro comparten una biblioteca: tu propio metraje en carpetas, enlazado en lugar de copiado y localizado de nuevo cuando lo mueves, junto a la música, los efectos de sonido, las voces y los stickers gratuitos de OpenFilm.

### Comunidad

La Comunidad es un estándar abierto para todo lo que puedes añadir a OpenFilm, y cualquiera puede crear para ella.

- **Los plugins** amplían OpenFilm con nuevos editores y conectores a servicios externos. Los propios editores de OpenFilm son plugins, hechos igual que los de cualquiera.
- **Las habilidades** enseñan al agente una forma de hacer un tipo de vídeo.
- **Los recursos** son música, efectos de sonido, transiciones, efectos, estilos de texto, stickers y plantillas.
- **Los ejemplos** son proyectos completos para aprender de ellos y remezclarlos.

Cada uno es una carpeta normal. Añade uno desde la ventana Comunidad de OpenFilm o crea el tuyo: [crea un plugin](packages/openfilm/plugins/README.md), [escribe una habilidad](https://github.com/openfilm/community/blob/main/SPEC.md), [comparte recursos](https://github.com/openfilm/community/blob/main/assets/CONTRIBUTING.md) o comparte un vídeo terminado como ejemplo, y luego regístralo en [openfilm/community](https://github.com/openfilm/community).

### Cómo funciona

Un vídeo es una carpeta con un `film.html`: pistas de clips con estilos en CSS.

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

Cada plano es una página web cuya única función, `frame(t)`, dibuja cualquier momento con todo lo que un navegador puede dibujar (three.js, WebGL, canvas, SVG, CSS, GSAP, vídeo) y siempre la misma imagen para el mismo `t`, así que se renderiza igual en cualquier máquina, el agente puede revisar cada fotograma y no hace falta ningún framework como Remotion o HyperFrames.

```js
window.film = {
  frame(t) { /* dibuja la imagen completa en el segundo t */ },
};
```

**Tus cambios siguen siendo tuyos.** Cuando cambias algo a mano dentro de un plano, como su texto, color, posición o tamaño, OpenFilm lo guarda en los `overrides` del clip y no en el código de la página. El agente puede reescribir la página y tus cambios se siguen aplicando. El formato completo está en [SPEC.md](packages/openfilm/SPEC.md).

### Contribuir

Para ejecutar OpenFilm desde el código fuente o enviar una pull request, lee [CONTRIBUTING.md](CONTRIBUTING.md). Informa de errores en [Issues](https://github.com/openfilm/openfilm/issues) con el informe de Configuración → Desarrollador → Copiar informe, y de problemas de seguridad como explica [SECURITY.md](SECURITY.md).

### Star History

<a href="https://www.star-history.com/#openfilm/openfilm&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date&theme=dark">
    <img alt="Star History of openfilm/openfilm" src="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date">
  </picture>
</a>
