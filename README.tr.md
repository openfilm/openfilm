<p align="center">
  <a href="https://openfilm.dev">
    <img src="docs/logo-light.svg#gh-light-mode-only" alt="OpenFilm" height="48">
    <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="OpenFilm" height="48">
  </a>
</p>
<p align="center">Açık kaynaklı yapay zekâ video ajanı.</p>
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

[![OpenFilm: siz izlerken bir ajan film yapar, sonra siz onu elle değiştirirsiniz](docs/openfilm.webp)](https://openfilm.dev)

---

### Hakkında

OpenFilm her kodlama ajanını bir video ajanına dönüştürür ve onun yaptığı her şeyi değiştirebileceğiniz editörler sunar.

Siz ve ajan aynı film üzerinde, birlikte ve canlı çalışırsınız. Ajan neyi değiştirirse anında görürsünüz; siz neyi değiştirirseniz ajan da görür. İşin çoğunu ajan yapar; siz herhangi bir şeyi gösterip değişiklik istersiniz ya da kendiniz yaparsınız.

- **Filmi ajan yapar.** Claude Code, Codex, başka herhangi bir kodlama ajanı ya da masaüstü uygulamasındaki yerleşik ajanı kullanın. Siz izlerken görüntüleri, müziği ve sesleri bulur, her çekimi yazar ve hepsini kurgular.
- **Herhangi bir şeyi gösterin.** Bir klip, bir an, zaman çizelgesinin bir bölümü, kadrajda bir nokta, bir altyazı satırı, tuvaldeki bir kart. Gösterin, ne istediğinizi söyleyin; ajan tam olarak neyi kastettiğinizi anlar.
- **Elle değiştirin.** Herhangi bir çekimin içinde her öğeyi taşıyın, ölçekleyin ve döndürün, metnini yeniden yazın, rengini, yazı tipini ve boyutunu değiştirin, ona animasyon ekleyin, hatta kelime kelime. Zaman çizelgesinde klipleri kısaltın, bölün ve yeniden sıralayın; hızlarını, ses düzeylerini ve fade'lerini değiştirin, kadrajı kırpın, renk düzenlemesi yapın, arka planı kaldırın, altyazıları ve dış sesi düzenleyin. Düzenlemeleriniz aynı dosyalara yazılır ve ajan onların üzerine devam eder.

### Kurulum

**Masaüstü uygulaması.** [macOS veya Windows için indirin](https://github.com/openfilm/openfilm/releases/latest). İhtiyacınız olan her şey, yerleşik bir ajana kadar, içinde gelir; Claude Code veya Codex kullanıyorsanız onlarla da çalışır.

**Kendi kodlama ajanınız.** Beceriyi ekleyin (Node 22.2+ ve ffmpeg gerekir), ardından bir film isteyin:

```bash
npx skills add openfilm/openfilm
```

> CLI aracım için müzikli, 20 saniyelik bir tanıtım videosu yap.

### Editörler

Her editör aynı film üzerinde çalışmanın farklı bir yoludur ve her birinde siz ve ajan birlikte çalışırsınız. OpenFilm dört editörle gelir; farklı insanlar için daha fazla resmi editör de geliştiriliyor: herkesin hemen kullanabileceği kadar basit olanlar ve isteyenler için profesyonel çalışma alanları. Editörler Topluluğun açık standardını izler, böylece herkes kendi editörünü yapıp paylaşabilir.

- **Gösterim**: filmi tam boyutta izleyin. Bir ana tıklayın, bir bölümün üzerinden sürükleyin ya da kadrajın bir kısmını daire içine alın; ajan neyi gösterdiğinizi bilir.
- **Kurgu**: klipler, metin, altyazılar, dış ses ve ses için eksiksiz bir zaman çizelgesi. Bir çekimin içindeki her şeyi taşıyın, ölçekleyin ve stilini değiştirin. Video dışa aktarın ya da zaman çizelgesini Final Cut Pro, Premiere Pro veya DaVinci Resolve'a taşıyın.
- **Tuval**: notların, görsellerin, kliplerin ve seslerin yan yana durduğu bir planlama panosu. Her birini kendi servislerinizle üretin, sonra sırayla zaman çizelgesine gönderin.
- **Renk**: her klibin rengini skoplar, renk tekerlekleri ve eğrilerle düzenleyin; kameranın log görüntüsünden ya da `.cube` LUT'larıyla. Önizlemede ne görüyorsanız dışa aktardığınız da odur.

Dördü de tek bir kütüphaneyi paylaşır: klasörlerdeki kendi görüntüleriniz kopyalanmak yerine bağlanır ve taşıdığınızda yeniden bulunur; yanında da OpenFilm'in ücretsiz müzikleri, ses efektleri, sesleri ve çıkartmaları durur.

### Topluluk

Topluluk, OpenFilm'e ekleyebileceğiniz her şey için açık bir standarttır ve herkes onun için geliştirebilir.

- **Eklentiler** OpenFilm'in kendisini yeni editörlerle ve dış servislere bağlantılarla genişletir. OpenFilm'in kendi editörleri de eklentidir ve herkesinkiyle aynı şekilde yapılmıştır.
- **Beceriler** ajana bir film türünü yapmanın bir yolunu öğretir.
- **Varlıklar** müzik, ses efektleri, geçişler, efektler, metin stilleri, çıkartmalar ve şablonlardır.
- **Örnekler**, inceleyip öğrenebileceğiniz ve remiksleyebileceğiniz eksiksiz projelerdir.

Her biri sıradan bir klasördür. OpenFilm'deki Topluluk penceresinden ekleyin ya da kendinizinkini yapın: [eklenti yapın](packages/openfilm/plugins/README.md), [beceri yazın](https://github.com/openfilm/community/blob/main/SPEC.md), [varlık paylaşın](https://github.com/openfilm/community/blob/main/assets/CONTRIBUTING.md) ya da bitmiş bir filmi örnek olarak paylaşın, ardından [openfilm/community](https://github.com/openfilm/community) içinde listeleyin.

### Nasıl çalışır

Bir film, `film.html` içeren bir klasördür: CSS ile biçimlendirilmiş klip izleri.

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

Her çekim, tek fonksiyonu `frame(t)` olan bir web sayfasıdır; bu fonksiyon herhangi bir anı tarayıcının çizebildiği her şeyle (three.js, WebGL, canvas, SVG, CSS, GSAP, video) çizer ve aynı `t` için her zaman aynı görüntüyü verir, bu yüzden film her makinede aynı şekilde render edilir, ajan her kareyi kontrol edebilir ve Remotion ya da HyperFrames gibi bir framework'e gerek kalmaz.

```js
window.film = {
  frame(t) { /* t. saniyedeki görüntünün tamamını çiz */ },
};
```

**Değişiklikleriniz sizde kalır.** Bir çekimin içinde metin, renk, konum veya boyut gibi bir şeyi elle değiştirdiğinizde OpenFilm bunu sayfanın kodunda değil, klibin `overrides` alanında saklar. Ajan sayfayı yeniden yazabilir; değişiklikleriniz yine geçerli olur. Biçimin tamamı [SPEC.md](packages/openfilm/SPEC.md) dosyasında.

### Katkıda bulunma

OpenFilm'i kaynak koddan çalıştırmak veya pull request göndermek için [CONTRIBUTING.md](CONTRIBUTING.md) dosyasını okuyun. Hataları Settings → Developer → Copy report ile alınan raporla birlikte [Issues](https://github.com/openfilm/openfilm/issues) bölümüne, güvenlik sorunlarını ise [SECURITY.md](SECURITY.md) dosyasında anlatıldığı gibi bildirin.

### Star History

<a href="https://www.star-history.com/#openfilm/openfilm&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date&theme=dark">
    <img alt="Star History of openfilm/openfilm" src="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date">
  </picture>
</a>
