# MP3 Splitter PWA — Technical Spec

> Tài liệu spec để đưa cho AI coding agent hoặc dùng làm căn cứ khi code. Pure HTML + CSS + vanilla JavaScript (ES6), không backend, không build step bắt buộc.

---

## Part 0: Tool Overview & Context (English)

**Problem / motivation.** Long MP3 files (podcast episodes, DJ sets, concert recordings, "playlist in one file" downloads) often contain several tracks that the user wants as separate files. Doing this manually in a desktop editor is slow, and mobile editors are either paid, ad-heavy, or re-encode the audio and lose quality.

**Target user.** An individual, non-technical user working mostly on a phone (Android Chrome, iOS Safari) who owns MP3 files under ~100 MB and wants to split them quickly, even without internet.

**Core value / goal.** This tool helps a user turn one long MP3 into several named MP3 files faster and more easily than with a desktop editor, with no upload, no account, and no quality loss.

**Primary use case (main flow).** The user opens the installed PWA and picks an MP3 file. The app indexes the file and draws a waveform. The user then adds parts to a "parts to split" list in one of two ways: (1) **Auto** — the app recommends parts based on silence detection, the user multi-selects the ones they want in a popup; (2) **Time range** — the user types a start and end time in seconds in a popup. Each part in the list shows its start–end range and has an editable name. The user taps the **[Split]** button on a part, the app cuts that part out of the original file (without re-encoding) and immediately offers it for download under the chosen name.

**Scope boundaries.** The tool does **not**: upload anything to a server; re-encode or change audio quality; edit tags beyond writing the part title; support formats other than MP3; handle multiple source files at once; sync data across devices; or batch-split all parts with one button (each part has its own Split button).

**Success criteria.**
- Works fully offline after the first load (airplane mode test passes).
- A 100 MB MP3 loads and gets indexed without crashing on a mid-range phone (no full-file decode into RAM).
- Split output plays correctly in common players, has the exact chosen file name, and is byte-for-byte audio-identical to the source frames (no re-encode).
- Cut points are accurate to within one MP3 frame (~26 ms).
- UI stays responsive (heavy work runs in a Web Worker) and shows progress for operations longer than ~1 s.

> **Note on modes:** the original request mentioned 3 modes but described 2 (Auto, Time range). This spec implements those 2. The architecture keeps a `addPartsFromSource(source, parts)` entry point so a third mode can be added later without changing the part list.

---

## Part 1: Web Interface (English)

### Design system
Material Design 3 (Material You) guidelines: tonal surfaces, elevation levels 0–3, rounded corners (12px cards, 28px dialogs, full-round buttons/FAB), ripple/state-layer feedback, 4/8 px spacing grid.

### Color palette
| Role | Hex | Usage |
|---|---|---|
| Primary | `#6750A4` | App bar accent, filled buttons, active states, waveform selection |
| Accent (tertiary) | `#7D5260` | Secondary highlights (FAB, selected chips) |
| Background | `#FEF7FF` | Page background |
| Surface | `#FFFFFF` | Cards, dialogs |
| On-surface text | `#1D1B20` | Primary text |
| On-surface variant | `#49454F` | Secondary text, captions |
| Outline | `#CAC4D0` | Dividers, input borders |
| Success | `#2E7D32` | "Done" state on a part |
| Error | `#B3261E` | Validation errors |

Dark mode: provide a dark variant via `prefers-color-scheme: dark` using the same roles (background `#141218`, surface `#1D1B20`, on-surface `#E6E0E9`).

### Typography
System font stack: `Roboto, system-ui, -apple-system, "Segoe UI", sans-serif`. Sizes in `rem`: H1 1.5rem/500, H2 1.25rem/500, body 1rem/400, caption 0.75rem/400. Use `font-variant-numeric: tabular-nums` for all time values.

### Layout
Mobile-first, single column, portrait-friendly.
- `< 600px` (mobile): one column, bottom-anchored FAB, dialogs rendered as full-width bottom sheets.
- `600–1024px` (tablet): centered column, max-width 720px, dialogs centered.
- `> 1024px` (desktop): centered column max-width 840px.

