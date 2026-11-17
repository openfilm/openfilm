<p align="center">
  <a href="https://openfilm.dev">
    <img src="docs/logo-light.svg#gh-light-mode-only" alt="OpenFilm" height="48">
    <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="OpenFilm" height="48">
  </a>
</p>
<p align="center">وكيل فيديو بالذكاء الاصطناعي، مفتوح المصدر.</p>
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

[![OpenFilm: وكيل يصنع فيلمًا أمام عينيك، ثم تعدّله بيدك](docs/openfilm.webp)](https://openfilm.dev)

---

### نبذة

يحوّل OpenFilm أي وكيل برمجة إلى وكيل فيديو، مع محرّرات تتيح لك تغيير أي شيء يصنعه.

تعمل أنت والوكيل على الفيلم نفسه، معًا وفي الوقت الفعلي. كل ما يغيّره الوكيل تراه لحظة حدوثه، وكل ما تغيّره أنت يراه الوكيل أيضًا. يتولّى الوكيل معظم العمل، وأنت تشير إلى أي شيء وتطلب تغييره، أو تغيّره بنفسك.

- **الوكيل يصنع الفيلم.** استخدم Claude Code أو Codex أو أي وكيل برمجة آخر، أو الوكيل المدمج في تطبيق سطح المكتب. يجد المقاطع المصوّرة والموسيقى والأصوات، ويكتب كل لقطة ثم يجمعها في مونتاج واحد وأنت تشاهد.
- **أشِر إلى أي شيء.** مقطع، أو لحظة، أو جزء من الخط الزمني، أو موضع في الكادر، أو سطر من الترجمة النصية، أو بطاقة على اللوحة. أشِر إليه وقل ما تريد، وسيعرف الوكيل بالضبط ما تقصده.
- **عدّله بيدك.** داخل أي لقطة، حرّك أي عنصر وكبّره أو صغّره وأدِره، وأعد كتابة نصه، وغيّر لونه وخطه ومقاسه، وأضف إليه حركة، حتى كلمةً كلمة. وعلى الخط الزمني، قصّر المقاطع وقسّمها وأعد ترتيبها، وغيّر سرعتها ومستوى صوتها والظهور والتلاشي التدريجي فيها، واقتطع الكادر، وصحّح الألوان، وأزِل الخلفية، وحرّر الترجمة النصية والتعليق الصوتي. تُحفظ تعديلاتك في الملفات نفسها، ويواصل الوكيل البناء عليها.

### التثبيت

**تطبيق سطح المكتب.** [نزّله لنظام macOS أو Windows](https://github.com/openfilm/openfilm/releases/latest). يأتي ومعه كل ما تحتاجه، حتى وكيل مدمج، ويعمل مع Claude Code أو Codex إن كنت تستخدمهما بالفعل.

**وكيل البرمجة الخاص بك.** أضِف المهارة (تتطلب Node 22.2+ و ffmpeg)، ثم اطلب فيلمًا:

```bash
npx skills add openfilm/openfilm
```

> اصنع فيديو إطلاق مدته 20 ثانية لأداة سطر الأوامر الخاصة بي، مع موسيقى.

### المحرّرات

كل محرّر طريقة مختلفة للعمل على الفيلم نفسه، وفي كل واحد منها تعمل أنت والوكيل معًا. يأتي OpenFilm بأربعة محرّرات، ومحرّرات رسمية أخرى قيد التطوير لفئات مختلفة من الناس: بسيطة بما يكفي ليبدأ بها أي أحد، ومساحات عمل احترافية لمن يريدها. تتبع المحرّرات المعيار المفتوح للمجتمع، لذا يستطيع أي أحد أن يبني محرّرًا ويشاركه.

- **العرض**: شاهد الفيلم بالحجم الكامل. انقر على لحظة، أو اسحب عبر جزء منه، أو ارسم دائرة حول جزء من الكادر، وسيعرف الوكيل إلى ماذا تشير.
- **المونتاج**: خط زمني كامل للمقاطع والنصوص والترجمة النصية والتعليق الصوتي والصوت. حرّك أي شيء داخل اللقطة وغيّر حجمه وتنسيقه. صدّر فيديو، أو انقل الخط الزمني إلى Final Cut Pro أو Premiere Pro أو DaVinci Resolve.
- **اللوحة**: مساحة للتخطيط تضع الملاحظات والصور والمقاطع والأصوات جنبًا إلى جنب. أنشئ كلًّا منها بخدماتك، ثم أرسلها إلى الخط الزمني بالترتيب.
- **الألوان**: صحّح ألوان كل مقطع بأدوات القياس (scopes) وعجلات الألوان والمنحنيات، انطلاقًا من لقطات log من الكاميرا أو باستخدام ملفات LUT بصيغة `.cube`. ما تراه في المعاينة هو ما تصدّره.

تتشارك المحرّرات الأربعة مكتبة واحدة: لقطاتك الخاصة في مجلدات، مرتبطة لا منسوخة، ويُعثر عليها من جديد حين تنقلها، إلى جانب موسيقى OpenFilm المجانية ومؤثراته الصوتية وأصواته وملصقاته.

### المجتمع

المجتمع معيار مفتوح لكل ما يمكنك إضافته إلى OpenFilm، ويستطيع أي أحد أن يبني له.

- **الإضافات** توسّع OpenFilm نفسه بمحرّرات جديدة وموصِّلات بخدمات خارجية. ومحرّرات OpenFilm نفسها إضافات أيضًا، مبنية بالطريقة نفسها التي يبني بها أي أحد.
- **المهارات** تعلّم الوكيل طريقةً لصنع نوع معيّن من الأفلام.
- **الموارد** هي الموسيقى والمؤثرات الصوتية والانتقالات والمؤثرات وأنماط النصوص والملصقات والقوالب.
- **الأمثلة** مشاريع كاملة تتعلّم منها وتعيد مزجها.

كلٌّ منها مجلد عادي. أضِف واحدًا من نافذة المجتمع في OpenFilm، أو اصنع خاصتك: [اصنع إضافة](packages/openfilm/plugins/README.md)، [اكتب مهارة](https://github.com/openfilm/community/blob/main/SPEC.md)، [شارك موارد](https://github.com/openfilm/community/blob/main/assets/CONTRIBUTING.md)، أو شارك فيلمًا مكتملًا كمثال، ثم أدرجه في [openfilm/community](https://github.com/openfilm/community).

### كيف يعمل

الفيلم مجلد فيه `film.html`: مسارات من المقاطع، منسّقة بـ CSS.

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

كل لقطة صفحة ويب لها دالة واحدة، `frame(t)`، ترسم أي لحظة بأي شيء يستطيع المتصفح رسمه (three.js، WebGL، canvas، SVG، CSS، GSAP، الفيديو) وتعطي دائمًا الصورة نفسها لقيمة `t` نفسها، لذلك يُصدَّر الفيلم بالشكل نفسه على أي جهاز، ويستطيع الوكيل فحص كل إطار، ولا حاجة إلى إطار عمل مثل Remotion أو HyperFrames.

```js
window.film = {
  frame(t) { /* ارسم الصورة الكاملة عند الثانية t */ },
};
```

**تعديلاتك تبقى لك.** عندما تغيّر بيدك شيئًا داخل لقطة، مثل نصّه أو لونه أو موضعه أو حجمه، يحفظه OpenFilm في `overrides` الخاصة بالمقطع بدلًا من شيفرة الصفحة. يمكن للوكيل أن يعيد كتابة الصفحة وتبقى تعديلاتك سارية. الصيغة الكاملة في [SPEC.md](packages/openfilm/SPEC.md).

### المساهمة

لتشغيل OpenFilm من الشيفرة المصدرية أو إرسال pull request، اقرأ [CONTRIBUTING.md](CONTRIBUTING.md). أبلِغ عن الأخطاء في [Issues](https://github.com/openfilm/openfilm/issues) مرفقًا التقرير من Settings → Developer → Copy report، وعن المشكلات الأمنية كما يوضّح [SECURITY.md](SECURITY.md).

### Star History

<a href="https://www.star-history.com/#openfilm/openfilm&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date&theme=dark">
    <img alt="Star History of openfilm/openfilm" src="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date">
  </picture>
</a>
