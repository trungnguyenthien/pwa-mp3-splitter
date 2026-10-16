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