Use Flexbox for rows and CSS Grid only where needed. Respect safe-area insets (`env(safe-area-inset-*)`) for iOS standalone mode. Portrait is the primary orientation; landscape must remain usable.

### Key screens / sections
1. **Top app bar** — app title, "Install" button (shown only when `beforeinstallprompt` is available), offline-ready indicator chip.
2. **File picker card** — empty state with "Choose MP3" button; after loading shows file name, size, duration, bitrate, and a "Change file" text button.
3. **Waveform card** — canvas waveform of the whole file; shaded overlays for every part in the list; tap-to-seek; shows current time. Hidden until the file is indexed.
4. **Add-part action row** — two buttons: `Auto split` (opens Auto dialog) and `Time range` (opens Time Range dialog). Disabled until a file is loaded.
5. **Auto split dialog** — lists recommended parts as checkable rows (checkbox, auto name, `start–end`, duration, ▶ preview button). Header has "Select all / Clear". Footer has `Cancel` and `Add selected (N)`. Shows a progress bar while analysis runs. Includes an "Advanced" expander with silence threshold (dB) and minimum silence length (s) sliders and a `Re-analyze` button.
6. **Time range dialog** — two numeric fields: `Start (s)` and `End (s)`, with helper text showing the file duration and the formatted `mm:ss.s` preview; `Cancel` and `Add part` buttons.
7. **Parts list card** — title "Parts to split (N)". Each part item contains: index badge; editable name text field; read-only range text `mm:ss.s → mm:ss.s (duration)`; ▶ Preview button; 🗑 Delete button; `[Split]` filled button. The Split button shows a spinner while working and switches to a "Done ✓ — Download again" state afterward.
8. **Snackbar / toast area** — bottom snackbar for messages ("Part added", "Name already used, renamed to …", "Error: …").
9. **Empty states** — no file: illustration + instruction; no parts: "Add parts using Auto split or Time range".

### Accessibility & responsiveness notes
- Minimum touch target 44×44 px (48 px for primary buttons and icon buttons).
- Text contrast ≥ 4.5:1 against its background; do not rely on color alone for state (use icons/labels too).
- Visible focus ring (2px primary outline, 2px offset) for keyboard users; dialogs trap focus and close on `Esc`.
- All icon buttons have `aria-label`; dialogs use `role="dialog"` + `aria-modal="true"`; the progress bar uses `role="progressbar"`.
- Respect `prefers-reduced-motion` (disable ripples and transitions).

---

## Part 2: Supporting Libraries

Nguyên tắc: chỉ dùng thư viện phổ biến, nạp bằng CDN (pin phiên bản cụ thể), toàn bộ file CDN phải được precache trong Service Worker để chạy offline.

| Chức năng | Thư viện | Lý do / Ghi chú |
|---|---|---|
| UI Material Design 3 | **Material Web Components** (`@material/web`) | Thư viện chính thức của Google. Nạp bằng ES module từ CDN, ví dụ `https://cdn.jsdelivr.net/npm/@material/web@<version>/…` (hoặc dùng bundle esm.run). Pin phiên bản và precache. |
| Đọc/cắt MP3 theo frame | **Vanilla JS, không cần thư viện** | Tự quét header frame MP3 (sync word, bitrate, sample rate, padding) và `Uint8Array.subarray`/`Blob.slice` để cắt. Không decode, không re-encode. |
| Dò khoảng lặng / vẽ waveform | **Web Audio API (`decodeAudioData`) — vanilla JS** | Có sẵn trong trình duyệt, đủ dùng khi decode theo từng khúc nhỏ ở sample rate thấp (8 kHz mono). |
| Decode dự phòng cho iOS (tùy chọn) | **mpg123-decoder** (WASM) | Chỉ thêm nếu `decodeAudioData` theo khúc cho kết quả không ổn định trên iOS Safari. Mặc định: **không dùng**. |
| Đóng gói ZIP | **Không cần** | Mỗi part có nút Split riêng và tải từng file, không cần JSZip. |
| Lưu cache offline | **Service Worker + Cache Storage — vanilla JS** | API chuẩn của trình duyệt, không cần Workbox (app shell nhỏ). |
| Giao diện waveform | **Canvas 2D — vanilla JS** | Không cần thư viện biểu đồ. |

