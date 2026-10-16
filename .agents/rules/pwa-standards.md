# PWA Standards & Mobile Best Practices

Quy chuẩn bắt buộc khi khởi tạo hoặc cập nhật bất kỳ dự án Progressive Web App (PWA) nào (đặc biệt là các dự án triển khai trên GitHub Pages, shared domain / subpath, và tối ưu cho Android Chrome WebAPK & iOS Safari):

## 1. Web App Manifest (`manifest.json` / `manifest.webmanifest`)
- **App ID (`id`)**: Bắt buộc phải có trường `id` với cú pháp đường dẫn tương đối hoặc scoped (ví dụ: `"./?app=<app-name>"` hoặc `"/<repo-name>/"`). Tuyệt đối không bỏ trống vì Android Chrome sẽ dùng URL root để định danh, gây xung đột WebAPK với các app khác trên cùng domain.
- **Scope (`scope`)**: Luôn giới hạn phạm vi trong thư mục của ứng dụng (dùng `"./"` hoặc `"/<repo-name>/"`). **TUYỆT ĐỐI KHÔNG** dùng root `"/"`.
- **Start URL (`start_url`)**: Phải nằm trong scope đã khai báo (dùng `"./"` hoặc `"./index.html"`).
- **Display & Orientation**:
  - Khai báo `"display": "standalone"` để ứng dụng chạy toàn màn hình như native app, ẩn thanh URL trình duyệt.
  - Khai báo rõ `"orientation"` (ví dụ `"portrait"` cho ứng dụng mobile-first).
- **Màu sắc giao diện**:
  - Cấu hình `"theme_color"` (màu thanh trạng thái / app bar) và `"background_color"` (màu nền splash screen khi mở app) đồng bộ với bảng màu thiết kế để tránh nhấp nháy màn hình trắng.
- **Biểu tượng (Icons)**:
  - Cung cấp tối thiểu 2 kích thước chuẩn: `192x192` và `512x512`.
  - Bắt buộc có biểu tượng hỗ trợ **maskable** (`"purpose": "any maskable"` hoặc tách riêng icon 512 maskable) để Android tự động bo tròn theo icon shape của hệ thống (tránh viền trắng xấu trên launcher).

## 2. Khả năng Tương thích iOS Safari (iOS Meta Tags & Safe Area)
iOS Safari không tự động áp dụng đầy đủ thuộc tính từ manifest, do đó trong thẻ `<head>` của `index.html` bắt buộc phải có:
- **iOS Meta Tags**:
  ```html
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"> <!-- hoặc default -->
  <meta name="apple-mobile-web-app-title" content="Tên App">
  <link rel="apple-touch-icon" href="./icons/icon-192.png">
  ```
- **Safe Area Insets (Tai thỏ & Thanh vuốt Home iOS)**:
  - Khai báo viewport: `<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">`.
  - Trong CSS, các thành phần neo đỉnh (App Bar) và neo đáy (Bottom Navigation, Bottom Sheet, FAB) phải tôn trọng biến môi trường safe-area:
    ```css
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
    ```

## 3. Service Worker Registration
- Khi gọi `navigator.serviceWorker.register()`, bắt buộc truyền tham số scope tương đối:
  ```javascript
  navigator.serviceWorker.register('./sw.js', { scope: './' })
  ```
- Không để Service Worker tự động nhận scope mặc định là root `/`.

## 4. Service Worker Scope Isolation & Fetch Safety (`sw.js`)
- Trong sự kiện `fetch`, bắt buộc kiểm tra để không chặn (intercept) hoặc can thiệp vào request của các ứng dụng khác trên cùng domain:
  ```javascript
  if (requestUrl.origin === self.location.origin && !event.request.url.startsWith(self.registration.scope)) {
    return; // Bỏ qua, để trình duyệt xử lý mạng bình thường
  }
  ```
- **Bỏ qua request đặc thù**: Không chặn hoặc cache các request không phải `GET`, hoặc các URL có giao thức `blob:`, `data:`, `chrome-extension:`.
- Khi xử lý navigation fallback (SPA), chỉ fallback về `./index.html` nếu URL điều hướng nằm trong scope của ứng dụng.
- Tất cả các đường dẫn precache assets trong `PRECACHE_ASSETS` phải là đường dẫn tương đối (`./index.html`, `./styles.css`, v.v.), không dùng đường dẫn tuyệt đối bắt đầu bằng `/`.

