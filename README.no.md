<p align="center">
  <img src="docs/logo-light.svg#gh-light-mode-only" alt="OpenFilm" height="48">
  <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="OpenFilm" height="48">
</p>
<p align="center">AI-videoagenten med åpen kildekode.</p>
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

[![OpenFilm: en agent lager en film mens du ser på, og så endrer du den for hånd](docs/openfilm.webp)](https://openfilm.dev)

---

### Om

OpenFilm gjør enhver kodeagent til en videoagent, med editorer der du kan endre alt den lager.

Du og agenten jobber med den samme filmen, sammen og i sanntid. Alt agenten endrer, ser du mens det skjer; alt du endrer, ser agenten også. Agenten gjør det meste av jobben; du peker på hva som helst og ber om en endring, eller gjør den selv.

- **Agenten lager filmen.** Bruk Claude Code, Codex, en hvilken som helst annen kodeagent eller den som er innebygd i skrivebordsappen. Den finner opptak, musikk og stemmer, skriver hvert shot og klipper dem sammen mens du ser på.
- **Pek på hva som helst.** Et klipp, et øyeblikk, et stykke av tidslinjen, et sted i bildet, en undertekstlinje, et kort på lerretet. Pek på det, si hva du vil, og agenten vet nøyaktig hva du mener.
- **Endre det for hånd.** Inne i et hvilket som helst shot kan du flytte, skalere og rotere ethvert element, skrive om teksten, endre farge, skrift og størrelse og animere det, helt ned til ord for ord. På tidslinjen kan du trimme, dele og omorganisere klipp, endre hastighet, volum og inn- og uttoning, beskjære, fargekorrigere og fjerne bakgrunnen, og redigere undertekster og voiceover. Endringene dine havner i de samme filene, og agenten bygger videre på dem.

### Installasjon

**Skrivebordsapp.** [Last den ned for macOS eller Windows](https://github.com/openfilm/openfilm/releases/latest). Alt du trenger følger med, helt ned til en innebygd agent, og den fungerer med Claude Code eller Codex hvis du allerede bruker dem.

**Din egen kodeagent.** Legg til ferdigheten (krever Node 22.2+ og ffmpeg), og be så om en film:

```bash
npx skills add openfilm/openfilm
```

> Lag en 20 sekunder lang lanseringsvideo for CLI-verktøyet mitt, med musikk.

### Editorer

Hver editor er en egen måte å jobbe med den samme filmen på, og i alle jobber du og agenten sammen. OpenFilm leveres med fire, og flere offisielle editorer er under utvikling for ulike typer mennesker: enkle nok til at hvem som helst kan ta dem i bruk, og profesjonelle arbeidsbenker for dem som vil ha det. Editorene følger Fellesskapets åpne standard, så hvem som helst kan lage en og dele den.

- **Visning**: se filmen i full størrelse. Klikk på et øyeblikk, dra over et stykke eller ring inn en del av bildet, og agenten vet hva du peker på.
- **Redigering**: en komplett tidslinje med klipp, tekst, undertekster, voiceover og lyd. Flytt, skaler og endre stilen på alt inne i et shot. Eksporter en video, eller ta med tidslinjen til Final Cut Pro, Premiere Pro eller DaVinci Resolve.
- **Lerret**: en tavle for planlegging, med notater, bilder, klipp og stemmer side om side. Generer hver av dem med tjenestene dine, og send dem så til tidslinjen i rekkefølge.
- **Farge**: fargekorriger hvert klipp med scopes, fargehjul og kurver, fra kameraets log-opptak eller med `.cube`-LUT-er. Det du ser i forhåndsvisningen, er det du eksporterer.

Alle fire deler ett bibliotek: dine egne opptak i mapper, lenket i stedet for kopiert og funnet igjen når du flytter dem, side om side med OpenFilms gratis musikk, lydeffekter, stemmer og klistremerker.

### Fellesskap

Fellesskapet er en åpen standard for alt du kan legge til i OpenFilm, og hvem som helst kan bygge for det.

- **Plugins** utvider selve OpenFilm med nye editorer og koblinger til eksterne tjenester. OpenFilms egne editorer er plugins, bygget på samme måte som alle andres.
- **Ferdigheter** lærer agenten en måte å lage en bestemt type film på.
- **Ressurser** er musikk, lydeffekter, overganger, effekter, tekststiler, klistremerker og maler.
- **Eksempler** er komplette prosjekter du kan lære av og remikse.

Hver av dem er en vanlig mappe. Legg til en fra Fellesskap-vinduet i OpenFilm, eller lag din egen: [lag en plugin](packages/openfilm/plugins/README.md), [skriv en ferdighet](https://github.com/openfilm/community/blob/main/SPEC.md), [del ressurser](https://github.com/openfilm/community/blob/main/assets/CONTRIBUTING.md), eller del en ferdig film som eksempel, og før den så opp i [openfilm/community](https://github.com/openfilm/community).

### Slik fungerer det

En film er en mappe med en `film.html`: spor med klipp, stylet med CSS.

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

Hvert shot er en nettside der én funksjon, `frame(t)`, tegner et hvilket som helst øyeblikk med alt en nettleser kan tegne (three.js, WebGL, canvas, SVG, CSS, GSAP, video), og alltid det samme bildet for den samme `t`, så det rendres likt på enhver maskin, agenten kan sjekke hvert eneste bilde, og ingen rammeverk som Remotion eller HyperFrames trengs.

```js
window.film = {
  frame(t) { /* tegn hele bildet ved t sekunder */ },
};
```

**Endringene dine forblir dine.** Når du endrer noe inne i et shot for hånd, for eksempel tekst, farge, posisjon eller størrelse, lagrer OpenFilm det i klippets `overrides` i stedet for i sidens kode. Agenten kan skrive om siden, og endringene dine gjelder fortsatt. Hele formatet står i [SPEC.md](packages/openfilm/SPEC.md).

### Bidra

For å kjøre OpenFilm fra kildekoden eller sende en pull request, les [CONTRIBUTING.md](CONTRIBUTING.md). Rapporter feil i [Issues](https://github.com/openfilm/openfilm/issues) med rapporten fra Settings → Developer → Copy report, og sikkerhetsproblemer slik [SECURITY.md](SECURITY.md) beskriver.

### Star History

<a href="https://www.star-history.com/#openfilm/openfilm&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date&theme=dark">
    <img alt="Star History of openfilm/openfilm" src="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date">
  </picture>
</a>