---

## Part 3: Action / Interaction Logic (detailed)

### 3.0 Overall state model

```js
// Single source of truth. UI is re-rendered from this object.
const state = {
  file: null,            // { name, size, buffer: ArrayBuffer }
  index: null,           // { frames: Uint32Array offsets, frameDuration, firstFrameOffset, duration, bitrate, sampleRate }
  peaks: null,           // Float32Array of loudness per analysis window (for waveform + silence detection)
  parts: [],             // [{ id, name, start, end, status: 'idle'|'working'|'done'|'error' }]
  suggestions: [],       // [{ id, start, end, selected }] — Auto dialog candidates
  settings: { silenceDb: -45, minSilenceSec: 1.5, minPartSec: 30 },
  ui: { loading: false, progress: 0, dialog: null /* 'auto' | 'range' | null */, previewId: null },
};
```

**Data flow summary.** User actions call handler functions that validate input, mutate `state`, and then call `render()` (or targeted render helpers such as `renderParts()`), which rewrites the relevant DOM. Heavy work (frame indexing, silence analysis, cutting) runs in a Web Worker and reports progress via `postMessage`; the main thread only updates `state.ui.progress` and re-renders the progress bar. Parts live only in memory for the session (no persistence — see scope).

### 3.1 Pick MP3 file

1. **Trigger**: click `Choose MP3` / `Change file` → hidden `<input type="file" accept="audio/mpeg,.mp3">` fires `change`.
2. **Function name**: `handleFileSelected(event)`
3. **Step-by-step logic**:
   1. Read `event.target.files[0]`; if none, return.
   2. Validate extension/MIME is MP3 and `size <= 100 * 1024 * 1024` (warn, do not block, above 100 MB).
   3. Reset `state` (parts, suggestions, peaks, index) and revoke any preview object URLs.
   4. `file.arrayBuffer()` → store as `state.file`.
   5. Send buffer to the worker (`indexMp3`) — transfer, do not copy.
   6. Worker skips the ID3v2 tag, scans frames, builds the frame offset table and computes duration.
   7. Request `computePeaks` from the worker (chunked decode, see 3.2) to draw the waveform.
   8. On completion, render file info + waveform.
4. **State touched**: `state.file`, `state.index`, `state.peaks`, `state.parts`, `state.suggestions`, `state.ui.loading/progress`.
5. **Edge cases & error handling**:
   - Not an MP3 / no valid frames found → snackbar "This doesn't look like a valid MP3 file", state stays empty.
   - Very large file (>100 MB) → confirm dialog about possible slowness.
   - Worker crash / out-of-memory → snackbar "Not enough memory to open this file" and reset.
   - Selecting the same file again must still trigger `change` (reset `input.value = ''`).
6. **DOM updates**: show loading progress bar; fill file info card; draw canvas; enable `Auto split` and `Time range` buttons.

### 3.2 `indexMp3` and `computePeaks` (worker logic)

1. **Trigger**: message from main thread.
2. **Function names**: `indexMp3(buffer)`, `computePeaks(buffer, index)`
3. **Step-by-step logic**:
   1. `indexMp3`: if the file starts with `ID3`, compute tag size (synchsafe integer, 10-byte header + size) and start scanning after it.
   2. For each position, find the sync word (`0xFFE`), parse MPEG version, layer III, bitrate index, sample-rate index, padding bit.
   3. Frame length: MPEG1 Layer III = `floor(144 * bitrate / sampleRate) + padding`; MPEG2/2.5 Layer III = `floor(72 * bitrate / sampleRate) + padding`.
   4. Push the frame offset; advance by frame length; if the next position is not a valid sync word, resync byte-by-byte (limit retries).
   5. Detect and skip a Xing/Info/VBRI header frame (first frame) so it is not counted as audio.
   6. Frame duration = samples per frame (1152 for MPEG1, 576 for MPEG2/2.5) / sampleRate → total duration = frames × frame duration.
   7. `computePeaks`: iterate over chunks of ~30–60 s (aligned to frame boundaries). Because MP3 frames depend on previous frames (bit reservoir), prepend 2–3 extra frames to each chunk and discard their output.
   8. Decode each chunk with an `OfflineAudioContext(1, length, 8000)` (mono, low sample rate) → compute RMS per 50 ms window → convert to dBFS → store in the peaks array; release the PCM immediately.
   9. Post progress after each chunk.
