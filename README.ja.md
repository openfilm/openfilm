<p align="center">
  <a href="https://openfilm.dev">
    <img src="docs/logo-light.svg#gh-light-mode-only" alt="OpenFilm" height="48">
    <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="OpenFilm" height="48">
  </a>
</p>
<p align="center">オープンソースの AI 動画エージェント。</p>
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

[![OpenFilm：エージェントが動画を作るのを見守り、そのあと自分の手で直す](docs/openfilm.webp)](https://openfilm.dev)

---

### 概要

OpenFilm は、どんなコーディングエージェントも動画エージェントに変えます。エージェントが作ったものは、エディターで何でも直せます。

あなたとエージェントは、同じ動画をリアルタイムで一緒に作ります。エージェントが変えたものはその場であなたに見え、あなたが変えたものはエージェントにも見えます。作業の大半はエージェントが担い、あなたは何でも指し示して変更を頼むか、自分で直すだけです。

- **動画はエージェントが作る。** Claude Code、Codex、その他のコーディングエージェント、またはデスクトップ版に内蔵のエージェントを使えます。素材や音楽、声を探し、ショットを一つずつ書いてつなぎ合わせていく様子を、そのまま見ていられます。
- **何でも指し示す。** クリップ、ある瞬間、タイムラインの一区間、画面の一点、字幕の一行、キャンバス上のカード。指して望みを伝えれば、エージェントはどこのことかを正確に理解します。
- **手で直す。** ショットの中のどの要素も、移動・拡大縮小・回転でき、テキストの打ち直し、色・フォント・サイズの変更、アニメーションの追加も、単語単位までできます。タイムラインでは、クリップのトリミング・分割・並べ替え、速度・音量・フェードの調整、クロップ、カラーグレーディング、背景の切り抜き、字幕とナレーションの編集ができます。あなたの編集は同じファイルに保存され、エージェントはその上に作業を重ねます。

### インストール

**デスクトップ版。** [macOS 版または Windows 版をダウンロード](https://github.com/openfilm/openfilm/releases/latest)。必要なものは内蔵エージェントまですべて同梱。Claude Code や Codex をすでに使っているなら、そのまま組み合わせて使えます。

**手持ちのコーディングエージェント。** スキルを追加して（Node 22.2+ と ffmpeg が必要）、動画を頼みましょう。

```bash
npx skills add openfilm/openfilm
```

> 私の CLI のローンチ動画を、音楽付きで 20 秒で作って。

### エディター

どのエディターも同じ動画に取り組むための別々の方法で、どのエディターでもあなたとエージェントが一緒に作業します。OpenFilm には 4 つのエディターが付属し、さまざまな人に向けた公式エディターをさらに開発中です。誰でもすぐ使えるシンプルなものから、望む人のためのプロ向けワークベンチまで。エディターはコミュニティのオープン標準に沿っているので、誰でも作って共有できます。

- **試写**：動画を大きく表示して観ます。ある瞬間をクリックする、一区間をドラッグする、画面の一部を丸で囲む。それだけで、何を指しているのかエージェントに伝わります。
- **編集**：クリップ、テキスト、字幕、ナレーション、サウンドを扱う本格的なタイムライン。ショットの中の何でも移動・拡大縮小・スタイル変更できます。動画として書き出すことも、タイムラインを Final Cut Pro、Premiere Pro、DaVinci Resolve に持っていくこともできます。
- **キャンバス**：メモ、画像、クリップ、声を並べて構想を練るボード。接続したサービスでそれぞれを生成し、順番どおりにタイムラインへ送れます。
- **カラー**：スコープ、カラーホイール、カーブで全クリップをグレーディング。カメラのログ素材にも、`.cube` LUT にも対応します。プレビューしたとおりに書き出されます。

4 つのエディターは 1 つのライブラリを共有します。自分の素材はフォルダで整理され、コピーではなくリンクで扱うので、移動しても見つけ直せます。その隣には、OpenFilm の無料の音楽、効果音、声、ステッカーが並びます。

### コミュニティ

コミュニティは、OpenFilm に追加できるあらゆるもののためのオープン標準で、誰でも作って参加できます。

- **プラグイン**は、新しいエディターや外部サービスとのコネクタで OpenFilm 自体を拡張します。OpenFilm 自身のエディターもプラグインで、ほかの誰のものとも同じ方法で作られています。
- **スキル**は、ある種類の動画の作り方をエージェントに教えます。
- **アセット**は、音楽、効果音、トランジション、エフェクト、テキストスタイル、ステッカー、テンプレートです。
- **サンプル**は、学んだりリミックスしたりできる完成済みのプロジェクトです。

どれもただのフォルダです。OpenFilm のコミュニティウィンドウから追加するか、自分で作りましょう。[プラグインを作る](packages/openfilm/plugins/README.md)、[スキルを書く](https://github.com/openfilm/community/blob/main/SPEC.md)、[アセットを共有する](https://github.com/openfilm/community/blob/main/assets/CONTRIBUTING.md)、または完成した動画をサンプルとして共有し、[openfilm/community](https://github.com/openfilm/community) に登録します。

### 仕組み

動画は `film.html` を含むフォルダです。中身はクリップを並べたトラックで、CSS でスタイルを付けます。

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

各ショットは、ただ 1 つの関数 `frame(t)` で任意の瞬間を描く Web ページで、ブラウザが描けるものなら何でも（three.js、WebGL、canvas、SVG、CSS、GSAP、動画）使え、同じ `t` なら常に同じ絵を描くので、どのマシンでも同じようにレンダリングされ、エージェントは全フレームを確認でき、Remotion や HyperFrames のようなフレームワークも要りません。

```js
window.film = {
  frame(t) { /* t 秒時点の完全な画面を描く */ },
};
```

**あなたの変更は消えません。** テキスト、色、位置、サイズなど、ショットの中を手で変更すると、OpenFilm はそれをページのコードではなくクリップの `overrides` に保存します。エージェントがページを書き直しても、あなたの変更はそのまま適用されます。形式の全容は [SPEC.md](packages/openfilm/SPEC.md) にあります。

### コントリビュート

ソースから OpenFilm を動かしたり、プルリクエストを送ったりするには、[CONTRIBUTING.md](CONTRIBUTING.md) を読んでください。バグは「設定 → 開発者 → レポートをコピー」で得られるレポートを添えて [Issues](https://github.com/openfilm/openfilm/issues) へ、セキュリティの問題は [SECURITY.md](SECURITY.md) の手順で報告してください。

### Star History

<a href="https://www.star-history.com/#openfilm/openfilm&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date&theme=dark">
    <img alt="Star History of openfilm/openfilm" src="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date">
  </picture>
</a>
