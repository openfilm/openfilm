<p align="center">
  <img src="docs/logo-light.svg#gh-light-mode-only" alt="OpenFilm" height="48">
  <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="OpenFilm" height="48">
</p>
<p align="center">AI video agent otvorenog koda.</p>
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

[![OpenFilm: agent pravi film dok ti gledaš, a onda ga mijenjaš ručno](docs/openfilm.webp)](https://openfilm.dev)

---

### O projektu

OpenFilm pretvara bilo kojeg agenta za kodiranje u video agenta, uz editore u kojima možeš promijeniti sve što on napravi.

Ti i agent radite na istom filmu, zajedno i uživo. Šta god agent promijeni, vidiš dok se dešava; šta god ti promijeniš, vidi i agent. Agent radi većinu posla; ti pokažeš na bilo šta i tražiš izmjenu, ili je napraviš sam.

- **Agent pravi film.** Koristi Claude Code, Codex, bilo kojeg drugog agenta za kodiranje ili onog ugrađenog u desktop aplikaciju. On pronalazi snimke, muziku i glasove, piše svaki kadar i montira ih u cjelinu dok ti gledaš.
- **Pokaži na bilo šta.** Klip, trenutak, dio vremenske linije, mjesto u slici, red titlova, karticu na platnu. Pokaži na to, reci šta želiš i agent tačno zna na šta misliš.
- **Promijeni ručno.** Unutar bilo kojeg kadra pomjeraj, skaliraj i rotiraj bilo koji element, prepiši mu tekst, promijeni boju, font i veličinu i animiraj ga, čak i riječ po riječ. Na vremenskoj liniji skraćuj, dijeli i premještaj klipove, mijenjaj im brzinu, jačinu zvuka i postepeno pojavljivanje i nestajanje, obrezuj sliku, radi korekciju boja i uklanjaj pozadinu, te uređuj titlove i naraciju. Tvoje izmjene završavaju u istim fajlovima, a agent nastavlja graditi na njima.

### Instalacija

**Desktop aplikacija.** [Preuzmi je za macOS ili Windows](https://github.com/openfilm/openfilm/releases/latest). Sve što ti treba dolazi uz nju, sve do ugrađenog agenta, a radi i sa Claude Code ili Codex ako ih već koristiš.

**Tvoj vlastiti agent za kodiranje.** Dodaj vještinu (potrebni su Node 22.2+ i ffmpeg), a onda zatraži film:

```bash
npx skills add openfilm/openfilm
```

> Napravi 20-sekundni video za lansiranje mog CLI alata, s muzikom.

### Editori

Svaki editor je drugačiji način rada na istom filmu, a u svakom od njih ti i agent radite zajedno. OpenFilm dolazi s četiri, a još zvaničnih editora je u razvoju za različite vrste ljudi: dovoljno jednostavni da ih svako odmah savlada, i profesionalni radni stolovi za one koji ih žele. Editori prate otvoreni standard Zajednice, pa svako može napraviti svoj i podijeliti ga.

- **Projekcija**: gledaj film u punoj veličini. Klikni na trenutak, prevuci preko dijela ili zaokruži dio slike i agent zna na šta pokazuješ.
- **Montaža**: potpuna vremenska linija s klipovima, tekstom, titlovima, naracijom i zvukom. Pomjeraj, skaliraj i mijenjaj stil bilo čega unutar kadra. Izvezi video ili prenesi vremensku liniju u Final Cut Pro, Premiere Pro ili DaVinci Resolve.
- **Platno**: tabla za planiranje, s bilješkama, slikama, klipovima i glasovima jedni pored drugih. Generiši svaki od njih svojim servisima, a onda ih redom pošalji na vremensku liniju.
- **Boja**: radi korekciju boja svakog klipa uz skopove, točkove boja i krive, iz log snimaka kamere ili uz `.cube` LUT-ove. Ono što vidiš u pregledu, to i izvoziš.

Sva četiri dijele jednu biblioteku: tvoje vlastite snimke u folderima, povezane umjesto kopirane i ponovo pronađene kad ih premjestiš, uz besplatnu muziku, zvučne efekte, glasove i naljepnice koje daje OpenFilm.

### Zajednica

Zajednica je otvoreni standard za sve što možeš dodati u OpenFilm, i svako može praviti stvari za nju.

- **Dodaci** proširuju sam OpenFilm novim editorima i konektorima za vanjske servise. I editori koje OpenFilm donosi su dodaci, napravljeni na isti način kao i svačiji.
- **Vještine** uče agenta kako da napravi određenu vrstu filma.
- **Materijali** su muzika, zvučni efekti, prijelazi, efekti, stilovi teksta, naljepnice i šabloni.
- **Primjeri** su kompletni projekti iz kojih možeš učiti i koje možeš remiksovati.

Svaki od njih je običan folder. Dodaj ga iz prozora Zajednica u aplikaciji OpenFilm ili napravi svoj: [napravi dodatak](packages/openfilm/plugins/README.md), [napiši vještinu](https://github.com/openfilm/community/blob/main/SPEC.md), [podijeli materijale](https://github.com/openfilm/community/blob/main/assets/CONTRIBUTING.md) ili podijeli gotov film kao primjer, a onda ga navedi u [openfilm/community](https://github.com/openfilm/community).

### Kako radi

Film je folder s fajlom `film.html`: trake klipova, stilizovane pomoću CSS-a.

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

Svaki kadar je web stranica čija jedna funkcija, `frame(t)`, crta bilo koji trenutak bilo čim što browser može nacrtati (three.js, WebGL, canvas, SVG, CSS, GSAP, video), i uvijek istu sliku za isto `t`, pa se renderuje jednako na svakom računaru, agent može provjeriti svaku sličicu, a nije potreban nikakav framework poput Remotion ili HyperFrames.

```js
window.film = {
  frame(t) { /* nacrtaj cijelu sliku u sekundi t */ },
};
```

**Tvoje izmjene ostaju tvoje.** Kad nešto unutar kadra promijeniš ručno, recimo tekst, boju, poziciju ili veličinu, OpenFilm to sprema u `overrides` klipa, a ne u kod stranice. Agent može prepisati stranicu, a tvoje izmjene i dalje važe. Cijeli format je opisan u [SPEC.md](packages/openfilm/SPEC.md).

### Doprinos

Da pokreneš OpenFilm iz izvornog koda ili pošalješ pull request, pročitaj [CONTRIBUTING.md](CONTRIBUTING.md). Greške prijavi u [Issues](https://github.com/openfilm/openfilm/issues) uz izvještaj iz Settings → Developer → Copy report, a sigurnosne probleme onako kako opisuje [SECURITY.md](SECURITY.md).

### Star History

<a href="https://www.star-history.com/#openfilm/openfilm&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date&theme=dark">
    <img alt="Star History of openfilm/openfilm" src="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date">
  </picture>
</a>