4. **State touched**: worker-local variables; results sent back as transferable `Uint32Array` / `Float32Array`.
5. **Edge cases & error handling**: corrupted frames (resync), VBR files (variable frame sizes are handled because offsets are stored per frame), files with trailing ID3v1/APE tags (stop at the last valid frame), `decodeAudioData` failure on one chunk (mark that window as unknown loudness and continue).
6. **DOM updates**: none directly; main thread updates progress bar and draws the waveform when peaks arrive.

### 3.3 Auto split — open dialog and analyze

1. **Trigger**: click `Auto split`.
2. **Function name**: `openAutoDialog()` → `analyzeSilence()`
3. **Step-by-step logic**:
   1. Open the dialog and show a progress state if peaks are not ready.
   2. `analyzeSilence()` walks the dB peaks array: a window is "silent" if `db < settings.silenceDb`.
   3. Group consecutive silent windows; keep groups whose length ≥ `settings.minSilenceSec`.
   4. Cut points = the middle of each kept silent group.
   5. Build candidate parts between consecutive cut points (including file start → first cut and last cut → file end).
   6. Drop candidates shorter than `settings.minPartSec` by merging them into the previous candidate.
   7. Snap each boundary to the nearest MP3 frame time.
   8. Name candidates `Part 01`, `Part 02`, … and store in `state.suggestions` with `selected = false`.
   9. Render rows with checkbox, `start–end`, duration, ▶ preview.
4. **State touched**: `state.suggestions`, `state.settings`, `state.ui.dialog`.
5. **Edge cases & error handling**:
   - No silence found (e.g., DJ mix with crossfades) → show message "No clear gaps found. Try lowering the threshold or use Time range." and keep `Re-analyze` available.
   - Too many candidates (>100) → show first 100 with a hint to raise minimum silence.
   - Peaks not ready → disable the checkbox list and show progress.
6. **DOM updates**: dialog open, list re-render, selected counter on the `Add selected (N)` button.

### 3.4 Auto split — select and add parts

1. **Trigger**: checkbox `change`, `Select all / Clear`, and click on `Add selected (N)`.
2. **Function names**: `toggleSuggestion(id)`, `selectAllSuggestions(flag)`, `addSelectedSuggestions()`
3. **Step-by-step logic** (`addSelectedSuggestions`):
   1. Collect `state.suggestions` where `selected === true`.
   2. If none selected, show inline hint and stop (button is disabled when N = 0).
   3. For each selected item create a part `{ id, name, start, end, status: 'idle' }`; make names unique (see 3.8).
   4. Append to `state.parts` sorted by `start` (stable).
   5. Close the dialog, snackbar "N parts added".
4. **State touched**: `state.suggestions[].selected`, `state.parts`, `state.ui.dialog`.
5. **Edge cases & error handling**: a candidate that duplicates an existing part range → still allowed but flagged with a "duplicate range" chip; reopening the dialog shows previously added ranges as "Already added" and unchecked by default.
6. **DOM updates**: update counter on the button, re-render parts list, close the dialog.

### 3.5 Time range — add a part

1. **Trigger**: click `Time range` → dialog; click `Add part`; `input` events on both fields.
2. **Function names**: `openRangeDialog()`, `validateRange(startSec, endSec)`, `addRangePart()`
3. **Step-by-step logic** (`addRangePart`):
   1. Parse both fields with `Number.parseFloat` (accept comma as decimal separator).
   2. Run `validateRange`.
   3. Snap `start` down and `end` up to the nearest MP3 frame boundary (using the frame index).
   4. Create a part with default name `Part NN` (unique) and push to `state.parts`.
   5. Close the dialog, snackbar "Part added".
