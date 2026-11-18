<p align="center">
  <a href="https://openfilm.dev">
    <img src="docs/logo-light.svg#gh-light-mode-only" alt="OpenFilm" height="48">
    <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="OpenFilm" height="48">
  </a>
</p>
<p align="center">開源的 AI 影片代理。</p>
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
  <a href="https://openfilm.dev"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/-前往官網-f0f0f0?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjEwIDggODAgODgiPjxtYXNrIGlkPSJnIiBtYXNrVW5pdHM9InVzZXJTcGFjZU9uVXNlIiB4PSIwIiB5PSIwIiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIGZpbGw9IiNmZmYiLz48cGF0aCBkPSJNMTcgMTJIMzdRNDAgMTIgNDAgMTVWMjdRNDAgMjkgMzguNSAzMC41TDMxIDM3Vjg4UTMxIDkyIDI3IDkyUTIzIDkyIDIzIDg4VjM3TDE1LjUgMzAuNVExNCAyOSAxNCAyN1YxNVExNCAxMiAxNyAxMloiIHN0cm9rZT0iIzAwMCIgc3Ryb2tlLXdpZHRoPSI3IiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PC9tYXNrPjxnIGZpbGw9IiMxMTEiIG1hc2s9InVybCgjZykiPjxyZWN0IHg9IjIyIiB5PSIxMiIgd2lkdGg9IjY0IiBoZWlnaHQ9IjIwIiByeD0iNSIvPjxyZWN0IHg9IjI1IiB5PSI0NCIgd2lkdGg9IjQ3IiBoZWlnaHQ9IjE5IiByeD0iNSIvPjwvZz48cGF0aCBmaWxsPSIjMTExIiBkPSJNMTcgMTJIMzdRNDAgMTIgNDAgMTVWMjdRNDAgMjkgMzguNSAzMC41TDMxIDM3Vjg4UTMxIDkyIDI3IDkyUTIzIDkyIDIzIDg4VjM3TDE1LjUgMzAuNVExNCAyOSAxNCAyN1YxNVExNCAxMiAxNyAxMloiLz48L3N2Zz4K&logoColor=111111"><img alt="前往官網" src="https://img.shields.io/badge/-前往官網-111111?style=for-the-badge&logo=data:image/svg%2bxml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjEwIDggODAgODgiPjxtYXNrIGlkPSJnIiBtYXNrVW5pdHM9InVzZXJTcGFjZU9uVXNlIiB4PSIwIiB5PSIwIiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIGZpbGw9IiNmZmYiLz48cGF0aCBkPSJNMTcgMTJIMzdRNDAgMTIgNDAgMTVWMjdRNDAgMjkgMzguNSAzMC41TDMxIDM3Vjg4UTMxIDkyIDI3IDkyUTIzIDkyIDIzIDg4VjM3TDE1LjUgMzAuNVExNCAyOSAxNCAyN1YxNVExNCAxMiAxNyAxMloiIHN0cm9rZT0iIzAwMCIgc3Ryb2tlLXdpZHRoPSI3IiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PC9tYXNrPjxnIGZpbGw9IiNmZmYiIG1hc2s9InVybCgjZykiPjxyZWN0IHg9IjIyIiB5PSIxMiIgd2lkdGg9IjY0IiBoZWlnaHQ9IjIwIiByeD0iNSIvPjxyZWN0IHg9IjI1IiB5PSI0NCIgd2lkdGg9IjQ3IiBoZWlnaHQ9IjE5IiByeD0iNSIvPjwvZz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMTcgMTJIMzdRNDAgMTIgNDAgMTVWMjdRNDAgMjkgMzguNSAzMC41TDMxIDM3Vjg4UTMxIDkyIDI3IDkyUTIzIDkyIDIzIDg4VjM3TDE1LjUgMzAuNVExNCAyOSAxNCAyN1YxNVExNCAxMiAxNyAxMloiLz48L3N2Zz4K&logoColor=white"></picture></a>
  <a href="https://discord.gg/dgk4MtNWFZ"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/-DISCORD_中文社群-f0f0f0?style=for-the-badge&logo=discord&logoColor=111111"><img alt="Discord 中文社群" src="https://img.shields.io/badge/-DISCORD_中文社群-111111?style=for-the-badge&logo=discord&logoColor=white"></picture></a>
  <a href="https://www.youtube.com/@riverisbuilding"><picture><source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/-在_YOUTUBE_觀看-f0f0f0?style=for-the-badge&logo=youtube&logoColor=111111"><img alt="在 YouTube 觀看" src="https://img.shields.io/badge/-在_YOUTUBE_觀看-111111?style=for-the-badge&logo=youtube&logoColor=white"></picture></a>
</p>

