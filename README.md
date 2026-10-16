# MP3 Splitter PWA

Ứng dụng Progressive Web App (PWA) cắt nhỏ file MP3 trực tiếp trên trình duyệt, không cần tải lên server, không nén lại (lossless), hoạt động 100% offline.

## ✨ Tính năng nổi bật

- **Lossless & Zero Quality Loss**: Cắt audio theo frame MP3 (~26ms) trực tiếp bằng byte array, giữ nguyên 100% chất lượng gốc và không re-encode.
- **100% Offline (Airplane Mode Ready)**: Service Worker lưu cache toàn bộ ứng dụng, chạy mượt mà ngay cả khi ngắt kết nối Internet hoàn toàn.
- **Xử lý nhanh qua Web Worker**: Quét header frame, phân tích ID3v2 và cắt file chạy trong luồng nền (Web Worker), giữ giao diện luôn đạt 60fps.
- **Waveform trực quan**: Vẽ dạng sóng âm thanh chuẩn Retina, hỗ trợ chạm để tua (seek) và hiển thị các vùng track đã chọn.
- **2 Chế độ phân đoạn**:
  - **Auto Split (Silence Detection)**: Tự động phát hiện khoảng lặng (silence) để đề xuất danh sách bài hát. Có thanh trượt tùy chỉnh ngưỡng dB và thời lượng tối thiểu trong Advanced Settings.
  - **Time Range**: Nhập trực tiếp thời gian bắt đầu và kết thúc bằng giây (với định dạng xem trước `mm:ss.s`).
- **Tương thích Mobile (Android WebAPK & iOS Safari)**:
  - Hỗ trợ cài đặt màn hình chính (PWA standalone).
  - Tích hợp Web Share API cho iOS Safari để lưu file trực tiếp vào **"Lưu vào Tệp" (Save to Files)**.
  - Tự động giữ màn hình sáng (Screen Wake Lock API) trong khi xuất file.
- **Giao diện Material Design 3**: Hỗ trợ Dark Mode tự động, an toàn với tai thỏ (Safe Area Insets), kích thước nút chuẩn cảm ứng ≥ 44px.

## 🚀 Chạy thử cục bộ

Không cần cài đặt thư viện hay build step phức tạp (Pure HTML + CSS + Vanilla JS):

```bash
# Khởi động server HTTP tĩnh bất kỳ:
python3 -m http.server 8080
# hoặc
npx serve .
```

Mở trình duyệt tại: `http://localhost:8080/`

## 📁 Cấu trúc thư mục

```
pwa-mp3-splitter/
├── index.html              # Giao diện chính MD3 & SEO/a11y tags
├── styles.css              # Hệ thống CSS Material Design 3, Dark Mode & Safe Area
├── app.js                  # Bộ điều khiển chính, state model, waveform & Web Audio
├── mp3-worker.js           # Worker quét frame MP3, ID3v2 và cắt lossless
├── sw.js                   # Service Worker chuẩn WebAPK isolation & offline cache
├── manifest.webmanifest    # PWA Web App Manifest
├── icons/                  # Bộ biểu tượng 192px, 512px, maskable & favicons
├── .gitignore              # Bộ lọc file rác hệ điều hành, IDE và log
└── mp3-splitter-pwa-spec.md# Bản đặc tả kỹ thuật chi tiết
```

## 📜 Quy chuẩn PWA

Dự án tuân thủ nghiêm ngặt các quy tắc trong [pwa-standards.md](file://~/.gemini/config/rules/pwa-standards.md):
- Scoped URL isolation (`./?app=mp3-splitter`, `scope: "./"`).
- Cache-busting versioning `?v=1`.
- Không intercept request ngoại lai hoặc blob/data URL.