4. **State touched**: `state.parts`, `state.ui.dialog`.
5. **Edge cases & error handling** (inline error text under the field, `Add part` disabled while invalid):
   - Empty or non-numeric → "Enter a number".
   - `start < 0` → "Start must be 0 or more".
   - `end > duration` → "End must not exceed {duration}s".
   - `end <= start` → "End must be after start".
   - Length < 1 s → "Part must be at least 1 second".
6. **DOM updates**: live `mm:ss.s` preview under each field, error states, re-render parts list on success.

### 3.6 Parts list — rename, preview, delete

1. **Trigger**: `input` on the name field; click ▶; click 🗑.
2. **Function names**: `renamePart(id, value)`, `togglePreview(id)`, `deletePart(id)`
3. **Step-by-step logic**:
   - `renamePart`: trim the value, strip characters illegal in file names (`\ / : * ? " < > |`), collapse whitespace, limit to 100 chars; do not re-render the whole list while typing (avoid losing focus); on `blur` enforce uniqueness and non-empty (fallback to `Part NN`).
   - `togglePreview`: build a Blob from the part's byte range (`state.file.buffer.slice(startOffset, endOffset)`, type `audio/mpeg`), create an object URL, play it with a single shared `<audio>` element; clicking again pauses; starting another preview stops the previous one and revokes the old URL.
   - `deletePart`: remove from `state.parts`; if it is being previewed, stop it; show snackbar with `Undo` for 5 s.
4. **State touched**: `state.parts`, `state.ui.previewId`.
5. **Edge cases & error handling**: empty name → red helper "Name can't be empty"; duplicate name → auto-suffix `(2)`; deleting a part currently working (`status === 'working'`) is disabled.
6. **DOM updates**: update the name field, toggle ▶/⏸ icon, remove the list item, show snackbar.

### 3.7 Split a part (core action)

1. **Trigger**: click `[Split]` on a part item.
2. **Function name**: `splitPart(id)`
3. **Step-by-step logic**:
   1. Find the part; if `status === 'working'`, return (prevent double tap).
   2. Final validation: name non-empty/valid, `end > start`, range within duration.
   3. Set `status = 'working'`; show spinner; request wake lock (`navigator.wakeLock.request('screen')`) if available.
   4. Map `start`/`end` to frame indices via binary search on the frame offset table → byte range `[startOffset, endOffset)`.
   5. Create the output bytes: a minimal ID3v2.3 header with a `TIT2` frame holding the part name (UTF-16 or ISO-8859-1/UTF-8 as supported) + the sliced MP3 frames (no re-encode).
   6. Create `Blob([id3, audioBytes], { type: 'audio/mpeg' })`.
   7. Call `downloadBlob(blob, fileName)` (see 3.9).
   8. Set `status = 'done'`; release wake lock; revoke the object URL after a short delay.
4. **State touched**: `state.parts[].status`, wake lock handle.
5. **Edge cases & error handling**:
   - Failure while slicing/creating the Blob (out of memory) → `status = 'error'`, snackbar "Couldn't split this part. Try closing other tabs/apps."
   - Download blocked by the browser → show a persistent "Tap to download" link button as fallback.
   - Note for the start of the cut: because of the MP3 bit reservoir, the first 1–2 frames of the output may decode with a tiny glitch (<~50 ms) in some players. Mitigation: in Auto mode cut points are in silence so this is inaudible; no extra handling needed in v1.
6. **DOM updates**: Split button → spinner → "Done ✓ — Download again"; error chip on failure.

### 3.8 Unique and safe names

1. **Trigger**: called from `addSelectedSuggestions`, `addRangePart`, `renamePart` (on blur), `splitPart`.
2. **Function names**: `sanitizeFileName(name)`, `makeUniqueName(name, existingNames)`
3. **Step-by-step logic**: sanitize → trim → fallback to `Part NN` if empty → if the name already exists among parts, append ` (2)`, ` (3)`, … → the file name is `${name}.mp3`.
4. **State touched**: reads `state.parts`.
5. **Edge cases & error handling**: names consisting only of dots/spaces; very long names (truncate); emoji/Unicode names (allowed).
6. **DOM updates**: if the name was changed automatically, update the input value and show a snackbar "Renamed to …".

### 3.9 Download helper

