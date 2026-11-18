<p align="center">
  <a href="https://openfilm.dev">
    <img src="docs/logo-light.svg#gh-light-mode-only" alt="OpenFilm" height="48">
    <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="OpenFilm" height="48">
  </a>
</p>
<p align="center">L'agent vidéo IA open source.</p>
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

[![OpenFilm : un agent réalise un film sous vos yeux, puis vous le modifiez à la main](docs/openfilm.webp)](https://openfilm.dev)

---

### À propos

OpenFilm transforme n'importe quel agent de code en agent vidéo, avec des éditeurs pour modifier tout ce qu'il crée.

Vous et l'agent travaillez sur le même film, ensemble et en direct. Tout ce que l'agent change, vous le voyez au moment même ; tout ce que vous changez, l'agent le voit aussi. L'agent fait l'essentiel du travail ; vous désignez n'importe quel élément et demandez une modification, ou vous la faites vous-même.

- **L'agent fait le film.** Utilisez Claude Code, Codex, n'importe quel autre agent de code, ou celui intégré à l'application de bureau. Il trouve les images, la musique et les voix, écrit chaque plan et monte le tout sous vos yeux.
- **Désignez n'importe quoi.** Un clip, un instant, une portion de la timeline, un endroit de l'image, une ligne de sous-titres, une carte sur la toile. Désignez-le, dites ce que vous voulez, et l'agent sait exactement de quoi vous parlez.
- **Modifiez à la main.** Dans n'importe quel plan, déplacez, redimensionnez et faites pivoter chaque élément, réécrivez son texte, changez sa couleur, sa police et sa taille, et animez-le, jusqu'au mot près. Sur la timeline, raccourcissez, coupez et réordonnez les clips, changez leur vitesse, leur volume et leurs fondus, recadrez, étalonnez et supprimez l'arrière-plan, et modifiez sous-titres et voix off. Vos modifications vont dans les mêmes fichiers, et l'agent s'appuie dessus.

### Installation

**Application de bureau.** [Téléchargez-la pour macOS ou Windows](https://github.com/openfilm/openfilm/releases/latest). Tout ce dont vous avez besoin est inclus, jusqu'à un agent intégré, et elle fonctionne avec Claude Code ou Codex si vous les utilisez déjà.

**Votre propre agent de code.** Ajoutez le skill (Node 22.2+ et ffmpeg requis), puis demandez un film :

```bash
npx skills add openfilm/openfilm
```

> Crée une vidéo de lancement de 20 secondes pour mon CLI, avec de la musique.

### Éditeurs

Chaque éditeur est une façon différente de travailler sur le même film, et dans chacun, vous travaillez avec l'agent. OpenFilm en propose quatre, et d'autres éditeurs officiels sont en développement pour des profils variés : assez simples pour que chacun s'y mette tout de suite, et des espaces de travail professionnels pour ceux qui le souhaitent. Les éditeurs suivent le standard ouvert de la Communauté, donc n'importe qui peut en créer un et le partager.

- **Projection** : regardez le film en grand. Cliquez sur un instant, faites glisser sur une portion ou entourez une partie de l'image, et l'agent sait ce que vous désignez.
- **Montage** : une timeline complète avec clips, textes, sous-titres, voix off et sons. Déplacez, redimensionnez et restylez tout ce qui se trouve dans un plan. Exportez une vidéo, ou passez la timeline à Final Cut Pro, Premiere Pro ou DaVinci Resolve.
- **Toile** : un tableau pour planifier, avec notes, images, clips et voix côte à côte. Générez chacun avec vos services, puis envoyez-les dans l'ordre sur la timeline.
- **Étalonnage** : étalonnez chaque clip avec des scopes, des roues chromatiques et des courbes, à partir d'images log de caméra ou avec des LUT `.cube`. Ce que vous voyez en aperçu est exactement ce que vous exportez.

Les quatre partagent une même bibliothèque : vos propres médias rangés en dossiers, liés plutôt que copiés et retrouvés même quand vous les déplacez, à côté de la musique, des effets sonores, des voix et des stickers gratuits d'OpenFilm.

### Communauté

La Communauté est un standard ouvert pour tout ce que vous pouvez ajouter à OpenFilm, et tout le monde peut créer pour elle.

- **Les plugins** étendent OpenFilm lui-même avec de nouveaux éditeurs et des connecteurs vers des services externes. Les éditeurs d'OpenFilm sont eux aussi des plugins, construits de la même façon que ceux de n'importe qui.
- **Les skills** apprennent à l'agent une manière de faire un type de film.
- **Les ressources** sont de la musique, des effets sonores, des transitions, des effets, des styles de texte, des stickers et des modèles.
- **Les exemples** sont des projets complets dont on peut s'inspirer et qu'on peut remixer.

Chacun est un simple dossier. Ajoutez-en un depuis la fenêtre Communauté d'OpenFilm, ou créez le vôtre : [créez un plugin](packages/openfilm/plugins/README.md), [écrivez un skill](https://github.com/openfilm/community/blob/main/SPEC.md), [partagez des ressources](https://github.com/openfilm/community/blob/main/assets/CONTRIBUTING.md) ou partagez un film terminé comme exemple, puis référencez-le dans [openfilm/community](https://github.com/openfilm/community).

### Comment ça marche

Un film est un dossier contenant un `film.html` : des pistes de clips, mises en forme en CSS.

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

Chaque plan est une page web dont l'unique fonction, `frame(t)`, dessine n'importe quel instant avec tout ce qu'un navigateur sait dessiner (three.js, WebGL, canvas, SVG, CSS, GSAP, vidéo), et toujours la même image pour le même `t` : le rendu est donc identique sur toutes les machines, l'agent peut vérifier chaque image, et aucun framework comme Remotion ou HyperFrames n'est nécessaire.

```js
window.film = {
  frame(t) { /* dessine l'image complète à t secondes */ },
};
```

**Vos modifications restent les vôtres.** Quand vous modifiez quelque chose à la main dans un plan, comme son texte, sa couleur, sa position ou sa taille, OpenFilm l'enregistre dans les `overrides` du clip plutôt que dans le code de la page. L'agent peut réécrire la page, vos modifications s'appliquent toujours. Le format complet est décrit dans [SPEC.md](packages/openfilm/SPEC.md).

### Contribuer

Pour lancer OpenFilm depuis les sources ou envoyer une pull request, lisez [CONTRIBUTING.md](CONTRIBUTING.md). Signalez les bugs dans les [Issues](https://github.com/openfilm/openfilm/issues) avec le rapport obtenu via Settings → Developer → Copy report, et les problèmes de sécurité comme l'explique [SECURITY.md](SECURITY.md).

### Star History

<a href="https://www.star-history.com/#openfilm/openfilm&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date&theme=dark">
    <img alt="Star History of openfilm/openfilm" src="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date">
  </picture>
</a>
