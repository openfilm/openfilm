<p align="center">
  <img src="docs/logo-light.svg#gh-light-mode-only" alt="OpenFilm" height="48">
  <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="OpenFilm" height="48">
</p>
<p align="center">开源的 AI 视频智能体。</p>
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
  <a href="https://openfilm.dev"><img alt="访问官网" src="docs/buttons/website.zh-CN.svg" /></a>
  <a href="https://discord.gg/dgk4MtNWFZ"><img alt="Discord 中文社区" src="docs/buttons/discord.zh-CN.svg" /></a>
  <img alt="微信 riverisbuilding，加好友进群" src="docs/buttons/wechat.zh-CN.svg" />
  <a href="https://space.bilibili.com/1229893183"><img alt="B 站" src="docs/buttons/bilibili.zh-CN.svg" /></a>
  <a href="https://www.douyin.com/user/MS4wLjABAAAALPQoqnSDKNMQsR5GNnnx_nwq-rI1MsAyqcZRNuOzKjs"><img alt="抖音" src="docs/buttons/douyin.zh-CN.svg" /></a>
  <a href="https://www.xiaohongshu.com/user/profile/695bfa62000000003700029d"><img alt="小红书" src="docs/buttons/xiaohongshu.zh-CN.svg" /></a>
</p>

[![OpenFilm：智能体做片子，你在旁边看着，再亲手修改](docs/openfilm.webp)](https://openfilm.dev)

---

### 简介

OpenFilm 让任何编程智能体都能做视频，再配上编辑器，它做出的一切你都能改。

你和智能体实时协作，做的是同一部片子：智能体改了什么，你马上就能看到；你改了什么，智能体也能看到。大部分由智能体完成；你可以指着任何东西让它改，也可以自己动手。

- **智能体来做。** 用 Claude Code、Codex、其他编程智能体，或桌面版自带的智能体。它找素材、音乐和配音，写好每个镜头再剪到一起，你在旁边看着片子成形。
- **指着说。** 一个片段、某一刻、时间线上的一段、画面里的一块、一句字幕、画布上的一张卡片。指给它，说你想怎么改，智能体就知道你说的是哪里。
- **亲手改。** 镜头里的任何元素都能移动、缩放、旋转，改文字，改颜色、字体、字号等样式，加动画，连逐字逐词的文字动画也行；时间线上能剪短、分割、调换顺序，改速度、音量和淡入淡出，裁剪画面、调色、抠像，改字幕和配音。你的改动写进同一份文件，智能体会在此基础上接着做。

### 安装

**桌面版。** [下载 macOS 或 Windows 版](https://github.com/openfilm/openfilm/releases/latest)。需要的一切都已经装好，包括内置智能体；你在用 Claude Code 或 Codex 的话，也能直接接上。

**你自己的编程智能体。** 安装技能（需要 Node 22.2+ 和 ffmpeg），然后让它做一部片子：

```bash
npx skills add openfilm/openfilm
```

> 给我的命令行工具做一个 20 秒的发布视频，配上音乐。

### 编辑器

每个编辑器都是处理同一部片子的一种方式，在每一个里都是你和智能体协同工作。OpenFilm 现在自带四个，更多官方编辑器正在开发中，面向不同的人：普通人一上手就会用，专业的人也有自己的专业工作台。编辑器遵循社区的开放标准，任何人都可以开发自己的编辑器并分享出来。

- **放映**：大屏看片。点一个时刻、拖过一段，或在画面上圈出一块，智能体就知道你指的是什么。
- **剪辑**：完整的时间线，放片段、文字、字幕、配音和声音。镜头里的任何东西都能移动、缩放、改样式。导出视频，或把时间线带到 Final Cut Pro、Premiere Pro、DaVinci Resolve。
- **画布**：构思用的白板，笔记、图片、片段、声音并排摆开。用你的服务逐个生成，再按顺序送上时间线。
- **调色**：用示波器、色轮和曲线给每个片段调色，支持相机 Log 素材和 `.cube` LUT。预览什么样，导出就什么样。

四个编辑器共用一个素材库：你自己的素材按文件夹管理，链接而不复制，挪了位置也能找回；旁边是 OpenFilm 免费的音乐、音效、声音和贴纸。

### 社区

社区是一套开放标准，涵盖所有能加进 OpenFilm 的东西，任何人都能为它开发。

- **插件**给 OpenFilm 本身加上新的编辑器，以及连接外部服务的连接器。OpenFilm 自带的编辑器也是插件，和任何人的做法一样。
- **技能**教智能体做某一类片子的方法。
- **素材**包括音乐、音效、转场、特效、文字样式、贴纸和模板。
- **示例**是完整的项目，可以照着学，也可以拿来改。

每一样都是一个普通文件夹。在 OpenFilm 的社区窗口里添加，或者自己做：[做插件](packages/openfilm/plugins/README.md)、[写技能](https://github.com/openfilm/community/blob/main/SPEC.md)、[分享素材](https://github.com/openfilm/community/blob/main/assets/CONTRIBUTING.md)，或把成片作为示例分享，然后提交到 [openfilm/community](https://github.com/openfilm/community)。

### 原理

一部片子是一个带 `film.html` 的文件夹：一条条轨道上的片段，用 CSS 设置样式。

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

每个镜头是一个网页，只靠一个函数 `frame(t)` 画出任意一刻，浏览器能画的都能用（three.js、WebGL、canvas、SVG、CSS、GSAP、视频），同一个 `t` 永远画出同一个画面，所以在任何机器上渲染都一样，智能体也能逐帧检查，不需要 Remotion、HyperFrames 这类框架。

```js
window.film = {
  frame(t) { /* 画出第 t 秒的完整画面 */ },
};
```

**你的改动不会丢。** 你在镜头里亲手改的文字、颜色、位置、大小，OpenFilm 存在片段的 `overrides` 里，不动页面代码。智能体重写页面以后，你的改动照样生效。完整格式见 [SPEC.md](packages/openfilm/SPEC.md)。

### 参与贡献

想从源码运行 OpenFilm 或提交 PR，请先读 [CONTRIBUTING.md](CONTRIBUTING.md)。Bug 提到 [Issues](https://github.com/openfilm/openfilm/issues)，附上 设置 → 开发者 → 复制报告 里的报告；安全问题按 [SECURITY.md](SECURITY.md) 的说明报告。

### Star History

<a href="https://www.star-history.com/#openfilm/openfilm&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date&theme=dark">
    <img alt="Star History of openfilm/openfilm" src="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date">
  </picture>
</a>
