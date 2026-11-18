<p align="center">
  <img src="docs/logo-light.svg#gh-light-mode-only" alt="OpenFilm" height="48">
  <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="OpenFilm" height="48">
</p>
<p align="center">Der Open-Source-KI-Videoagent.</p>
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

[![OpenFilm: Ein Agent macht einen Film, während du zusiehst, und dann änderst du ihn von Hand](docs/openfilm.webp)](https://openfilm.dev)

---

### Über OpenFilm

OpenFilm macht aus jedem Coding-Agenten einen Video-Agenten, mit Editoren, in denen du alles ändern kannst, was er erstellt.

Du und der Agent arbeitet gemeinsam und live am selben Film. Was der Agent ändert, siehst du in dem Moment, in dem es passiert; was du änderst, sieht auch der Agent. Der Agent erledigt den Großteil der Arbeit; du zeigst auf irgendetwas und bittest um eine Änderung oder machst sie selbst.

- **Der Agent macht den Film.** Nutze Claude Code, Codex, einen anderen Coding-Agenten oder den Agenten, der in die Desktop-App eingebaut ist. Er sucht Filmmaterial, Musik und Stimmen, schreibt jede Einstellung und schneidet alles zusammen, während du zusiehst.
- **Zeig auf irgendetwas.** Einen Clip, einen Moment, einen Abschnitt der Timeline, eine Stelle im Bild, eine Untertitelzeile, eine Karte auf der Canvas. Zeig darauf, sag, was du willst, und der Agent weiß genau, was du meinst.
- **Ändere es von Hand.** In jeder Einstellung kannst du jedes Element verschieben, skalieren und drehen, seinen Text neu schreiben, Farbe, Schrift und Größe ändern und es animieren, sogar Wort für Wort. In der Timeline kürzt, teilst und ordnest du Clips, änderst Geschwindigkeit, Lautstärke und Blenden, beschneidest das Bild, korrigierst die Farben, stellst den Hintergrund frei und bearbeitest Untertitel und Voice-over. Deine Änderungen landen in denselben Dateien, und der Agent baut darauf auf.

### Installation

**Desktop-App.** [Lade sie für macOS oder Windows herunter](https://github.com/openfilm/openfilm/releases/latest). Alles, was du brauchst, ist dabei, bis hin zu einem eingebauten Agenten, und wenn du Claude Code oder Codex schon nutzt, funktioniert sie auch damit.

**Dein eigener Coding-Agent.** Füge den Skill hinzu (benötigt Node 22.2+ und ffmpeg) und bitte dann um einen Film:

```bash
npx skills add openfilm/openfilm
```

> Mach ein 20 Sekunden langes Launch-Video für mein CLI, mit Musik.

### Editoren

Jeder Editor ist eine eigene Art, am selben Film zu arbeiten, und in jedem arbeitest du mit dem Agenten zusammen. OpenFilm bringt vier mit, und weitere offizielle Editoren für ganz unterschiedliche Menschen sind in Entwicklung: so einfach, dass jeder sofort loslegen kann, und professionelle Arbeitsplätze für alle, die sie wollen. Editoren folgen dem offenen Standard der Community, also kann jeder einen bauen und teilen.

- **Vorführung**: Sieh dir den Film in voller Größe an. Klicke auf einen Moment, ziehe über einen Abschnitt oder kreise einen Teil des Bildes ein, und der Agent weiß, worauf du zeigst.
- **Schnitt**: eine vollständige Timeline mit Clips, Text, Untertiteln, Voice-over und Ton. Verschiebe, skaliere und gestalte alles innerhalb einer Einstellung neu. Exportiere ein Video oder bring die Timeline nach Final Cut Pro, Premiere Pro oder DaVinci Resolve.
- **Canvas**: ein Board zum Planen, mit Notizen, Bildern, Clips und Stimmen nebeneinander. Generiere jedes Element mit deinen Diensten und schick sie dann der Reihe nach in die Timeline.
- **Farbe**: Korrigiere die Farben jedes Clips mit Scopes, Farbrädern und Kurven, ausgehend von Log-Material der Kamera oder mit `.cube`-LUTs. Was du in der Vorschau siehst, ist genau das, was du exportierst.

Alle vier teilen sich eine Bibliothek: dein eigenes Material in Ordnern, verknüpft statt kopiert und wiedergefunden, wenn du es verschiebst, dazu die kostenlose Musik, Soundeffekte, Stimmen und Sticker von OpenFilm.

### Community

Die Community ist ein offener Standard für alles, was du OpenFilm hinzufügen kannst, und jeder kann dafür entwickeln.

- **Plugins** erweitern OpenFilm selbst um neue Editoren und um Konnektoren zu externen Diensten. Die Editoren von OpenFilm sind selbst Plugins, gebaut wie die von allen anderen.
- **Skills** bringen dem Agenten bei, wie man eine bestimmte Art von Film macht.
- **Assets** sind Musik, Soundeffekte, Übergänge, Effekte, Textstile, Sticker und Vorlagen.
- **Beispiele** sind vollständige Projekte zum Lernen und Remixen.

Jedes davon ist ein einfacher Ordner. Füge eins über das Community-Fenster in OpenFilm hinzu oder bau dein eigenes: [ein Plugin erstellen](packages/openfilm/plugins/README.md), [einen Skill schreiben](https://github.com/openfilm/community/blob/main/SPEC.md), [Assets teilen](https://github.com/openfilm/community/blob/main/assets/CONTRIBUTING.md) oder einen fertigen Film als Beispiel teilen, und trag es dann in [openfilm/community](https://github.com/openfilm/community) ein.

### So funktioniert es

Ein Film ist ein Ordner mit einer `film.html`: Spuren mit Clips, gestaltet mit CSS.

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

Jede Einstellung ist eine Webseite, deren einzige Funktion, `frame(t)`, jeden beliebigen Moment mit allem zeichnet, was ein Browser zeichnen kann (three.js, WebGL, canvas, SVG, CSS, GSAP, Video), und für dasselbe `t` immer dasselbe Bild liefert. Deshalb rendert sie auf jedem Rechner gleich, der Agent kann jedes Frame prüfen, und ein Framework wie Remotion oder HyperFrames ist überflüssig.

```js
window.film = {
  frame(t) { /* zeichnet das vollständige Bild bei Sekunde t */ },
};
```

**Deine Änderungen bleiben deine.** Wenn du in einer Einstellung etwas von Hand änderst, etwa Text, Farbe, Position oder Größe, speichert OpenFilm das in den `overrides` des Clips statt im Code der Seite. Der Agent kann die Seite neu schreiben, und deine Änderungen gelten weiter. Das vollständige Format steht in [SPEC.md](packages/openfilm/SPEC.md).

### Mitwirken

Wenn du OpenFilm aus dem Quellcode starten oder einen Pull Request schicken willst, lies [CONTRIBUTING.md](CONTRIBUTING.md). Melde Fehler in den [Issues](https://github.com/openfilm/openfilm/issues) mit dem Bericht aus Settings → Developer → Copy report und Sicherheitsprobleme so, wie es [SECURITY.md](SECURITY.md) beschreibt.

### Star History

<a href="https://www.star-history.com/#openfilm/openfilm&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date&theme=dark">
    <img alt="Star History of openfilm/openfilm" src="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date">
  </picture>
</a>
