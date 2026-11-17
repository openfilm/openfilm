<p align="center">
  <img src="docs/logo-light.svg#gh-light-mode-only" alt="OpenFilm" height="48">
  <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="OpenFilm" height="48">
</p>
<p align="center">L'agente video IA open source.</p>
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

[![OpenFilm: un agente crea un film mentre guardi, poi lo modifichi a mano](docs/openfilm.webp)](https://openfilm.dev)

---

### Informazioni

OpenFilm trasforma qualsiasi agente di programmazione in un agente video, con editor per modificare tutto ciò che crea.

Tu e l'agente lavorate allo stesso film, insieme e in tempo reale. Qualunque cosa cambi l'agente, la vedi mentre succede; qualunque cosa cambi tu, la vede anche l'agente. L'agente fa la maggior parte del lavoro; tu indichi qualsiasi cosa e chiedi una modifica, oppure la fai da te.

- **L'agente crea il film.** Usa Claude Code, Codex, qualsiasi altro agente di programmazione o quello integrato nell'app desktop. Trova filmati, musica e voci, scrive ogni inquadratura e le monta insieme mentre guardi.
- **Indica qualsiasi cosa.** Una clip, un istante, un tratto della timeline, un punto dell'immagine, una riga di sottotitoli, una scheda sulla tela. Indicala, di' cosa vuoi e l'agente sa esattamente a cosa ti riferisci.
- **Modifica a mano.** In qualsiasi inquadratura, sposta, ridimensiona e ruota qualsiasi elemento, riscrivine il testo, cambiane colore, font e dimensione, e animalo, anche parola per parola. Sulla timeline, accorcia, dividi e riordina le clip, cambia velocità, volume e dissolvenze, ritaglia l'immagine, correggi il colore e rimuovi lo sfondo, e modifica sottotitoli e voce fuori campo. Le tue modifiche finiscono negli stessi file e l'agente ci costruisce sopra.

### Installazione

**App desktop.** [Scaricala per macOS o Windows](https://github.com/openfilm/openfilm/releases/latest). Include tutto ciò che ti serve, perfino un agente integrato, e funziona con Claude Code o Codex se li usi già.

**Il tuo agente di programmazione.** Aggiungi la skill (richiede Node 22.2+ e ffmpeg), poi chiedi un film:

```bash
npx skills add openfilm/openfilm
```

> Crea un video di lancio di 20 secondi per la mia CLI, con musica.

### Editor

Ogni editor è un modo diverso di lavorare allo stesso film, e in ognuno tu e l'agente lavorate insieme. OpenFilm ne include quattro, e altri editor ufficiali sono in sviluppo per persone diverse: abbastanza semplici perché chiunque possa iniziare subito, e postazioni di lavoro professionali per chi le vuole. Gli editor seguono lo standard aperto della Community, quindi chiunque può crearne uno e condividerlo.

- **Proiezione**: guarda il film a grandezza piena. Fai clic su un istante, trascina su un tratto o cerchia una parte dell'immagine, e l'agente sa cosa stai indicando.
- **Montaggio**: una timeline completa di clip, testo, sottotitoli, voce fuori campo e audio. Sposta, ridimensiona e cambia lo stile di qualsiasi cosa dentro un'inquadratura. Esporta un video oppure porta la timeline in Final Cut Pro, Premiere Pro o DaVinci Resolve.
- **Tela**: una lavagna per pianificare, con note, immagini, clip e voci fianco a fianco. Genera ciascun elemento con i tuoi servizi, poi mandali in ordine sulla timeline.
- **Colore**: correggi il colore di ogni clip con scope, ruote cromatiche e curve, partendo da filmati log della videocamera o con LUT `.cube`. Quello che vedi in anteprima è esattamente quello che esporti.

Tutti e quattro condividono un'unica libreria: i tuoi filmati organizzati in cartelle, collegati anziché copiati e ritrovati anche quando li sposti, accanto a musica, effetti sonori, voci e sticker gratuiti di OpenFilm.

### Community

La Community è uno standard aperto per tutto ciò che puoi aggiungere a OpenFilm, e chiunque può creare per essa.

- **I plugin** estendono OpenFilm stesso con nuovi editor e connettori verso servizi esterni. Anche gli editor di OpenFilm sono plugin, costruiti come quelli di chiunque altro.
- **Le skill** insegnano all'agente un modo di fare un certo tipo di film.
- **Gli asset** sono musica, effetti sonori, transizioni, effetti, stili di testo, sticker e modelli.
- **Gli esempi** sono progetti completi da cui imparare e da remixare.

Ognuno è una semplice cartella. Aggiungine uno dalla finestra Community di OpenFilm oppure crea il tuo: [crea un plugin](packages/openfilm/plugins/README.md), [scrivi una skill](https://github.com/openfilm/community/blob/main/SPEC.md), [condividi asset](https://github.com/openfilm/community/blob/main/assets/CONTRIBUTING.md) o condividi un film finito come esempio, poi aggiungilo a [openfilm/community](https://github.com/openfilm/community).

### Come funziona

Un film è una cartella con un `film.html`: tracce di clip, con lo stile definito in CSS.

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

Ogni inquadratura è una pagina web la cui unica funzione, `frame(t)`, disegna qualsiasi istante con tutto ciò che un browser sa disegnare (three.js, WebGL, canvas, SVG, CSS, GSAP, video) e sempre la stessa immagine per lo stesso `t`: così il rendering è identico su qualsiasi macchina, l'agente può controllare ogni fotogramma e non serve alcun framework come Remotion o HyperFrames.

```js
window.film = {
  frame(t) { /* disegna l'immagine completa al secondo t */ },
};
```

**Le tue modifiche restano tue.** Quando modifichi a mano qualcosa dentro un'inquadratura, come testo, colore, posizione o dimensione, OpenFilm lo salva negli `overrides` della clip invece che nel codice della pagina. L'agente può riscrivere la pagina e le tue modifiche continuano a valere. Il formato completo è in [SPEC.md](packages/openfilm/SPEC.md).

### Contribuire

Per eseguire OpenFilm dal codice sorgente o inviare una pull request, leggi [CONTRIBUTING.md](CONTRIBUTING.md). Segnala i bug nelle [Issues](https://github.com/openfilm/openfilm/issues) allegando il report da Settings → Developer → Copy report, e i problemi di sicurezza come descritto in [SECURITY.md](SECURITY.md).

### Star History

<a href="https://www.star-history.com/#openfilm/openfilm&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date&theme=dark">
    <img alt="Star History of openfilm/openfilm" src="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date">
  </picture>
</a>
