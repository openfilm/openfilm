<p align="center">
  <img src="docs/logo-light.svg#gh-light-mode-only" alt="OpenFilm" height="48">
  <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="OpenFilm" height="48">
</p>
<p align="center">AI-videoagenten med åben kildekode.</p>
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

[![OpenFilm: en agent laver en film, mens du ser på, og bagefter ændrer du den i hånden](docs/openfilm.webp)](https://openfilm.dev)

---

### Om

OpenFilm gør enhver kodeagent til en videoagent, med editorer, så du kan ændre alt, hvad den laver.

Du og agenten arbejder på den samme film, sammen og live. Alt, hvad agenten ændrer, ser du, mens det sker; alt, hvad du ændrer, ser agenten også. Agenten klarer det meste af arbejdet; du peger på hvad som helst og beder om en ændring, eller laver den selv.

- **Agenten laver filmen.** Brug Claude Code, Codex, en hvilken som helst anden kodeagent eller den, der er indbygget i desktopappen. Den finder optagelser, musik og stemmer, skriver hvert shot og klipper dem sammen, mens du ser på.
- **Peg på hvad som helst.** Et klip, et øjeblik, et stykke af tidslinjen, et sted i billedet, en undertekstlinje, et kort på lærredet. Peg på det, sig hvad du vil have, og agenten ved præcis, hvad du mener.
- **Ret det i hånden.** Inde i ethvert shot kan du flytte, skalere og rotere ethvert element, skrive teksten om, ændre farve, skrifttype og størrelse og animere det, helt ned til ord for ord. På tidslinjen kan du trimme, dele og omarrangere klip, ændre hastighed, lydstyrke og ind- og udtoning, beskære, farvekorrigere og fjerne baggrunden samt redigere undertekster og speak. Dine ændringer lander i de samme filer, og agenten bygger videre på dem.

### Installation

**Desktopapp.** [Download den til macOS eller Windows](https://github.com/openfilm/openfilm/releases/latest). Alt, hvad du har brug for, følger med, helt ned til en indbygget agent, og den virker med Claude Code eller Codex, hvis du allerede bruger dem.

**Din egen kodeagent.** Tilføj færdigheden (kræver Node 22.2+ og ffmpeg), og bed derefter om en film:

```bash
npx skills add openfilm/openfilm
```

> Lav en 20 sekunder lang lanceringsvideo til mit CLI-værktøj, med musik.

### Editorer

Hver editor er en ny måde at arbejde på den samme film, og i dem alle arbejder du og agenten sammen. OpenFilm leveres med fire, og flere officielle editorer er under udvikling til forskellige slags mennesker: enkle nok til, at alle kan gå i gang, og professionelle arbejdsborde til dem, der vil have dem. Editorerne følger Fællesskabets åbne standard, så alle kan bygge en og dele den.

- **Visning**: se filmen i fuld størrelse. Klik på et øjeblik, træk hen over et stykke, eller sæt en ring om en del af billedet, og agenten ved, hvad du peger på.
- **Redigering**: en komplet tidslinje med klip, tekst, undertekster, speak og lyd. Flyt, skalér og skift stil på alt inde i et shot. Eksportér en video, eller tag tidslinjen med over i Final Cut Pro, Premiere Pro eller DaVinci Resolve.
- **Lærred**: en tavle til planlægning, med noter, billeder, klip og stemmer side om side. Generér hver af dem med dine tjenester, og send dem derefter til tidslinjen i rækkefølge.
- **Farve**: farvekorrigér hvert klip med scopes, farvehjul og kurver, ud fra kameraets log-optagelser eller med `.cube`-LUT'er. Det, du ser i forhåndsvisningen, er det, du eksporterer.

Alle fire deler ét bibliotek: dine egne optagelser i mapper, linket i stedet for kopieret og fundet igen, når du flytter dem, side om side med OpenFilms gratis musik, lydeffekter, stemmer og stickers.

### Fællesskab

Fællesskabet er en åben standard for alt, hvad du kan tilføje til OpenFilm, og alle kan bygge til det.

- **Plugins** udvider selve OpenFilm med nye editorer og forbindelser til eksterne tjenester. OpenFilms egne editorer er plugins, bygget på samme måde som alle andres.
- **Færdigheder** lærer agenten en måde at lave en bestemt slags film på.
- **Ressourcer** er musik, lydeffekter, overgange, effekter, tekststile, stickers og skabeloner.
- **Eksempler** er komplette projekter, du kan lære af og remixe.

Hver af dem er en almindelig mappe. Tilføj en fra Fællesskab-vinduet i OpenFilm, eller byg din egen: [lav et plugin](packages/openfilm/plugins/README.md), [skriv en færdighed](https://github.com/openfilm/community/blob/main/SPEC.md), [del ressourcer](https://github.com/openfilm/community/blob/main/assets/CONTRIBUTING.md), eller del en færdig film som eksempel, og opfør den derefter i [openfilm/community](https://github.com/openfilm/community).

### Sådan virker det

En film er en mappe med en `film.html`: spor af klip, stylet med CSS.

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

Hvert shot er en webside, hvis ene funktion, `frame(t)`, tegner ethvert øjeblik med alt, hvad en browser kan tegne (three.js, WebGL, canvas, SVG, CSS, GSAP, video), og altid det samme billede for det samme `t`, så den renderes ens på enhver maskine, agenten kan tjekke hvert eneste billede, og intet framework som Remotion eller HyperFrames er nødvendigt.

```js
window.film = {
  frame(t) { /* tegn hele billedet ved t sekunder */ },
};
```

**Dine ændringer forbliver dine.** Når du ændrer noget inde i et shot i hånden, for eksempel tekst, farve, position eller størrelse, gemmer OpenFilm det i klippets `overrides` i stedet for i sidens kode. Agenten kan skrive siden om, og dine ændringer gælder stadig. Hele formatet står i [SPEC.md](packages/openfilm/SPEC.md).

### Bidrag

Læs [CONTRIBUTING.md](CONTRIBUTING.md) for at køre OpenFilm fra kildekoden eller sende en pull request. Rapportér fejl under [Issues](https://github.com/openfilm/openfilm/issues) med rapporten fra Settings → Developer → Copy report, og sikkerhedsproblemer som beskrevet i [SECURITY.md](SECURITY.md).

### Star History

<a href="https://www.star-history.com/#openfilm/openfilm&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date&theme=dark">
    <img alt="Star History of openfilm/openfilm" src="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date">
  </picture>
</a>
