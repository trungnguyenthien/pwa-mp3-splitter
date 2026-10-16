# MP3 & M4A Splitter PWA

Ứng dụng Progressive Web App (PWA) cắt nhỏ file âm thanh MP3 và M4A (AAC) trực tiếp trên trình duyệt, không cần tải lên server, không nén lại (lossless), hoạt động 100% offline.

🌐 **Trải nghiệm trực tiếp (Live Demo)**: [https://trungnguyenthien.github.io/pwa-mp3-splitter/](https://trungnguyenthien.github.io/pwa-mp3-splitter/)  
📦 **Mã nguồn GitHub**: [https://github.com/trungnguyenthien/pwa-mp3-splitter](https://github.com/trungnguyenthien/pwa-mp3-splitter)

## ✨ Tính năng nổi bật

- **Hỗ trợ MP3 & M4A (AAC Lossless)**: Cắt audio theo frame MP3 (~26ms) và ISO-BMFF sample table của M4A/AAC (~23ms) trực tiếp bằng byte array, tái tạo container chuẩn với metadata `TIT2` (MP3) và `©nam` (M4A), giữ nguyên 100% chất lượng gốc và tuyệt đối không re-encode.
- **100% Offline (Airplane Mode Ready)**: Service Worker lưu cache toàn bộ ứng dụng, chạy mượt mà ngay cả khi ngắt kết nối Internet hoàn toàn.
- **Xử lý siêu nhanh qua Web Worker**: Quét header frame, phân tích ID3v2 / ISO-BMFF và cắt file chạy trong luồng nền (Web Worker) với fallback in-thread, giữ giao diện luôn đạt 60fps.
- **Waveform trực quan**: Vẽ dạng sóng âm thanh chuẩn Retina, hỗ trợ chạm để tua (seek) và hiển thị các vùng track đã chọn.
- **2 Chế độ phân đoạn**:
  - **Auto Split (Silence Detection)**: Tự động phát hiện khoảng lặng (silence) để đề xuất danh sách bài hát. Có thanh trượt tùy chỉnh ngưỡng dB và thời lượng tối thiểu trong Advanced Settings.
  - **Time Range (Mobile-First Jog Wheel)**: Thẻ chạm đôi Bắt đầu / Kết thúc kết hợp con xoay bánh xe (DAW Jog Wheel) cuộn mượt mà định dạng `mm:ss`, kèm các bước nhảy nhanh `±1s` và `±10s`.
- **Chỉnh sửa thông tin bài hát & Ảnh bìa (Tag & Cover Art Editor)**:
  - Xem và chỉnh sửa Artist (Nghệ sĩ), Album, Năm phát hành (Year) và Ảnh bìa (Thumbnail / Cover Art).
  - Tự động trích xuất metadata và artwork sẵn có từ file gốc (ID3v2 cho MP3, `moov.udta.meta.ilst` cho M4A).
  - Hỗ trợ đổi ảnh bìa bằng cách chụp ảnh hoặc chọn ảnh từ máy (JPG, PNG, WEBP). Tự động tối ưu qua HTML5 Canvas về kích thước 500x500 (~40 KB) để file nhạc không bị phình dung lượng.
  - Khi xuất/cắt từng phần nhạc, metadata và ảnh thumbnail sẽ được nhúng trực tiếp vào từng đoạn cắt (chuẩn `ID3v2 APIC` cho MP3 và `ilst covr` cho M4A) với tốc độ tức thì (< 2ms) mà không làm suy giảm chất lượng âm thanh.
- **Tương thích Mobile (Android WebAPK & iOS Safari)**:
  - Hỗ trợ cài đặt màn hình chính (PWA standalone).
  - Tích hợp Web Share API cho iOS Safari để lưu file trực tiếp vào **"Lưu vào Tệp" (Save to Files)**.
  - Tự động giữ màn hình sáng (Screen Wake Lock API) trong khi xuất file.
