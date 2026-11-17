<p align="center">
  <a href="https://openfilm.dev">
    <img src="docs/logo-light.svg#gh-light-mode-only" alt="OpenFilm" height="48">
    <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="OpenFilm" height="48">
  </a>
</p>
<p align="center">Agent wideo AI o otwartym kodzie źródłowym.</p>
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

[![OpenFilm: agent tworzy film na twoich oczach, a potem zmieniasz go ręcznie](docs/openfilm.webp)](https://openfilm.dev)

---

### O projekcie

OpenFilm zmienia każdego agenta kodującego w agenta wideo i daje ci edytory, w których zmienisz wszystko, co stworzy.

Ty i agent pracujecie nad tym samym filmem, razem i na żywo. Każdą zmianę agenta widzisz w chwili, gdy się dzieje; każdą twoją zmianę agent też widzi. Agent wykonuje większość pracy; ty wskazujesz cokolwiek i prosisz o zmianę albo wprowadzasz ją sam.

- **Agent robi film.** Użyj Claude Code, Codex, dowolnego innego agenta kodującego albo tego wbudowanego w aplikację desktopową. Znajduje materiały wideo, muzykę i głosy, pisze każde ujęcie i montuje je w całość, a ty patrzysz.
- **Wskaż cokolwiek.** Klip, moment, fragment osi czasu, miejsce w kadrze, linijkę napisów, kartę na płótnie. Wskaż, powiedz, czego chcesz, a agent dokładnie wie, o co ci chodzi.
- **Zmień to ręcznie.** W dowolnym ujęciu przesuwaj, skaluj i obracaj każdy element, zmieniaj jego tekst, kolor, czcionkę i rozmiar oraz animuj go, nawet słowo po słowie. Na osi czasu przycinaj, dziel i przestawiaj klipy, zmieniaj ich prędkość, głośność oraz pojawianie się i zanikanie, kadruj, koryguj kolory i usuwaj tło, a także edytuj napisy i lektora. Twoje zmiany trafiają do tych samych plików, a agent buduje na nich dalej.

### Instalacja

**Aplikacja desktopowa.** [Pobierz ją na macOS lub Windows](https://github.com/openfilm/openfilm/releases/latest). Ma w zestawie wszystko, czego potrzebujesz, łącznie z wbudowanym agentem, i współpracuje z Claude Code lub Codex, jeśli już z nich korzystasz.

**Twój własny agent kodujący.** Dodaj umiejętność (wymaga Node 22.2+ i ffmpeg), a potem poproś o film:

```bash
npx skills add openfilm/openfilm
```

> Zrób 20-sekundowy film premierowy dla mojego CLI, z muzyką.

### Edytory

Każdy edytor to inny sposób pracy nad tym samym filmem, a w każdym z nich pracujesz razem z agentem. OpenFilm ma ich cztery, a kolejne oficjalne edytory powstają z myślą o różnych ludziach: na tyle proste, że każdy od razu sobie poradzi, oraz profesjonalne stanowiska pracy dla tych, którzy ich chcą. Edytory są zgodne z otwartym standardem Społeczności, więc każdy może zbudować własny i się nim podzielić.

- **Projekcja**: oglądaj film w pełnym rozmiarze. Kliknij moment, przeciągnij po fragmencie albo zakreśl część kadru, a agent wie, co wskazujesz.
- **Montaż**: pełna oś czasu z klipami, tekstem, napisami, lektorem i dźwiękiem. Przesuwaj, skaluj i zmieniaj styl wszystkiego wewnątrz ujęcia. Wyeksportuj wideo albo przenieś oś czasu do Final Cut Pro, Premiere Pro lub DaVinci Resolve.
- **Płótno**: tablica do planowania, z notatkami, obrazami, klipami i głosami obok siebie. Wygeneruj każdy z nich za pomocą swoich usług, a potem wyślij je po kolei na oś czasu.
- **Kolor**: koryguj kolory każdego klipu za pomocą wykresów kontrolnych, kół kolorów i krzywych, wychodząc od materiału nagranego w profilu log kamery albo używając LUT-ów `.cube`. To, co widzisz w podglądzie, dostajesz w eksporcie.

Wszystkie cztery korzystają z jednej biblioteki: twoje własne materiały w folderach, podlinkowane zamiast kopiowane i odnajdywane ponownie po przeniesieniu, a obok nich darmowa muzyka, efekty dźwiękowe, głosy i naklejki od OpenFilm.

### Społeczność

Społeczność to otwarty standard dla wszystkiego, co możesz dodać do OpenFilm, i każdy może coś dla niej zbudować.

- **Wtyczki** rozszerzają sam OpenFilm o nowe edytory i połączenia z zewnętrznymi usługami. Własne edytory OpenFilm też są wtyczkami, zbudowanymi tak samo jak wszystkie inne.
- **Umiejętności** uczą agenta, jak robić określony rodzaj filmu.
- **Zasoby** to muzyka, efekty dźwiękowe, przejścia, efekty, style tekstu, naklejki i szablony.
- **Przykłady** to kompletne projekty, z których można się uczyć i które można remiksować.

Każdy z nich to zwykły folder. Dodaj go z okna Społeczność w OpenFilm albo zbuduj własny: [stwórz wtyczkę](packages/openfilm/plugins/README.md), [napisz umiejętność](https://github.com/openfilm/community/blob/main/SPEC.md), [udostępnij zasoby](https://github.com/openfilm/community/blob/main/assets/CONTRIBUTING.md) albo udostępnij gotowy film jako przykład, a potem dodaj go do listy w [openfilm/community](https://github.com/openfilm/community).

### Jak to działa

Film to folder z plikiem `film.html`: ścieżki klipów ostylowane za pomocą CSS.

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

Każde ujęcie to strona internetowa, której jedna funkcja, `frame(t)`, rysuje dowolny moment wszystkim, co potrafi narysować przeglądarka (three.js, WebGL, canvas, SVG, CSS, GSAP, wideo), i zawsze ten sam obraz dla tego samego `t`, więc renderuje się identycznie na każdym komputerze, agent może sprawdzić każdą klatkę, a żaden framework w rodzaju Remotion czy HyperFrames nie jest potrzebny.

```js
window.film = {
  frame(t) { /* narysuj pełny obraz w sekundzie t */ },
};
```

**Twoje zmiany zostają z tobą.** Gdy ręcznie zmienisz coś w ujęciu, na przykład tekst, kolor, położenie lub rozmiar, OpenFilm zapisuje to w `overrides` klipu, a nie w kodzie strony. Agent może przepisać stronę, a twoje zmiany nadal obowiązują. Pełny format opisuje [SPEC.md](packages/openfilm/SPEC.md).

### Współtworzenie

Aby uruchomić OpenFilm ze źródeł lub wysłać pull request, przeczytaj [CONTRIBUTING.md](CONTRIBUTING.md). Błędy zgłaszaj w [Issues](https://github.com/openfilm/openfilm/issues) wraz z raportem z Settings → Developer → Copy report, a problemy z bezpieczeństwem tak, jak opisuje [SECURITY.md](SECURITY.md).

### Star History

<a href="https://www.star-history.com/#openfilm/openfilm&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date&theme=dark">
    <img alt="Star History of openfilm/openfilm" src="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date">
  </picture>
</a>
