# External Libraries (elibs)

Thư mục này được sử dụng để quản lý các thư viện JavaScript, CSS hoặc assets bên thứ 3 (nếu có bổ sung trong tương lai).

## Trạng thái hiện tại của dự án:
Ứng dụng **PWA MP3 Splitter** hiện tại được thiết kế và xây dựng theo mô hình **Zero External Dependencies (100% Self-Contained)**:
- **Core Audio Engine**: Tự lập trình thuần Vanilla JS (`app.js`, `mp3-worker.js`), quét và cắt frame MP3 trực tiếp bằng `Uint8Array`/`ArrayBuffer`, không cần thư viện decode/encode ngoài.
- **Waveform & Silence Detection**: Sử dụng Web Audio API và HTML5 Canvas 2D có sẵn trong trình duyệt.
- **UI Design System**: Viết hoàn toàn bằng Vanilla CSS (`styles.css`), không nạp CDN framework (như `@material/web`, Bootstrap hay Tailwind).
- **Icons**: Vector SVG nhúng trực tiếp (Inline SVGs), không phụ thuộc CDN icon.
- **Typography**: Sử dụng font hệ thống (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto...`), không kết nối Google Fonts.
- **Offline / PWA**: Service Worker (`sw.js`) precache 100% mã nguồn nội bộ.

Tất cả tài nguyên đều nằm cục bộ trong máy, đảm bảo ứng dụng hoạt động ngoại tuyến (Offline) 100% mà không bị phụ thuộc vào bất kỳ máy chủ hay CDN nào bên ngoài.
