<p align="center">
  <a href="https://openfilm.dev">
    <img src="docs/logo-light.svg#gh-light-mode-only" alt="OpenFilm" height="48">
    <img src="docs/logo-dark.svg#gh-dark-mode-only" alt="OpenFilm" height="48">
  </a>
</p>
<p align="center">Agent video AI mã nguồn mở.</p>
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

[![OpenFilm: agent làm video ngay trước mắt bạn, rồi bạn tự tay chỉnh sửa](docs/openfilm.webp)](https://openfilm.dev)

---

### Giới thiệu

OpenFilm biến bất kỳ coding agent nào thành một video agent, kèm các trình chỉnh sửa để bạn thay đổi mọi thứ nó làm ra.

Bạn và agent cùng làm trên một video, cùng lúc và theo thời gian thực. Agent thay đổi gì, bạn thấy ngay khi nó diễn ra; bạn thay đổi gì, agent cũng thấy. Agent làm phần lớn công việc; bạn chỉ vào bất cứ thứ gì để yêu cầu sửa, hoặc tự tay sửa.

- **Agent làm video.** Dùng Claude Code, Codex, bất kỳ coding agent nào khác, hoặc agent có sẵn trong ứng dụng desktop. Nó tìm tư liệu video, nhạc và giọng đọc, viết từng cảnh rồi dựng chúng lại với nhau ngay trước mắt bạn.
- **Chỉ vào bất cứ thứ gì.** Một clip, một khoảnh khắc, một đoạn trên timeline, một điểm trong khung hình, một dòng phụ đề, một thẻ trên canvas. Chỉ vào đó, nói điều bạn muốn, và agent biết chính xác bạn đang nói đến cái gì.
- **Tự tay chỉnh sửa.** Trong bất kỳ cảnh nào, bạn có thể di chuyển, thu phóng và xoay mọi phần tử, gõ lại chữ, đổi màu, phông chữ và cỡ chữ, và tạo chuyển động, thậm chí theo từng chữ. Trên timeline, bạn có thể cắt gọn, tách và sắp xếp lại clip, chỉnh tốc độ, âm lượng và fade, cắt khung, chỉnh màu và tách nền, cũng như sửa phụ đề và lời thuyết minh. Những gì bạn sửa được lưu vào chính các tệp đó, và agent tiếp tục làm trên nền những thay đổi ấy.

### Cài đặt

**Ứng dụng desktop.** [Tải về cho macOS hoặc Windows](https://github.com/openfilm/openfilm/releases/latest). Mọi thứ bạn cần đều có sẵn, kể cả một agent tích hợp, và nếu bạn đang dùng Claude Code hoặc Codex thì ứng dụng cũng dùng được với chúng.

**Coding agent của riêng bạn.** Thêm skill (cần Node 22.2+ và ffmpeg), rồi nhờ agent làm một video:

```bash
npx skills add openfilm/openfilm
```

> Làm một video ra mắt dài 20 giây cho CLI của tôi, có nhạc nền.

### Trình chỉnh sửa

Mỗi trình chỉnh sửa là một cách khác nhau để làm việc trên cùng một video, và ở trình nào bạn cũng làm cùng agent. OpenFilm đi kèm bốn trình chỉnh sửa, và nhiều trình chỉnh sửa chính thức khác đang được phát triển cho nhiều kiểu người dùng: từ loại đơn giản ai cũng dùng được ngay, đến các bàn làm việc chuyên nghiệp cho những ai cần. Các trình chỉnh sửa tuân theo tiêu chuẩn mở của Cộng đồng, nên ai cũng có thể tự làm và chia sẻ.

- **Trình chiếu**: xem video ở kích thước đầy đủ. Bấm vào một khoảnh khắc, kéo qua một đoạn hoặc khoanh một vùng trong khung hình, và agent biết bạn đang chỉ vào đâu.
- **Dựng phim**: một timeline đầy đủ với clip, chữ, phụ đề, lời thuyết minh và âm thanh. Di chuyển, thu phóng và đổi kiểu cho bất cứ thứ gì trong một cảnh. Xuất ra video, hoặc mang timeline sang Final Cut Pro, Premiere Pro hay DaVinci Resolve.
- **Bảng vẽ**: một bảng để lên ý tưởng, với ghi chú, hình ảnh, clip và giọng đọc đặt cạnh nhau. Tạo từng thứ bằng các dịch vụ của bạn, rồi đưa chúng lên timeline theo thứ tự.
- **Chỉnh màu**: chỉnh màu từng clip với scope, bánh xe màu và đường cong, từ footage log của máy quay hoặc với LUT `.cube`. Xem trước thế nào, xuất ra đúng như vậy.

Cả bốn dùng chung một thư viện: tư liệu của riêng bạn được sắp theo thư mục, liên kết thay vì sao chép và vẫn tìm lại được khi bạn di chuyển chúng, bên cạnh nhạc, hiệu ứng âm thanh, giọng đọc và sticker miễn phí của OpenFilm.

### Cộng đồng

Cộng đồng là một tiêu chuẩn mở cho mọi thứ bạn có thể thêm vào OpenFilm, và ai cũng có thể làm cho nó.

- **Plugin** mở rộng chính OpenFilm bằng các trình chỉnh sửa mới và các kết nối tới dịch vụ bên ngoài. Các trình chỉnh sửa của OpenFilm cũng là plugin, được làm theo đúng cách mà bất kỳ ai cũng làm.
- **Skill** dạy agent cách làm một loại video.
- **Tài nguyên** gồm nhạc, hiệu ứng âm thanh, chuyển cảnh, hiệu ứng, kiểu chữ, sticker và mẫu.
- **Ví dụ** là các dự án hoàn chỉnh để học theo và remix.

Mỗi thứ là một thư mục bình thường. Thêm từ cửa sổ Community trong OpenFilm, hoặc tự làm: [làm plugin](packages/openfilm/plugins/README.md), [viết skill](https://github.com/openfilm/community/blob/main/SPEC.md), [chia sẻ tài nguyên](https://github.com/openfilm/community/blob/main/assets/CONTRIBUTING.md), hoặc chia sẻ một video đã hoàn thành làm ví dụ, rồi đưa nó vào danh sách ở [openfilm/community](https://github.com/openfilm/community).

### Cách hoạt động

Một video là một thư mục có tệp `film.html`: các track chứa clip, định kiểu bằng CSS.

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

Mỗi cảnh là một trang web với một hàm duy nhất, `frame(t)`, vẽ bất kỳ khoảnh khắc nào bằng bất cứ thứ gì trình duyệt vẽ được (three.js, WebGL, canvas, SVG, CSS, GSAP, video) và luôn cho ra cùng một hình với cùng một `t`, nên video render giống hệt nhau trên mọi máy, agent kiểm tra được từng khung hình, và không cần framework nào như Remotion hay HyperFrames.

```js
window.film = {
  frame(t) { /* vẽ trọn vẹn khung hình tại giây thứ t */ },
};
```

**Thay đổi của bạn luôn được giữ.** Khi bạn tự tay sửa thứ gì đó trong một cảnh, như chữ, màu, vị trí hay kích thước, OpenFilm lưu nó vào `overrides` của clip chứ không phải trong mã của trang. Agent có viết lại trang thì thay đổi của bạn vẫn được áp dụng. Định dạng đầy đủ có trong [SPEC.md](packages/openfilm/SPEC.md).

### Đóng góp

Để chạy OpenFilm từ mã nguồn hoặc gửi pull request, hãy đọc [CONTRIBUTING.md](CONTRIBUTING.md). Báo lỗi trong [Issues](https://github.com/openfilm/openfilm/issues) kèm báo cáo lấy từ Settings → Developer → Copy report, còn vấn đề bảo mật thì báo theo hướng dẫn trong [SECURITY.md](SECURITY.md).

### Star History

<a href="https://www.star-history.com/#openfilm/openfilm&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date&theme=dark">
    <img alt="Star History of openfilm/openfilm" src="https://api.star-history.com/svg?repos=openfilm/openfilm&type=Date">
  </picture>
</a>
