<p align="center">
  <br>
  <img src="docs/logo-light.svg#gh-light-mode-only" alt="OpenFilm" height="72">
  <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="OpenFilm" height="72">
</p>

<h3 align="center">Açık kaynak yapay zekâ video ajanı.</h3>

<p align="center">Tek bir HTML dosyası, tek bir fonksiyon, gerçek bir editör.</p>

<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a> · <b>Türkçe</b></p>

## Hakkında

OpenFilm, kodlama ajanının video yapmasını, senin de bu videoları düzenlemeni sağlar.

Codex'ten, Claude Code'dan ya da herhangi bir kodlama ajanından bir film yapmasını iste. Ajan filmi web sayfaları olarak
yazar; tarayıcında çalışan yerel bir editör olan Studio da filmin şekillenişini gösterir. Sonra istediğin her şeyi elle ya
da ajandan isteyerek değiştir.

- **Tek bir HTML dosyası.** `film.html`; animasyonlu web sayfalarını, video çekimlerini, resimleri ve sesleri izler (track)
  üzerinde birleştirir ve CSS ile biçimlendirilir. Öğrenecek yeni bir şey yok: ajanın web'i zaten biliyor.
- **Tek bir fonksiyon.** Her çekim, herhangi bir anı `frame(t)` ile çizen bir web sayfasıdır ve tarayıcının çizebildiği her
  şeyi kullanabilir: three.js, WebGL, canvas, SVG, CSS, GSAP, video ve daha fazlası. Framework yok (Remotion veya
  HyperFrames gibi): tek bir fonksiyon yeter.
- **Gerçek bir editör.** Bir sayfanın içindeki herhangi bir öğeyi taşı, ölçekle, döndür; metnini, rengini ve stilini
  değiştir. Her klibi yerleştir, kırp, yeniden biçimlendir; zaman çizelgesinde (timeline) kısalt ve kes.

<p align="center"><img src="docs/openfilm.webp" alt="Bir ajan OpenFilm ile bir film yapıyor; film daha sonra Studio'da elle değiştiriliyor" width="900"><br>
<sub>▶ <a href="https://www.youtube.com/watch?v=Qea7v6dtNM0">1:42'lik tanıtım videosunu izle</a>; baştan sona OpenFilm ile yapıldı.</sub></p>

## Kurulum

macOS, Windows veya Linux'ta Node 22.2+ ve ffmpeg gerekir (Studio'nun kayıtlı sürümleri için git de); ilk çalıştırmada
başsız (headless) bir Chromium indirilir (yaklaşık 100 MB).

```sh
npx skills add openfilm/openfilm
```

Sonra ajanından bir film iste:

> Make a 20-second launch video for my CLI, with music.

Ajan filmi Studio'da açar ve şekillenişini izlersin. Ajanın beceri (skill) desteklemiyorsa ona şunu söyle: "Run
`npx -y openfilm@latest` and follow what it prints."