1. **Trigger**: end of `splitPart`, or click "Download again".
2. **Function name**: `downloadBlob(blob, fileName)`
3. **Step-by-step logic**:
   1. Create `URL.createObjectURL(blob)`.
   2. Android/Desktop: create a temporary `<a download="fileName" href=url>`, click it, remove it.
   3. iOS Safari (detect via UA/`navigator.canShare`): if `navigator.canShare({ files: [file] })`, call `navigator.share({ files: [new File([blob], fileName, { type: 'audio/mpeg' })] })` so the user can "Save to Files".
   4. Fallback: open the object URL in a new tab with a hint to use Share → Save.
   5. `setTimeout(() => URL.revokeObjectURL(url), 60_000)`.
4. **State touched**: none (stores the last blob reference per part only while status is `done`, so "Download again" works; cleared when the part is deleted or the file changes).
5. **Edge cases & error handling**: `navigator.share` rejected with `AbortError` (user cancelled) → not an error, keep the part in `done`; share not supported → fallback link.
6. **DOM updates**: none besides snackbar messages.

### 3.10 PWA install and offline

1. **Trigger**: page load; `beforeinstallprompt`; Service Worker `install`/`activate`/`fetch`; app update.
2. **Function names**: `registerServiceWorker()`, `handleInstallPrompt(event)`, `promptInstall()`
3. **Step-by-step logic**:
   1. `manifest.webmanifest`: `name`, `short_name`, `start_url: "./"`, `scope: "./"`, `display: "standalone"`, `orientation: "portrait"`, `theme_color: "#6750A4"`, `background_color: "#FEF7FF"`, icons 192/512 (+ maskable).
   2. `sw.js` `install`: open cache `mp3-splitter-v1` and precache the app shell: `index.html`, CSS, JS, worker script, manifest, icons, and every pinned CDN file (Material Web Components modules).
   3. `fetch`: cache-first for precached assets; network fallback; ignore non-GET and `blob:` requests.
   4. `activate`: delete old caches whose name ≠ current version.
   5. Update flow: when a new SW is waiting, show snackbar "Update available — Reload".
   6. Install prompt: store the `beforeinstallprompt` event, show the Install button in the app bar, call `prompt()` on click. On iOS show a one-time hint "Share → Add to Home Screen".
   7. Add iOS meta tags: `apple-mobile-web-app-capable`, `apple-touch-icon`, status bar style.
4. **State touched**: Cache Storage, in-memory `deferredInstallPrompt`.
5. **Edge cases & error handling**: precache failure (CDN unreachable during first install) → show "Offline mode not ready" chip and retry on next load; Service Worker unsupported (private mode) → app still works online.
6. **DOM updates**: toggle the Install button, offline-ready chip, update snackbar.

### 3.11 Settings in Auto dialog (Advanced)

1. **Trigger**: slider `input`, click `Re-analyze`.
2. **Function names**: `updateSilenceSettings(partial)`, `analyzeSilence()`
3. **Step-by-step logic**: update `state.settings` (`silenceDb` −60…−20, `minSilenceSec` 0.5…5, `minPartSec` 10…300); on `Re-analyze` run `analyzeSilence()` again using the cached peaks (no re-decode) and re-render candidates, keeping selections for ranges that still exist.
4. **State touched**: `state.settings`, `state.suggestions`.
5. **Edge cases & error handling**: extreme values producing 0 or too many candidates → same messages as 3.3.
6. **DOM updates**: slider value labels, candidate list.

---

## Appendix A — Suggested file structure

```
/index.html
/styles.css
/app.js              // UI, state, handlers
/mp3-worker.js       // indexMp3, computePeaks, cutting helpers
/sw.js
/manifest.webmanifest
/icons/icon-192.png
/icons/icon-512.png
/icons/icon-maskable-512.png
```

## Appendix B — Assumptions

- Session-only data: the part list is not persisted between app launches (can be added later with `localStorage`/IndexedDB).
- Source files are MP3 (MPEG-1/2 Layer III) only; CBR and VBR supported.
- Output keeps original audio frames (lossless cut); only a minimal ID3v2 title tag is added.
- Third split mode is not defined yet; hook point is `addPartsFromSource(source, parts)`.
