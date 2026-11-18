<p align="center">
  <img src="docs/logo-light.svg#gh-light-mode-only" alt="OpenFilm" height="48">
  <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="OpenFilm" height="48">
</p>
<p align="center">O agente de vídeo com IA de código aberto.</p>
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

[![OpenFilm: um agente faz um filme enquanto você assiste, depois você muda à mão](docs/openfilm.webp)](https://openfilm.dev)

---

### Sobre

O OpenFilm transforma qualquer agente de programação em um agente de vídeo, com editores para mudar tudo o que ele cria.

Você e o agente trabalham no mesmo filme, juntos e ao vivo. Tudo o que o agente muda, você vê na hora; tudo o que você muda, o agente também vê. O agente faz a maior parte do trabalho; você aponta para qualquer coisa e pede uma mudança, ou faz você mesmo.

- **O agente faz o filme.** Use o Claude Code, o Codex, qualquer outro agente de programação ou o que já vem no app para desktop. Ele encontra imagens, músicas e vozes, escreve cada plano e monta tudo enquanto você assiste.
- **Aponte para qualquer coisa.** Um clipe, um momento, um trecho da linha do tempo, um ponto da imagem, uma linha de legenda, um cartão na tela. Aponte, diga o que quer, e o agente sabe exatamente do que você está falando.
- **Mude à mão.** Dentro de qualquer plano, mova, redimensione e gire qualquer elemento, reescreva o texto, mude a cor, a fonte e o tamanho, e anime, até palavra por palavra. Na linha do tempo, apare, divida e reordene clipes, mude a velocidade, o volume e os fades, recorte a imagem, corrija a cor e remova o fundo, e edite legendas e narração. Suas edições vão para os mesmos arquivos, e o agente continua a partir delas.

### Instalação

**App para desktop.** [Baixe para macOS ou Windows](https://github.com/openfilm/openfilm/releases/latest). Vem com tudo de que você precisa, até um agente embutido, e funciona com o Claude Code ou o Codex se você já usa algum deles.

**Seu próprio agente de programação.** Adicione a skill (requer Node 22.2+ e ffmpeg) e peça um filme:

```bash
npx skills add openfilm/openfilm
```

> Faça um vídeo de lançamento de 20 segundos para minha CLI, com música.

### Editores

Cada editor é um jeito diferente de trabalhar no mesmo filme, e em todos você e o agente trabalham juntos. O OpenFilm vem com quatro, e outros editores oficiais estão em desenvolvimento para diferentes tipos de pessoas: simples o bastante para qualquer um começar na hora, e estações de trabalho profissionais para quem quiser. Os editores seguem o padrão aberto da Comunidade, então qualquer pessoa pode criar um e compartilhar.

- **Exibição**: assista ao filme em tamanho cheio. Clique em um momento, arraste sobre um trecho ou circule parte da imagem, e o agente sabe para o que você está apontando.
- **Edição**: uma linha do tempo completa com clipes, texto, legendas, narração e som. Mova, redimensione e mude o estilo de qualquer coisa dentro de um plano. Exporte um vídeo ou leve a linha do tempo para o Final Cut Pro, o Premiere Pro ou o DaVinci Resolve.
- **Tela**: um quadro para planejar, com notas, imagens, clipes e vozes lado a lado. Gere cada um com os seus serviços e depois envie tudo, em ordem, para a linha do tempo.
- **Cor**: corrija a cor de cada clipe com scopes, rodas de cor e curvas, a partir de material log da câmera ou com LUTs `.cube`. O que você vê na prévia é exatamente o que você exporta.

Os quatro compartilham uma biblioteca: seu próprio material em pastas, vinculado em vez de copiado e reencontrado quando você o move, ao lado das músicas, efeitos sonoros, vozes e figurinhas gratuitos do OpenFilm.

### Comunidade

A Comunidade é um padrão aberto para tudo o que você pode adicionar ao OpenFilm, e qualquer pessoa pode criar para ela.

- **Plugins** estendem o próprio OpenFilm com novos editores e conectores para serviços externos. Os editores do OpenFilm também são plugins, feitos do mesmo jeito que os de qualquer pessoa.
- **Skills** ensinam ao agente um jeito de fazer um tipo de filme.
- **Recursos** são músicas, efeitos sonoros, transições, efeitos, estilos de texto, figurinhas e modelos.
- **Exemplos** são projetos completos para aprender e remixar.

Cada um é uma pasta comum. Adicione um pela janela Comunidade do OpenFilm ou crie o seu: [crie um plugin](packages/openfilm/plugins/README.md), [escreva uma skill](https://github.com/openfilm/community/blob/main/SPEC.md), [compartilhe recursos](https://github.com/openfilm/community/blob/main/assets/CONTRIBUTING.md) ou compartilhe um filme pronto como exemplo, e depois liste em [openfilm/community](https://github.com/openfilm/community).

### Como funciona

Um filme é uma pasta com um `film.html`: faixas de clipes, estilizadas com CSS.

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

Cada plano é uma página web cuja única função, `frame(t)`, desenha qualquer momento com tudo o que um navegador consegue desenhar (three.js, WebGL, canvas, SVG, CSS, GSAP, vídeo) e sempre a mesma imagem para o mesmo `t`; por isso renderiza igual em qualquer máquina, o agente pode conferir cada quadro e nenhum framework como Remotion ou HyperFrames é necessário.

```js
window.film = {
  frame(t) { /* desenha a imagem completa no segundo t */ },
};
```

**Suas mudanças continuam suas.** Quando você muda algo à mão dentro de um plano, como texto, cor, posição ou tamanho, o OpenFilm salva isso nos `overrides` do clipe, e não no código da página. O agente pode reescrever a página e suas mudanças continuam valendo. O formato completo está em [SPEC.md](packages/openfilm/SPEC.md).

### Como contribuir

Para rodar o OpenFilm a partir do código-fonte ou enviar um pull request, leia [CONTRIBUTING.md](CONTRIBUTING.md). Relate bugs nas [Issues](https://github.com/openfilm/openfilm/issues) com o relatório de Settings → Developer → Copy report, e problemas de segurança como descreve o [SECURITY.md](SECURITY.md).

### Star History

<a href="https://www.star-history.com/#openfilm/openfilm&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date&theme=dark">
    <img alt="Star History of openfilm/openfilm" src="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date">
  </picture>
</a>