## 5. Cache-Busting, Versioning & 100% Offline Resilience
- **Bắt buộc nâng version (+1) ngay khi cập nhật**: Bất cứ khi nào có thay đổi trong mã CSS hoặc JS (dù là sửa nhỏ hay thêm tính năng), **BẮT BUỘC** phải nâng số phiên bản `?v=X` (+1) trong các thẻ liên kết ở `index.html` (ví dụ: `./css/style.css?v=4`, `./js/app.js?v=4`).
- **Đồng bộ Service Worker Cache**:
  - Tăng phiên bản `CACHE_NAME` trong Service Worker (ví dụ: `const CACHE_NAME = "app-v4";`).
  - Cập nhật danh sách `ASSETS_TO_CACHE` bao gồm cả các URL có version `?v=X`.
  - Sử dụng `caches.match(event.request, { ignoreSearch: true })` để hỗ trợ offline trơn tru, đồng thời query string mới sẽ ép trình duyệt và CDN (GitHub Pages, Cloudflare) bypass cache HTTP cũ ngay lập tức khi online.
  - Đảm bảo sự kiện `activate` xóa sạch các cache cũ khác `CACHE_NAME` hiện tại để user luôn nhận được bản mới nhất mà không bị lưu cache cũ.
- **Pin phiên bản thư viện CDN & Precache toàn bộ**:
  - Toàn bộ thư viện bên thứ ba (CSS, JS, Web Components, Fonts) nạp qua CDN bắt buộc phải gắn phiên bản cụ thể (ví dụ `@1.2.3`), tuyệt đối không dùng `@latest` hay URL tự động cập nhật.
  - Mọi tệp CDN này phải được đưa vào danh sách precache trong Service Worker để app hoạt động độc lập và đạt chuẩn kiểm tra "Airplane Mode" (hoạt động 100% khi mất mạng hoàn toàn sau lần tải đầu).

## 6. Quản lý Sự kiện Cài đặt PWA & Thông báo Cập nhật In-App
- **Nút Cài đặt (Install Button)**:
  - Không hiển thị nút cài đặt cứng trên giao diện nếu chưa sẵn sàng. Ẩn nút theo mặc định.
  - Lắng nghe sự kiện `beforeinstallprompt`, lưu sự kiện vào biến tạm (`deferredInstallPrompt`) và chỉ lúc đó mới cho hiển thị nút "Cài đặt" trên thanh App Bar.
  - Khi người dùng nhấn nút: gọi `deferredInstallPrompt.prompt()`, đợi kết quả từ `userChoice`, sau đó xóa biến tạm và ẩn nút.
  - Lắng nghe sự kiện `appinstalled` để ẩn nút và xác nhận cài đặt thành công.
- **Gợi ý cài đặt cho iOS Safari**:
  - Do iOS Safari không hỗ trợ `beforeinstallprompt`, nếu phát hiện đang chạy trên iOS Safari ở chế độ trình duyệt (không phải standalone), cung cấp một gợi ý ngắn gọn (tooltip/modal): *"Nhấn nút Chia sẻ (Share) ⎋ rồi chọn 'Thêm vào Màn hình chính' (Add to Home Screen) ⊕"*.
- **Thông báo cập nhật bản mới (In-App Update Flow)**:
  - Khi phát hiện Service Worker mới ở trạng thái `waiting`, hiển thị một Snackbar / Toast: *"Đã có bản cập nhật mới — Tải lại"* cùng nút bấm xác nhận.
  - Tuyệt đối không tự ý reload trang khi người dùng đang thao tác dở dang; chỉ reload khi người dùng bấm xác nhận hoặc khi ứng dụng được khởi động lại.

## 7. Xử lý Tác vụ Nặng & Quản lý Bộ nhớ (Web Worker & Memory Safety)
- **Đưa tác vụ nặng sang Web Worker**:
  - Bất kỳ tác vụ tốn CPU hoặc I/O lớn nào (xử lý âm thanh/video, phân tích file lớn, giải thuật quét dữ liệu) bắt buộc phải đưa vào **Web Worker** để Main Thread luôn duy trì 60fps và giao diện phản hồi tức thì.
  - Tác vụ kéo dài quá ~1 giây phải gửi cập nhật tiến trình (`postMessage({ progress })`) để cập nhật thanh tiến trình (`role="progressbar"`).
- **Ngăn ngừa tràn bộ nhớ (Out of Memory - OOM) trên Mobile**:
  - Thiết bị di động có hạn mức RAM khắt khe. Tránh decode toàn bộ tệp lớn vào RAM cùng một lúc.
  - Ưu tiên xử lý theo từng khối (chunking) hoặc thao tác trực tiếp trên byte array (`Uint8Array`, `Blob.slice`).
  - Khi truyền `ArrayBuffer` giữa Main Thread và Web Worker, luôn sử dụng **Transferable Objects** (ví dụ `worker.postMessage(buffer, [buffer])`) để chuyển giao quyền sở hữu, tránh tốn gấp đôi bộ nhớ do cơ chế nhân bản (clone).