[![OpenFilm：代理做片子，你在旁邊看著，再親手修改](docs/openfilm.webp)](https://openfilm.dev)

---

### 簡介

OpenFilm 讓任何程式設計代理都能做影片，再配上編輯器，它做出的一切你都能改。

你和代理即時協作，做的是同一部片子：代理改了什麼，你馬上就能看到；你改了什麼，代理也看得到。大部分由代理完成；你可以指著任何東西請它改，也可以自己動手。

- **代理來做。** 用 Claude Code、Codex、其他程式設計代理，或桌面版內建的代理。它會找素材、音樂和配音，寫好每個鏡頭再剪在一起，你在旁邊看著片子成形。
- **指著說。** 一個片段、某一刻、時間軸上的一段、畫面裡的一塊、一句字幕、畫布上的一張卡片。指給它，說你想怎麼改，代理就知道你說的是哪裡。
- **親手改。** 鏡頭裡的任何元素都能移動、縮放、旋轉，改文字，改顏色、字型、字級等樣式，加動畫，連逐字逐詞的文字動畫也行；時間軸上能剪短、分割、調換順序，改速度、音量和淡入淡出，裁切畫面、調色、去背，改字幕和配音。你的改動寫進同一份檔案，代理會在此基礎上接著做。

### 安裝

**桌面版。** [下載 macOS 或 Windows 版](https://github.com/openfilm/openfilm/releases/latest)。需要的一切都已經裝好，包括內建代理；你在用 Claude Code 或 Codex 的話，也能直接接上。

**你自己的程式設計代理。** 安裝技能（需要 Node 22.2+ 和 ffmpeg），然後請它做一部片子：

```bash
npx skills add openfilm/openfilm
```

> 幫我的命令列工具做一支 20 秒的發表影片，配上音樂。

### 編輯器

每個編輯器都是處理同一部片子的一種方式，在每一個裡都是你和代理協同工作。OpenFilm 目前內建四個，更多官方編輯器正在開發中，面向不同的人：一般人一上手就會用，專業的人也有自己的專業工作台。編輯器遵循社群的開放標準，任何人都可以開發自己的編輯器並分享出來。

- **放映**：大螢幕看片。點一個時刻、拖過一段，或在畫面上圈出一塊，代理就知道你指的是什麼。
- **剪輯**：完整的時間軸，放片段、文字、字幕、配音和聲音。鏡頭裡的任何東西都能移動、縮放、改樣式。匯出影片，或把時間軸帶到 Final Cut Pro、Premiere Pro、DaVinci Resolve。
- **畫布**：構思用的白板，筆記、圖片、片段、聲音並排擺開。用你的服務逐一生成，再依序送上時間軸。
- **調色**：用示波器、色輪和曲線替每個片段調色，支援相機 Log 素材和 `.cube` LUT。預覽是什麼樣子，匯出就是什麼樣子。

四個編輯器共用一個素材庫：你自己的素材依資料夾管理，連結而不複製，搬了位置也找得回來；旁邊是 OpenFilm 免費的音樂、音效、聲音和貼圖。

### 社群

社群是一套開放標準，涵蓋所有能加進 OpenFilm 的東西，任何人都能為它開發。

- **外掛**為 OpenFilm 本身加上新的編輯器，以及連接外部服務的連接器。OpenFilm 內建的編輯器也是外掛，和任何人的做法一樣。
- **技能**教代理做某一類片子的方法。
- **素材**包括音樂、音效、轉場、特效、文字樣式、貼圖和範本。
- **範例**是完整的專案，可以照著學，也可以拿來改。

每一樣都是一個普通資料夾。在 OpenFilm 的社群視窗裡加入，或者自己做：[做外掛](packages/openfilm/plugins/README.md)、[寫技能](https://github.com/openfilm/community/blob/main/SPEC.md)、[分享素材](https://github.com/openfilm/community/blob/main/assets/CONTRIBUTING.md)，或把成片當作範例分享，然後提交到 [openfilm/community](https://github.com/openfilm/community)。

### 原理

一部片子是一個帶有 `film.html` 的資料夾：一條條軌道上的片段，用 CSS 設定樣式。

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

每個鏡頭是一個網頁，只靠一個函式 `frame(t)` 畫出任意一刻，瀏覽器能畫的都能用（three.js、WebGL、canvas、SVG、CSS、GSAP、影片），同一個 `t` 永遠畫出同一個畫面，所以在任何機器上算繪結果都一樣，代理也能逐格檢查，不需要 Remotion、HyperFrames 這類框架。

```js
window.film = {
  frame(t) { /* 畫出第 t 秒的完整畫面 */ },
};
```

**你的改動不會遺失。** 你在鏡頭裡親手改的文字、顏色、位置、大小，OpenFilm 存在片段的 `overrides` 裡，不動網頁程式碼。代理重寫網頁之後，你的改動照樣生效。完整格式見 [SPEC.md](packages/openfilm/SPEC.md)。

### 參與貢獻

想從原始碼執行 OpenFilm 或提交 PR，請先讀 [CONTRIBUTING.md](CONTRIBUTING.md)。Bug 請回報到 [Issues](https://github.com/openfilm/openfilm/issues)，附上 Settings → Developer → Copy report 裡的報告；安全問題請依 [SECURITY.md](SECURITY.md) 的說明回報。

### Star History

<a href="https://www.star-history.com/#openfilm/openfilm&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date&theme=dark">
    <img alt="Star History of openfilm/openfilm" src="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date">
  </picture>
</a>