Ya da macOS veya Windows için masaüstü uygulamasını [openfilm.dev](https://openfilm.dev) adresinden veya
[Releases](https://github.com/openfilm/openfilm/releases) sayfasından indir: yanında sahip olduğun ajanlar için bir sohbet
paneli bulunan Studio. ffmpeg ve başsız tarayıcıyla birlikte gelir, başka bir şey kurman gerekmez.

Film yapmak, düzenlemek ve dışa aktarmak (render) için hesap gerekmez; OpenFilm'in müzik, ses efekti, seslendirme,
çıkartma, geçiş, efekt ve şablon kütüphanesi ücretsizdir. Yapay zekâ ile ses, müzik, resim ve video üretmek için
kullandığın servisleri (ElevenLabs, OpenAI, Google, OpenRouter, fal ve diğerleri) Studio'nun Settings → Services
(Ayarlar → Servisler) bölümünden kendi anahtarlarınla bağla ya da kendi anahtarın olmadan üretmek için orada OpenFilm'e giriş yap.

Bitmiş bir filmden başlamak için [örneklerden](https://github.com/openfilm/examples) birini aç:

```sh
npx -y openfilm@latest open https://github.com/openfilm/examples/tree/main/one-prompt
```

## Komutlar

Bunları ajanın çalıştırır; sen de `npx -y openfilm@latest <komut>` ya da `npm i -g openfilm` ile çalıştırabilirsin.

```sh
openfilm                          # film nedir ve OpenFilm'in kendi becerileri: ajanın başladığı yer
openfilm open   [folder | url]    # bir filmi Studio'da göster: yeni, mevcut, GitHub'dan bir film; yoksa bu ya da sonuncusu
openfilm look   [what] [t | a-b]  # filmi, bir sayfayı veya bir medya dosyasını kontrol et: temas baskısı, tek kare ya da bir aralık
openfilm render [a-b]             # MP4; --4k, --blur (hareket bulanıklığı), --alpha (.webm / .mov), --loudness=-14
openfilm get    [what]            # medya: önce OpenFilm kütüphanesinden ücretsiz, yoksa bağlı bir servisle üretilir
openfilm canvas [apply <steps>]   # düzenlemenin yanındaki tuval: oku ya da notları, dosyaları ve yapılacakları yerleştir
openfilm skills                   # bir filmin yapılabileceği beceriler; `openfilm skill <name>` birini yazdırır
openfilm doctor                   # bu bilgisayarda OpenFilm için neler var; bir issue'ya yapıştırmak için
```

`openfilm <komut> --help` bir komutun seçeneklerini listeler; tek başına `openfilm get` neler üretilebileceğini, kütüphanede
neler olduğunu ve Studio'da bir servisin nasıl bağlanacağını listeler.

## Studio

Studio senin bilgisayarında, tarayıcında çalışır: Chromium tabanlı bir tarayıcı kullan (Chrome, Edge); filmler bu motorla
çizilir ve dışa aktarılır, yani önizleme ne gösteriyorsa dışa aktarılan da odur. Filmdeki her şey değiştirilebilir:
görüntüdeki metin ve katmanlar, zaman çizelgesindeki klipler, bunların konumu, görünümü, ses düzeyi ve hızı, ayrıca
altyazılar. Düzenlemelerin filmin dosyalarına kaydedilir; böylece ajan onları görür ve korur. Geri dönmek için
adlandırılmış sürümler de kaydedebilirsin. Video, GIF, ses veya ses katmanları (stem), altyazı, durağan kareler, slaytlar,
saydam video ya da Final Cut Pro, Premiere Pro ve DaVinci Resolve için zaman çizelgesinin kendisini dışa aktar.

Düzenlemenin yanında tuval (canvas) var (⌘E ikisi arasında geçiş yapar): senin ve ajanın notları, resimleri, klipleri,
dış sesi, müziği ve sesleri yerleştirdiği, onları birbirine bağladığı, her birini servislerinle ürettiği ve ürettiklerini
sırayla zaman çizelgesine gönderdiği bir pano. Bir projede birden fazla tuval olabilir ve her biri bir storyboard olarak da
görülebilir. Varlıklar (assets) çekmecesindeki kütüphane; çekimleri, seslendirmeleri, sesleri, müziği, metinleri,
çıkartmaları, filtreleri, efektleri, geçişleri, şablonları ve becerileri barındırır.

Masaüstü uygulaması ([apps/desktop](apps/desktop)); Claude Code, Codex ve diğer ajanlar ya da kendi anahtarınla çalışan
kendi ajanı için yanında bir sohbet paneli olan Studio'dur.

## Beceriler

Bir filmin nasıl yapılacağı araçta değil, becerilerde (skills) durur. `openfilm` tek bir sayfa yazdırır: film nedir ve
geri kalan her şeyi barındıran OpenFilm'in kendi becerileri: `edit` (proje, film.html ve sayfalar ve bunların kontrolü),
`media` (kütüphane ve servisler) ve `canvas`. Ajan, bir görevin ihtiyaç duyduğu beceriyi `openfilm skill <name>` ile okur.

Diğer her beceri, bir tür film yapmanın bir yoludur ve tam adıyla, `owner/name` biçiminde bilinir. Studio'nun kütüphanesi,
OpenFilm'in ve topluluğun becerilerini Discover (Keşfet) altında [openfilm/skills](https://github.com/openfilm/skills)
reposundan listeler; bu repo beceri yazmayı da anlatır. Oradan bir beceri kur, kurmadan bir sohbette dene ya da kendi
becerini bir bağlantıdan veya klasörden ekle (`openfilm skill add <link>`). Kurulu bir beceri her ajana sunulur.

## Nasıl çalışır

Bir film, içinde `film.html` olan bir klasördür: birlikte kesilmiş kliplerden oluşan izler.

```html
<meta name="viewport" content="width=1920, height=1080">
<style>
  .card { object-fit: cover; border-radius: 24px; }
</style>
<section>
  <iframe src="title.html#t=0,4"></iframe>
</section>
<section>
  <video src="assets/footage.mp4#t=12,18" at="4" speed="0.5" class="card" style="left: 160px; top: 90px; width: 1600px; height: 700px"></video>
</section>
<section>
  <audio src="assets/music.mp3" volume="0.6"></audio>
</section>
```

Her `<section>` bir izdir ve zaman çizelgesindeki sırasıyla durur: ilki en üsttedir. Bir klip bir öğedir: bir sayfa, bir
video, durağan bir resim ya da bir ses. Dosyasının hangi kısmının oynatılacağı bir medya parçasıdır (`#t=12,18`), nerede
başladığı `at`, nerede durduğu stilindeki `left`, `top`, `width` ve `height`, nasıl göründüğü ise CSS'tir. Her ses kendi
başına bir kliptir. `overrides`, bir sayfanın öğelerinde yaptığın değişiklikleri tutar ve ajanlar düzenleme yaparken
bunları korur.

Bir sayfa, kendisinin herhangi bir anını çizen bir web sayfasıdır ve sözleşmenin tamamı budur:

```html
<script type="module">
window.film = {
  frame(t) { /* t saniyedeki görüntünün tamamını, herhangi bir şeyle çiz */ },
  duration: 4,               // isteğe bağlı: kendi uzunluğu, saniye cinsinden
  ready: loadFonts(),        // isteğe bağlı: yazı tipleri, resimler, modeller, veriler için bir Promise
  width: 480, height: 320,   // isteğe bağlı: görüntünün yalnızca bir parçası olan bir sayfa
};
</script>
```

**Tek kural:** aynı `t`, daha önce ne çizilmiş olursa olsun, her zaman aynı görüntüyü çizer. Kareler sırasız, paralel ve
kareler arasında (hareket bulanıklığı için) istenir; bu yüzden kurala uyan bir sayfa her boyutta, her makinede aynı
şekilde render edilir. Görüntü üreten diğer her şey (Python, Blender, bir video modeli) video ya da resim olarak gelir.

OpenFilm emeğini modellerin başarısız olduğu yere harcar: filmi kontrol etmek. `look`, kontrol sayfasının her karesini
iki farklı karışık sırada iki kez çizer ve değişen kareleri; sayfa hatalarını, yüklenemeyen yazı tiplerini, eksik ses
dosyalarını ve kadrajdan taşan metinleri adlarıyla bildirir.

[MANUAL.md](packages/openfilm/MANUAL.md), `openfilm` komutunun yazdırdığı sayfadır ve
[packages/openfilm/manual](packages/openfilm/manual) OpenFilm'in kendi becerilerini barındırır;
[SPEC.md](packages/openfilm/SPEC.md) bir oynatıcı, render motoru ya da editör yapan herkes içindir.

## Kaynaktan

Node 22.18 veya üzeri, pnpm 9 (`corepack enable` bu reponun istediği sürümü verir), PATH üzerinde ffmpeg ve git gerekir.

```sh
git clone https://github.com/openfilm/openfilm && cd openfilm
pnpm install
pnpm dev            # bu checkout'tan Studio, örnek bir filmle, kurulu bir OpenFilm'in yanında
pnpm test
```

Kodlama ajanına `packages/openfilm/.dev/bin/openfilm` çalıştırmasını söyle; ajan senin checkout'unla, o Studio'da film
yapar. Kurulu ya da kaynaktan olsun, her OpenFilm projelerini aynı kütüphanede tutar.

`pnpm dev:desktop` masaüstü uygulamasını kaynaktan çalıştırır; `pnpm typecheck`, `pnpm build` ve `pnpm audit:public`
adlarındaki işi yapar.
Her paketin ayrıntıları [CONTRIBUTING.md](CONTRIBUTING.md) dosyasında.

## Topluluk

Sorular, fikirler ve yaptığın filmler [Discussions](https://github.com/openfilm/openfilm/discussions) bölümüne: Q&A'de
sor, filmini Show and tell'de paylaş. Hatalar Studio'nun Settings → Developer → Copy report (Ayarlar → Geliştirici →
Raporu kopyala) bölümündeki raporla (ya da `npx openfilm doctor`) birlikte [Issues](https://github.com/openfilm/openfilm/issues)'a.

## Katkıda bulunma

Bkz. [CONTRIBUTING.md](CONTRIBUTING.md). Bir güvenlik sorunu bildirmek için [SECURITY.md](SECURITY.md) dosyasına bak.

## Lisans

Format, CLI, Studio ve masaüstü uygulaması [MIT](LICENSE) lisanslıdır. OpenFilm adı ve logosu ticari markadır: bkz.
[TRADEMARK.md](TRADEMARK.md).

## Yıldız geçmişi

<a href="https://www.star-history.com/#openfilm/openfilm&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date&theme=dark">
    <img alt="openfilm/openfilm yıldız geçmişi" src="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date">
  </picture>
</a>