- **Giải phóng Object URL**:
  - Mọi `URL.createObjectURL(blob)` tạo ra cho việc nghe thử, xem ảnh hoặc tải về phải được thu hồi thông qua `URL.revokeObjectURL(url)` ngay khi không còn sử dụng (hoặc sau thời gian chờ an toàn, ví dụ 60 giây) để tránh rò rỉ bộ nhớ (memory leak).

## 8. Xử lý Tải File & Chia Sẻ Di Động (Mobile Download & Web Share)
- **Hỗ trợ tải tệp trên Android/Desktop vs iOS Safari**:
  - *Android / Desktop*: Sử dụng thẻ tạm `<a download="filename" href="blobUrl">`, kích hoạt `click()` và xóa thẻ.
  - *iOS Safari / iOS PWA*: Thẻ `<a download>` thường không lưu trực tiếp vào máy mà mở trang trắng hoặc xem trước. Xử lý chuẩn:
    1. Kiểm tra hỗ trợ Web Share API: `navigator.canShare && navigator.canShare({ files: [file] })`.
    2. Nếu hỗ trợ, ưu tiên gọi `navigator.share({ files: [new File([blob], fileName, { type })] })` để mở bảng chia sẻ iOS, cho phép người dùng chọn **"Lưu vào Tệp" (Save to Files)**.
    3. Cung cấp đường dẫn dự phòng "Nhấn để tải về" (mở trong tab mới) nếu người dùng hủy chia sẻ (`AbortError`) hoặc trình duyệt không hỗ trợ.

## 9. Giữ Sáng Màn Hình Cho Tác Vụ Dài (Screen Wake Lock API)
- Khi ứng dụng đang thực hiện tác vụ dài không có tương tác tay (xuất tệp, xử lý dữ liệu nặng, phát nội dung):
  - Kích hoạt `navigator.wakeLock.request('screen')` nếu trình duyệt hỗ trợ để ngăn màn hình tự khóa/ngủ làm gián đoạn tiến trình.
  - Luôn đảm bảo giải phóng Wake Lock (`wakeLock.release()`) trong khối `finally` ngay khi tác vụ kết thúc hoặc phát sinh lỗi.

## 10. Thiết Kế Giao Diện Mobile-First & Tiêu Chuẩn Accessibility (a11y)
- **Kích thước vùng chạm (Touch Targets)**:
  - Mọi phần tử tương tác (button, icon button, input, checkbox row) phải đạt kích thước tối thiểu **44×44 px** (khuyến nghị **48×48 px** cho các nút hành động chính) để dễ thao tác bằng ngón tay.
- **Bố cục Responsive & Dialog**:
  - Mobile-first: Cột đơn trên màn hình nhỏ `< 600px`, dialog nên hiển thị dưới dạng Bottom Sheet toàn chiều rộng.
  - Màn hình lớn (tablet/desktop): Căn giữa với `max-width` giới hạn (720px - 840px), dialog căn giữa màn hình.
- **Độ tương phản & Hiệu ứng Chuyển động**:
  - Đảm bảo tỷ lệ tương phản chữ/nền ≥ **4.5:1** (WCAG AA). Không sử dụng màu sắc làm chỉ số trạng thái duy nhất (luôn kèm theo icon hoặc nhãn chữ).
  - Tôn trọng thuộc tính `prefers-reduced-motion` của người dùng (tắt hoặc giảm hiệu ứng chuyển động/ripple).
  - Hỗ trợ Dark Mode đồng bộ (`prefers-color-scheme: dark`).
- **Hiển thị Số & Đồng hồ Thời gian**:
  - Sử dụng CSS `font-variant-numeric: tabular-nums` cho tất cả các hiển thị thời gian, đồng hồ, tiến trình và số liệu để tránh hiện tượng co giãn, giật layout khi số thay đổi.
- **Tiêu chuẩn ARIA & Bàn phím**:
  - Các icon button bắt buộc có `aria-label`.
  - Hộp thoại phải có `role="dialog"`, `aria-modal="true"`, bẫy tiêu điểm (focus trap) và cho phép đóng bằng phím `Esc`.
  - Vòng nét tiêu điểm rõ ràng (visible focus ring) cho người dùng bàn phím.
