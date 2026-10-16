/**
 * MP3 Splitter PWA — Main Application Controller
 * Pure Vanilla JavaScript (ES6)
 * Follows PWA Standards & WebAPK Isolation Rules
 */

// =============================================================================
// MP3 Constants & Parsing Logic (Used directly or in Worker)
// =============================================================================
const BITRATES_MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

const SAMPLERATES = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000],  // MPEG 2.5
};

// =============================================================================
// Application State (Single Source of Truth)
// =============================================================================
const state = {
  file: null, // { name, size, buffer: ArrayBuffer }
  index: null, // { frameOffsets, frameDuration, firstFrameOffset, duration, bitrate, sampleRate, isVbr }
  peaks: null, // Float32Array of dBFS loudness values per 50ms window
  parts: [], // [{ id, name, start, end, status: 'idle'|'working'|'done'|'error', blobUrl, lastBlob }]
  suggestions: [], // [{ id, name, start, end, duration, selected }]
  settings: {
    silenceDb: -32,
    minSilenceSec: 0.35,
    minPartSec: 85,
  },
  ui: {
    loading: false,
    progress: 0,
    loadingMessage: '',
    dialog: null, // 'auto' | 'range' | 'ios' | null
    previewId: null, // part id, suggestion id, or 'whole'
    previewBlobUrl: null,
    currentTime: 0,
    isWholePlaying: false,
  },
  deletedPartStack: [],
  deferredInstallPrompt: null,
  wakeLock: null,
};

let mp3Worker = null;
let sharedAudioContext = null;
let elements = {};

// =============================================================================
// Bootstrap Entry Point
// =============================================================================
function bootstrap() {
  initElements();
  initEvents(); // Register all UI listeners immediately
  initWorker(); // Initialize worker with safe fallback
  initServiceWorker();
  initCanvasResize();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}

// =============================================================================
// Cache DOM Elements
// =============================================================================
function initElements() {
  elements = {
    // Top bar
    btnInstall: document.getElementById('btnInstall'),
    offlineChip: document.getElementById('offlineChip'),

    // Dropzone / File Picker
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    btnChooseFile: document.getElementById('btnChooseFile'),
    fileInfoSection: document.getElementById('fileInfoSection'),
    btnChangeFile: document.getElementById('btnChangeFile'),
    btnOpenFileInfo: document.getElementById('btnOpenFileInfo'),
    fileNameDisplay: document.getElementById('fileNameDisplay'),
    statDuration: document.getElementById('statDuration'),
    statBitrate: document.getElementById('statBitrate'),
    statSampleRate: document.getElementById('statSampleRate'),
    statSize: document.getElementById('statSize'),

    // File Info Dialog Elements
    fileInfoDialog: document.getElementById('fileInfoDialog'),
    btnCloseFileInfoDialog: document.getElementById('btnCloseFileInfoDialog'),
    btnDismissFileInfo: document.getElementById('btnDismissFileInfo'),
    infoModalFileName: document.getElementById('infoModalFileName'),
    infoModalDuration: document.getElementById('infoModalDuration'),
    infoModalSize: document.getElementById('infoModalSize'),
    infoModalBitrate: document.getElementById('infoModalBitrate'),
    infoModalSampleRate: document.getElementById('infoModalSampleRate'),
    infoModalFrames: document.getElementById('infoModalFrames'),
    infoModalFrameDuration: document.getElementById('infoModalFrameDuration'),

    // Loading
    loadingSection: document.getElementById('loadingSection'),
    loadingTitle: document.getElementById('loadingTitle'),
    loadingMessage: document.getElementById('loadingMessage'),
    loadingPercent: document.getElementById('loadingPercent'),
    loadingProgressBar: document.getElementById('loadingProgressBar'),

    // Waveform
    waveformCard: document.getElementById('waveformCard'),
    waveformCanvas: document.getElementById('waveformCanvas'),
    canvasWrapper: document.getElementById('canvasWrapper'),
    waveformHoverBar: document.getElementById('waveformHoverBar'),
    waveformHoverLabel: document.getElementById('waveformHoverLabel'),
    waveformPlayhead: document.getElementById('waveformPlayhead'),
    btnPlayWholeFile: document.getElementById('btnPlayWholeFile'),
    playIcon: document.getElementById('playIcon'),
    pauseIcon: document.getElementById('pauseIcon'),
    currentTimeDisplay: document.getElementById('currentTimeDisplay'),
    totalTimeDisplay: document.getElementById('totalTimeDisplay'),

    // Action Buttons
    btnOpenAuto: document.getElementById('btnOpenAuto'),
    btnOpenRange: document.getElementById('btnOpenRange'),

    // Parts List
    partsCard: document.getElementById('partsCard'),
    partsCardTitle: document.getElementById('partsCardTitle'),
    partsEmptyState: document.getElementById('partsEmptyState'),
    partsList: document.getElementById('partsList'),
    btnClearAllParts: document.getElementById('btnClearAllParts'),

    // Auto Split Dialog
    autoSplitDialog: document.getElementById('autoSplitDialog'),
    btnCloseAutoDialog: document.getElementById('btnCloseAutoDialog'),
    btnCancelAuto: document.getElementById('btnCancelAuto'),
    btnAddSelectedAuto: document.getElementById('btnAddSelectedAuto'),
    btnSelectAllSuggestions: document.getElementById('btnSelectAllSuggestions'),
    btnClearSuggestions: document.getElementById('btnClearSuggestions'),
    suggestionsList: document.getElementById('suggestionsList'),
    detectedCountLabel: document.getElementById('detectedCountLabel'),
    autoAnalyzingState: document.getElementById('autoAnalyzingState'),
    autoProgressBar: document.getElementById('autoProgressBar'),

    // Advanced settings in Auto dialog
    settingsAccordion: document.getElementById('settingsAccordion'),
    btnToggleSettings: document.getElementById('btnToggleSettings'),
    btnPresetMusic: document.getElementById('btnPresetMusic'),
    btnPresetSpeech: document.getElementById('btnPresetSpeech'),
    btnPresetLong: document.getElementById('btnPresetLong'),
    inputSilenceDb: document.getElementById('inputSilenceDb'),
    valSilenceDb: document.getElementById('valSilenceDb'),
    inputMinSilence: document.getElementById('inputMinSilence'),
    valMinSilence: document.getElementById('valMinSilence'),
    inputMinPart: document.getElementById('inputMinPart'),
    valMinPart: document.getElementById('valMinPart'),
    btnReanalyze: document.getElementById('btnReanalyze'),

    // Time Range Dialog
    rangeDialog: document.getElementById('rangeDialog'),
    btnCloseRangeDialog: document.getElementById('btnCloseRangeDialog'),
    btnCancelRange: document.getElementById('btnCancelRange'),
    btnAddPartRange: document.getElementById('btnAddPartRange'),
    inputRangeStart: document.getElementById('inputRangeStart'),
    inputRangeEnd: document.getElementById('inputRangeEnd'),
    rangeStartHelper: document.getElementById('rangeStartHelper'),
    rangeEndHelper: document.getElementById('rangeEndHelper'),
    rangeErrorAlert: document.getElementById('rangeErrorAlert'),
    chipStartFromZero: document.getElementById('chipStartFromZero'),
    chipEndAtTotal: document.getElementById('chipEndAtTotal'),

    // iOS Install Modal
    iosInstallModal: document.getElementById('iosInstallModal'),
    btnCloseIosModal: document.getElementById('btnCloseIosModal'),
    btnGotItIos: document.getElementById('btnGotItIos'),

    // Audio & Toast
    previewAudio: document.getElementById('previewAudio'),
    snackbar: document.getElementById('snackbar'),
    snackbarText: document.getElementById('snackbarText'),
    snackbarAction: document.getElementById('snackbarAction'),
  };
}

// =============================================================================
// Web Worker Initialization (with In-Thread Fallback for file:// or restricted environments)
// =============================================================================
function initWorker() {
  try {
    if (window.Worker && window.location.protocol !== 'file:') {
      mp3Worker = new Worker('./mp3-worker.js?v=11');
      mp3Worker.onmessage = handleWorkerMessage;
      mp3Worker.onerror = (err) => {
        console.warn('Worker error, switching to in-thread processing:', err);
        mp3Worker = null;
      };
    } else {
      mp3Worker = null;
    }
  } catch (err) {
    console.warn('Worker initialization caught error, using in-thread processor:', err);
    mp3Worker = null;
  }
}

function handleWorkerMessage(event) {
  const { type, index, progress, id, partName, arrayBuffer, error } = event.data;

  if (type === 'indexProgress') {
    const scaled = Math.min(50, Math.round(15 + progress * 0.35));
    updateLoadingProgress(scaled, 'Indexing audio frames (lossless)...');
  } else if (type === 'indexComplete') {
    try {
      onIndexComplete(index);
    } catch (err) {
      console.error('Error handling indexComplete:', err);
      hideLoading();
      if (elements.dropzone) elements.dropzone.classList.remove('hidden');
      if (elements.fileInput) elements.fileInput.disabled = false;
      showSnackbar('Error processing audio: ' + err.message);
    }
  } else if (type === 'sliceComplete') {
    onSliceComplete(id, partName, arrayBuffer);
  } else if (type === 'error') {
    hideLoading();
    if (!state.index) {
      elements.dropzone.classList.remove('hidden');
    }
    if (elements.fileInput) elements.fileInput.disabled = false;
    showSnackbar('Error: ' + error);
  }
}

// =============================================================================
// Service Worker Registration & PWA Standards
// =============================================================================
function initServiceWorker() {
  if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((reg) => {
        if (reg.active) {
          if (elements.offlineChip) elements.offlineChip.classList.remove('hidden');
        }

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showSnackbar('New version available — Reload to update', 'Reload', () => {
                  newWorker.postMessage({ action: 'skipWaiting' });
                  window.location.reload();
                });
              } else if (newWorker.state === 'activated') {
                if (elements.offlineChip) elements.offlineChip.classList.remove('hidden');
              }
            });
          }
        });
      })
      .catch((err) => {
        console.warn('Service Worker registration skipped or failed:', err);
      });
  }

  // PWA Install Prompt handling
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    if (elements.btnInstall) elements.btnInstall.classList.remove('hidden');
  });

  window.addEventListener('appinstalled', () => {
    state.deferredInstallPrompt = null;
    if (elements.btnInstall) elements.btnInstall.classList.add('hidden');
    showSnackbar('MP3 Splitter installed successfully!');
  });
}

// =============================================================================
// Event Handlers Setup
// =============================================================================
function initEvents() {
  // File input change
  if (elements.fileInput) {
    elements.fileInput.addEventListener('change', handleFileSelected);
  }

  // Keyboard accessibility on dropzone (Space or Enter opens picker)
  if (elements.dropzone) {
    elements.dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (elements.fileInput) elements.fileInput.click();
      }
    });

    // Drag and drop events
    elements.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      elements.dropzone.classList.add('drag-over');
    });

    elements.dropzone.addEventListener('dragleave', () => {
      elements.dropzone.classList.remove('drag-over');
    });

    elements.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      elements.dropzone.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        processSelectedFile(e.dataTransfer.files[0]);
      }
    });
  }

  // Change file button
  if (elements.btnChangeFile) {
    elements.btnChangeFile.addEventListener('click', () => {
      if (elements.fileInput) {
        elements.fileInput.value = '';
        elements.fileInput.click();
      }
    });
  }

  // Install button
  if (elements.btnInstall) {
    elements.btnInstall.addEventListener('click', handleInstallClick);
  }
  if (elements.btnCloseIosModal) {
    elements.btnCloseIosModal.addEventListener('click', () => closeDialog());
  }
  if (elements.btnGotItIos) {
    elements.btnGotItIos.addEventListener('click', () => closeDialog());
  }

  // Waveform canvas interactions
  initWaveformEvents();

  // Dialog triggers
  if (elements.btnOpenAuto) elements.btnOpenAuto.addEventListener('click', openAutoDialog);
  if (elements.btnOpenRange) elements.btnOpenRange.addEventListener('click', openRangeDialog);
  if (elements.btnOpenFileInfo) elements.btnOpenFileInfo.addEventListener('click', openFileInfoDialog);
  if (elements.btnCloseFileInfoDialog) elements.btnCloseFileInfoDialog.addEventListener('click', () => closeDialog());
  if (elements.btnDismissFileInfo) elements.btnDismissFileInfo.addEventListener('click', () => closeDialog());

  // Auto Dialog actions
  if (elements.btnCloseAutoDialog) elements.btnCloseAutoDialog.addEventListener('click', () => closeDialog());
  if (elements.btnCancelAuto) elements.btnCancelAuto.addEventListener('click', () => closeDialog());
  if (elements.btnSelectAllSuggestions) elements.btnSelectAllSuggestions.addEventListener('click', () => setAllSuggestionsSelected(true));
  if (elements.btnClearSuggestions) elements.btnClearSuggestions.addEventListener('click', () => setAllSuggestionsSelected(false));
  if (elements.btnAddSelectedAuto) elements.btnAddSelectedAuto.addEventListener('click', addSelectedSuggestions);

  // Accordion toggle
  if (elements.btnToggleSettings) {
    elements.btnToggleSettings.addEventListener('click', () => {
      elements.settingsAccordion.classList.toggle('open');
    });
  }

  // Detection Presets
  function applyDetectionPreset(db, minSil, minPart, activeBtn) {
    state.settings.silenceDb = db;
    state.settings.minSilenceSec = minSil;
    state.settings.minPartSec = minPart;

    if (elements.inputSilenceDb) {
      elements.inputSilenceDb.value = db;
      elements.valSilenceDb.textContent = `${db} dB`;
    }
    if (elements.inputMinSilence) {
      elements.inputMinSilence.value = minSil;
      elements.valMinSilence.textContent = `${minSil}s`;
    }
    if (elements.inputMinPart) {
      elements.inputMinPart.value = minPart;
      elements.valMinPart.textContent = `${minPart}s`;
    }

    [elements.btnPresetMusic, elements.btnPresetSpeech, elements.btnPresetLong].forEach((btn) => {
      if (btn) btn.classList.remove('active');
    });
    if (activeBtn) activeBtn.classList.add('active');

    analyzeSilence();
  }

  if (elements.btnPresetMusic) {
    elements.btnPresetMusic.addEventListener('click', () => {
      applyDetectionPreset(-32, 0.35, 85, elements.btnPresetMusic);
    });
  }
  if (elements.btnPresetSpeech) {
    elements.btnPresetSpeech.addEventListener('click', () => {
      applyDetectionPreset(-42, 0.80, 30, elements.btnPresetSpeech);
    });
  }
  if (elements.btnPresetLong) {
    elements.btnPresetLong.addEventListener('click', () => {
      applyDetectionPreset(-48, 1.50, 60, elements.btnPresetLong);
    });
  }

  // Settings sliders (Real-time live analysis)
  if (elements.inputSilenceDb) {
    elements.inputSilenceDb.addEventListener('input', (e) => {
      state.settings.silenceDb = parseFloat(e.target.value);
      if (elements.valSilenceDb) elements.valSilenceDb.textContent = `${state.settings.silenceDb} dB`;
      [elements.btnPresetMusic, elements.btnPresetSpeech, elements.btnPresetLong].forEach((b) => b && b.classList.remove('active'));
      analyzeSilence();
    });
  }

  if (elements.inputMinSilence) {
    elements.inputMinSilence.addEventListener('input', (e) => {
      state.settings.minSilenceSec = parseFloat(e.target.value);
      if (elements.valMinSilence) elements.valMinSilence.textContent = `${state.settings.minSilenceSec}s`;
      analyzeSilence();
    });
  }

  if (elements.inputMinPart) {
    elements.inputMinPart.addEventListener('input', (e) => {
      state.settings.minPartSec = parseFloat(e.target.value);
      if (elements.valMinPart) elements.valMinPart.textContent = `${state.settings.minPartSec}s`;
      analyzeSilence();
    });
  }

  if (elements.btnReanalyze) {
    elements.btnReanalyze.addEventListener('click', () => {
      analyzeSilence();
    });
  }

  // Range Dialog actions
  if (elements.btnCloseRangeDialog) elements.btnCloseRangeDialog.addEventListener('click', () => closeDialog());
  if (elements.btnCancelRange) elements.btnCancelRange.addEventListener('click', () => closeDialog());
  if (elements.btnAddPartRange) elements.btnAddPartRange.addEventListener('click', addRangePart);
  if (elements.inputRangeStart) elements.inputRangeStart.addEventListener('input', validateRangeInputs);
  if (elements.inputRangeEnd) elements.inputRangeEnd.addEventListener('input', validateRangeInputs);

  if (elements.chipStartFromZero) {
    elements.chipStartFromZero.addEventListener('click', () => {
      elements.inputRangeStart.value = '0';
      validateRangeInputs();
    });
  }

  if (elements.chipEndAtTotal) {
    elements.chipEndAtTotal.addEventListener('click', () => {
      if (state.index) {
        elements.inputRangeEnd.value = state.index.duration.toFixed(2);
        validateRangeInputs();
      }
    });
  }

  // Parts List actions
  if (elements.btnClearAllParts) {
    elements.btnClearAllParts.addEventListener('click', () => {
      if (state.parts.length === 0) return;
      if (confirm('Clear all parts from the list?')) {
        state.parts = [];
        renderParts();
        drawWaveform();
        showSnackbar('All parts cleared.');
      }
    });
  }

  // Shared Preview Audio events
  if (elements.previewAudio) {
    elements.previewAudio.addEventListener('timeupdate', () => {
      if (state.ui.previewId === 'whole') {
        state.ui.currentTime = elements.previewAudio.currentTime;
        updatePlayheadPosition();
        elements.currentTimeDisplay.textContent = formatTime(state.ui.currentTime);
      }
    });

    elements.previewAudio.addEventListener('ended', () => {
      stopPreview();
    });

    elements.previewAudio.addEventListener('pause', () => {
      if (state.ui.previewId === 'whole') {
        state.ui.isWholePlaying = false;
        elements.playIcon.classList.remove('hidden');
        elements.pauseIcon.classList.add('hidden');
      }
      renderParts();
      updateSuggestionPreviewButtons();
    });

    elements.previewAudio.addEventListener('play', () => {
      if (state.ui.previewId === 'whole') {
        state.ui.isWholePlaying = true;
        elements.playIcon.classList.add('hidden');
        elements.pauseIcon.classList.remove('hidden');
      }
      renderParts();
      updateSuggestionPreviewButtons();
    });
  }

  // Play/Pause whole file
  if (elements.btnPlayWholeFile) {
    elements.btnPlayWholeFile.addEventListener('click', togglePlayWholeFile);
  }

  // Close dialog on backdrop click or ESC key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDialog();
    }
  });

  [elements.autoSplitDialog, elements.rangeDialog, elements.fileInfoDialog, elements.iosInstallModal].forEach((backdrop) => {
    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          closeDialog();
        }
      });
    }
  });
}

// =============================================================================
// File Selection & MP3 Indexing
// =============================================================================
function handleFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  processSelectedFile(file);
}

async function processSelectedFile(file) {
  const isMp3 =
    file.name.toLowerCase().endsWith('.mp3') ||
    file.type === 'audio/mpeg' ||
    file.type === 'audio/mp3' ||
    file.type.includes('audio');

  if (!isMp3) {
    showSnackbar('Selected file is not recognized as an MP3 audio file.');
    return;
  }

  if (file.size > 100 * 1024 * 1024) {
    const proceed = confirm(
      'This file is larger than 100 MB. Processing might take a moment on mobile devices. Continue?'
    );
    if (!proceed) return;
  }

  stopPreview();

  // Disable interactions and prevent re-upload during processing
  if (elements.fileInput) elements.fileInput.disabled = true;
  disableActionButtons();

  // Hide dropzone, file info, and waveform cards while loading
  elements.dropzone.classList.add('hidden');
  elements.fileInfoSection.classList.add('hidden');
  elements.waveformCard.classList.add('hidden');

  state.file = {
    name: file.name,
    size: file.size,
    buffer: null,
  };
  state.index = null;
  state.peaks = null;
  state.parts = [];
  state.suggestions = [];
  state.ui.currentTime = 0;

  renderParts();

  showLoading('Reading MP3 file into memory...', `Processing "${file.name}"...`);

  try {
    const arrayBuffer = await file.arrayBuffer();
    state.file.buffer = arrayBuffer;

    updateLoadingProgress(15, 'Indexing audio frames (lossless)...');

    if (mp3Worker) {
      try {
        const workerBuffer = arrayBuffer.slice(0);
        mp3Worker.postMessage(
          {
            action: 'indexMp3',
            payload: { buffer: workerBuffer },
          },
          [workerBuffer]
        );
        return;
      } catch (workerErr) {
        console.warn('Worker postMessage failed, falling back to in-thread:', workerErr);
      }
    }

    // In-thread fallback
    setTimeout(() => {
      try {
        const indexResult = parseMp3IndexDirect(state.file.buffer, (progress) => {
          const scaled = Math.min(50, Math.round(15 + progress * 0.35));
          updateLoadingProgress(scaled, 'Indexing audio frames (lossless)...');
        });
        onIndexComplete(indexResult);
      } catch (err) {
        hideLoading();
        elements.dropzone.classList.remove('hidden');
        if (elements.fileInput) elements.fileInput.disabled = false;
        showSnackbar('Error reading MP3: ' + err.message);
      }
    }, 50);
  } catch (err) {
    console.error('File read error:', err);
    hideLoading();
    elements.dropzone.classList.remove('hidden');
    if (elements.fileInput) elements.fileInput.disabled = false;
    showSnackbar('Failed to read file: ' + err.message);
  }
}

function onIndexComplete(index) {
  state.index = index;

  if (elements.fileNameDisplay) {
    elements.fileNameDisplay.textContent = state.file.name;
    elements.fileNameDisplay.title = state.file.name;
  }
  if (elements.statDuration) {
    elements.statDuration.textContent = formatTime(index.duration);
  }
  if (elements.statBitrate) {
    elements.statBitrate.textContent = `${index.bitrate} kbps ${index.isVbr ? '(VBR)' : '(CBR)'}`;
  }
  if (elements.statSampleRate) {
    elements.statSampleRate.textContent = `${(index.sampleRate / 1000).toFixed(1)} kHz`;
  }
  if (elements.statSize) {
    elements.statSize.textContent = `${(state.file.size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (elements.totalTimeDisplay) {
    elements.totalTimeDisplay.textContent = formatTime(index.duration);
  }
  if (elements.currentTimeDisplay) {
    elements.currentTimeDisplay.textContent = '00:00.0';
  }

  // Keep cards hidden and buttons disabled until decode finishes completely
  updateLoadingProgress(50, 'Decoding audio for waveform & silence analysis...');
  computePeaks();
}

// =============================================================================
// In-Thread MP3 Indexing & Slicing Engine (Guarantees 100% Offline & File:// Support)
// =============================================================================
function parseMp3IndexDirect(buffer, onProgress) {
  const bytes = new Uint8Array(buffer);
  const totalLength = bytes.length;

  let offset = 0;
  if (
    totalLength >= 10 &&
    bytes[0] === 0x49 &&
    bytes[1] === 0x44 &&
    bytes[2] === 0x33
  ) {
    const flags = bytes[5];
    const synchsafeSize =
      ((bytes[6] & 0x7f) << 21) |
      ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) |
      (bytes[9] & 0x7f);
    const hasFooter = (flags & 0x10) !== 0;
    offset = Math.min(10 + synchsafeSize + (hasFooter ? 10 : 0), totalLength);
  }

  let capacity = 32768;
  let frameOffsets = new Uint32Array(capacity);
  let frameCount = 0;

  let firstValidFrameHeader = null;
  let firstAudioFrameIndex = 0;
  let hasXingHeader = false;
  let detectedBitrateSum = 0;
  let detectedBitrates = new Set();
  let lastProgress = -1;

  while (offset + 4 <= totalLength) {
    if (
      offset + 128 === totalLength &&
      bytes[offset] === 0x54 &&
      bytes[offset + 1] === 0x41 &&
      bytes[offset + 2] === 0x47
    ) {
      break;
    }

    const b0 = bytes[offset];
    const b1 = bytes[offset + 1];

    if (b0 === 0xff && (b1 & 0xe0) === 0xe0) {
      const b2 = bytes[offset + 2];
      const b3 = bytes[offset + 3];

      const mpegVersion = (b1 >> 3) & 0x03;
      const layer = (b1 >> 1) & 0x03;
      const protection = b1 & 0x01;
      const bitrateIdx = (b2 >> 4) & 0x0f;
      const sampleRateIdx = (b2 >> 2) & 0x03;
      const padding = (b2 >> 1) & 0x01;
      const channelMode = (b3 >> 6) & 0x03;

      if (
        mpegVersion !== 1 &&
        layer === 1 &&
        bitrateIdx > 0 &&
        bitrateIdx < 15 &&
        sampleRateIdx < 3
      ) {
        const bitrates = mpegVersion === 3 ? BITRATES_MPEG1_L3 : BITRATES_MPEG2_L3;
        const bitrateKbps = bitrates[bitrateIdx];
        const sampleRate = SAMPLERATES[mpegVersion][sampleRateIdx];

        let frameLength =
          mpegVersion === 3
            ? Math.floor((144 * bitrateKbps * 1000) / sampleRate) + padding
            : Math.floor((72 * bitrateKbps * 1000) / sampleRate) + padding;

        if (frameLength >= 4 && offset + frameLength <= totalLength) {
          if (frameCount === 0) {
            firstValidFrameHeader = {
              mpegVersion,
              sampleRate,
              samplesPerFrame: mpegVersion === 3 ? 1152 : 576,
              channelMode,
            };

            const sideInfoLen = mpegVersion === 3 ? (channelMode === 3 ? 17 : 32) : (channelMode === 3 ? 9 : 17);
            const xingOffset = offset + 4 + (protection === 0 ? 2 : 0) + sideInfoLen;

            if (xingOffset + 4 <= totalLength) {
              const x0 = bytes[xingOffset];
              const x1 = bytes[xingOffset + 1];
              const x2 = bytes[xingOffset + 2];
              const x3 = bytes[xingOffset + 3];
              if (
                (x0 === 0x58 && x1 === 0x69 && x2 === 0x6e && x3 === 0x67) ||
                (x0 === 0x49 && x1 === 0x6e && x2 === 0x66 && x3 === 0x6f)
              ) {
                hasXingHeader = true;
              }
            }
          }

          if (frameCount >= capacity) {
            capacity *= 2;
            const newOffsets = new Uint32Array(capacity);
            newOffsets.set(frameOffsets);
            frameOffsets = newOffsets;
          }

          frameOffsets[frameCount] = offset;
          frameCount++;

          detectedBitrates.add(bitrateKbps);
          detectedBitrateSum += bitrateKbps;
          offset += frameLength;

          const prog = Math.floor((offset / totalLength) * 100);
          if (prog !== lastProgress && prog % 10 === 0) {
            lastProgress = prog;
            if (onProgress) onProgress(prog);
          }
          continue;
        }
      }
    }
    offset++;
  }

  if (frameCount === 0 || !firstValidFrameHeader) {
    throw new Error('No valid MP3 audio frames found in file.');
  }

  const trimmedOffsets = frameOffsets.subarray(0, frameCount);
  if (hasXingHeader && frameCount > 1) {
    firstAudioFrameIndex = 1;
  }

  const audioFrameCount = frameCount - firstAudioFrameIndex;
  const frameDuration = firstValidFrameHeader.samplesPerFrame / firstValidFrameHeader.sampleRate;
  const duration = audioFrameCount * frameDuration;
  const avgBitrate = Math.round(detectedBitrateSum / frameCount);
  const isVbr = detectedBitrates.size > 1;

  return {
    frameCount,
    audioFrameCount,
    firstAudioFrameIndex,
    firstFrameOffset: trimmedOffsets[0],
    sampleRate: firstValidFrameHeader.sampleRate,
    frameDuration,
    duration,
    bitrate: avgBitrate,
    isVbr,
    hasXingHeader,
    frameOffsets: trimmedOffsets,
  };
}

function sliceMp3Direct({ buffer, startByte, endByte, partName }) {
  const sourceBytes = new Uint8Array(buffer);
  const safeEndByte = Math.min(endByte, sourceBytes.length);
  const safeStartByte = Math.max(0, startByte);

  if (safeEndByte <= safeStartByte) {
    throw new Error('Invalid byte slice range for split.');
  }

  const audioSlice = sourceBytes.subarray(safeStartByte, safeEndByte);
  const titleBytes = new TextEncoder().encode(partName || 'Split Part');
  const frameBodyLen = 1 + titleBytes.length;

  const frameHeader = new Uint8Array(10);
  frameHeader[0] = 0x54; // 'T'
  frameHeader[1] = 0x49; // 'I'
  frameHeader[2] = 0x54; // 'T'
  frameHeader[3] = 0x32; // '2'
  frameHeader[4] = (frameBodyLen >> 24) & 0xff;
  frameHeader[5] = (frameBodyLen >> 16) & 0xff;
  frameHeader[6] = (frameBodyLen >> 8) & 0xff;
  frameHeader[7] = frameBodyLen & 0xff;

  const totalTagBodySize = 10 + frameBodyLen;
  const id3Header = new Uint8Array(10);
  id3Header[0] = 0x49; // 'I'
  id3Header[1] = 0x44; // 'D'
  id3Header[2] = 0x33; // '3'
  id3Header[3] = 0x03; // Version 2.3
  id3Header[6] = (totalTagBodySize >> 21) & 0x7f;
  id3Header[7] = (totalTagBodySize >> 14) & 0x7f;
  id3Header[8] = (totalTagBodySize >> 7) & 0x7f;
  id3Header[9] = totalTagBodySize & 0x7f;

  const totalLength = 10 + 10 + frameBodyLen + audioSlice.length;
  const output = new Uint8Array(totalLength);

  let ptr = 0;
  output.set(id3Header, ptr);
  ptr += 10;
  output.set(frameHeader, ptr);
  ptr += 10;
  output[ptr] = 0x03; // UTF-8 indicator
  ptr += 1;
  output.set(titleBytes, ptr);
  ptr += titleBytes.length;
  output.set(audioSlice, ptr);

  return output.buffer;
}

// =============================================================================
// Waveform & Loudness Peak Computation (Accurate Web Audio Decoding)
// =============================================================================
async function computePeaks() {
  if (!state.file || !state.file.buffer || !state.index) return;

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      finishPeaksFallback();
      return;
    }

    if (!sharedAudioContext) {
      sharedAudioContext = new AudioContextClass();
    }

    const duration = state.index.duration;
    const windowSec = 0.05; // 50 ms window
    const totalWindows = Math.max(1, Math.ceil(duration / windowSec));
    const peaks = new Float32Array(totalWindows);
    peaks.fill(-60);

    updateLoadingProgress(60, 'Decoding audio for waveform & silence analysis...');

    // Attempt full buffer decode for 100% accurate PCM data and bit-reservoir continuity
    let fullAudioBuffer = null;
    try {
      fullAudioBuffer = await decodeAudioDataAsync(sharedAudioContext, state.file.buffer.slice(0));
    } catch (fullErr) {
      console.warn('Full buffer decode failed, attempting chunked decode fallback:', fullErr);
    }

    if (fullAudioBuffer) {
      const numChannels = fullAudioBuffer.numberOfChannels;
      const ch0 = fullAudioBuffer.getChannelData(0);
      const ch1 = numChannels > 1 ? fullAudioBuffer.getChannelData(1) : null;
      const sampleRate = fullAudioBuffer.sampleRate;
      const windowSizeSamples = Math.floor(sampleRate * windowSec);

      for (let w = 0; w < totalWindows; w++) {
        const startSample = w * windowSizeSamples;
        const endSample = Math.min(ch0.length, (w + 1) * windowSizeSamples);

        if (startSample >= ch0.length) {
          peaks[w] = -60;
          continue;
        }

        let sumSquares = 0;
        const count = Math.max(1, endSample - startSample);
        if (ch1) {
          for (let s = startSample; s < endSample; s++) {
            sumSquares += ch0[s] * ch0[s] + ch1[s] * ch1[s];
          }
          const rms = Math.sqrt(sumSquares / (count * 2));
          peaks[w] = Math.max(-60, 20 * Math.log10(rms + 1e-6));
        } else {
          for (let s = startSample; s < endSample; s++) {
            sumSquares += ch0[s] * ch0[s];
          }
          const rms = Math.sqrt(sumSquares / count);
          peaks[w] = Math.max(-60, 20 * Math.log10(rms + 1e-6));
        }
      }

      // Memory cleanup: release audio buffer reference immediately
      fullAudioBuffer = null;
    } else {
      // Chunk-based fallback for very constrained devices
      const chunkDuration = 30;
      const totalChunks = Math.ceil(duration / chunkDuration);
      const frameOffsets = state.index.frameOffsets;
      const frameDuration = state.index.frameDuration;

      for (let c = 0; c < totalChunks; c++) {
        const chunkStartSec = c * chunkDuration;
        const chunkEndSec = Math.min(duration, (c + 1) * chunkDuration);

        const startFrame = Math.floor(chunkStartSec / frameDuration);
        const endFrame = Math.min(frameOffsets.length, Math.ceil(chunkEndSec / frameDuration));

        if (startFrame >= frameOffsets.length) break;

        const startByte = frameOffsets[startFrame];
        const endByte = endFrame < frameOffsets.length ? frameOffsets[endFrame] : state.file.buffer.byteLength;

        if (endByte <= startByte) continue;

        try {
          const chunkBuffer = state.file.buffer.slice(startByte, endByte);
          const chunkAudio = await decodeAudioDataAsync(sharedAudioContext, chunkBuffer);
          const channelData = chunkAudio.getChannelData(0);
          const sampleRate = chunkAudio.sampleRate;
          const windowSizeSamples = Math.floor(sampleRate * windowSec);

          const chunkStartWindow = Math.floor(chunkStartSec / windowSec);
          const chunkWindows = Math.floor(chunkAudio.duration / windowSec);

          for (let w = 0; w < chunkWindows; w++) {
            const globalIdx = chunkStartWindow + w;
            if (globalIdx >= totalWindows) break;

            const startSample = w * windowSizeSamples;
            const endSample = Math.min(channelData.length, (w + 1) * windowSizeSamples);

            let sumSquares = 0;
            for (let s = startSample; s < endSample; s++) {
              sumSquares += channelData[s] * channelData[s];
            }

            const count = Math.max(1, endSample - startSample);
            const rms = Math.sqrt(sumSquares / count);
            peaks[globalIdx] = Math.max(-60, 20 * Math.log10(rms + 1e-6));
          }
        } catch (chunkErr) {
          console.warn(`Chunk ${c} decode warning:`, chunkErr);
        }
      }
    }

    // Auto-tune silence threshold based on noise floor analysis
    const validPeaks = [];
    for (let i = 0; i < peaks.length; i++) {
      if (peaks[i] > -58) validPeaks.push(peaks[i]);
    }

    if (validPeaks.length > 50) {
      validPeaks.sort((a, b) => a - b);
      const p10 = validPeaks[Math.floor(validPeaks.length * 0.10)];
      const p90 = validPeaks[Math.floor(validPeaks.length * 0.90)];

      // Keep smart threshold within realistic inter-track gap range (-42 dB to -32 dB)
      if (p90 - p10 >= 8) {
        const smartThreshold = Math.min(-32, Math.max(-42, Math.round(p10 + 6)));
        state.settings.silenceDb = smartThreshold;
        if (elements.inputSilenceDb) {
          elements.inputSilenceDb.value = smartThreshold;
          elements.valSilenceDb.textContent = `${smartThreshold} dB`;
        }
      }
    }

    state.peaks = peaks;
    updateLoadingProgress(100, 'Audio ready!');
    finalizeProcessing();
  } catch (err) {
    console.warn('Loudness peak computation failed, using synthetic envelope:', err);
    finishPeaksFallback();
  }
}

function decodeAudioDataAsync(context, arrayBuffer) {
  return new Promise((resolve, reject) => {
    context.decodeAudioData(arrayBuffer, resolve, reject);
  });
}

function finishPeaksFallback() {
  const totalWindows = Math.max(1, Math.ceil(state.index.duration / 0.05));
  const fallbackPeaks = new Float32Array(totalWindows);
  for (let i = 0; i < totalWindows; i++) {
    fallbackPeaks[i] = -30 + Math.sin(i * 0.1) * 15;
  }
  state.peaks = fallbackPeaks;
  finalizeProcessing();
}

function finalizeProcessing() {
  hideLoading();

  elements.dropzone.classList.add('hidden');
  elements.fileInfoSection.classList.remove('hidden');
  elements.waveformCard.classList.remove('hidden');

  enableActionButtons();
  if (elements.fileInput) elements.fileInput.disabled = false;

  drawWaveform();
  showSnackbar(`Ready to split "${state.file.name}"!`);
}

// =============================================================================
// Waveform Canvas Rendering & Interaction
// =============================================================================
function initCanvasResize() {
  window.addEventListener('resize', () => {
    if (state.index) {
      drawWaveform();
    }
  });
}

function drawWaveform() {
  const canvas = elements.waveformCanvas;
  if (!canvas || !state.index || !elements.canvasWrapper) return;

  const rect = elements.canvasWrapper.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;

  ctx.clearRect(0, 0, w, h);

  const peaks = state.peaks;
  if (!peaks || peaks.length === 0) return;

  const totalWindows = peaks.length;
  const barWidth = 3;
  const gap = 1;
  const step = barWidth + gap;
  const numBars = Math.floor(w / step);

  const centerY = h / 2;
  const maxBarHeight = (h - 16) / 2;

  const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const barColor = isDark ? '#D0BCFF' : '#6750A4';
  ctx.fillStyle = barColor;

  for (let b = 0; b < numBars; b++) {
    const x = b * step;
    const windowIdx = Math.floor((b / numBars) * totalWindows);
    const db = peaks[windowIdx] !== undefined ? peaks[windowIdx] : -60;

    const norm = Math.max(0.05, Math.min(1.0, (db + 60) / 60));
    const barHeight = norm * maxBarHeight;

    ctx.beginPath();
    ctx.roundRect(x, centerY - barHeight, barWidth, barHeight * 2, 2);
    ctx.fill();
  }

  state.parts.forEach((part, index) => {
    const startX = (part.start / state.index.duration) * w;
    const endX = (part.end / state.index.duration) * w;
    const partWidth = Math.max(2, endX - startX);

    ctx.fillStyle = 'rgba(125, 82, 96, 0.18)';
    ctx.fillRect(startX, 0, partWidth, h);

    ctx.strokeStyle = 'rgba(125, 82, 96, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, 0);
    ctx.lineTo(startX, h);
    ctx.moveTo(endX, 0);
    ctx.lineTo(endX, h);
    ctx.stroke();

    ctx.fillStyle = isDark ? '#FFD8E4' : '#7D5260';
    ctx.font = '600 10px Roboto, sans-serif';
    ctx.fillText(`#${index + 1} ${part.name}`, startX + 4, 14);
  });

  // Draw suggested cut lines on waveform when Auto Split dialog is open
  if (state.ui.dialog === 'auto' && state.suggestions.length > 1) {
    ctx.strokeStyle = isDark ? '#EFB8C8' : '#B3261E';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);

    for (let i = 1; i < state.suggestions.length; i++) {
      const cutSec = state.suggestions[i].start;
      const x = (cutSec / state.index.duration) * w;

      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();

      ctx.fillStyle = isDark ? '#EFB8C8' : '#B3261E';
      ctx.font = '600 9px Roboto, sans-serif';
      ctx.fillText(`✂ ${formatTime(cutSec)}`, Math.min(w - 48, x + 3), 28);
    }
    ctx.setLineDash([]);
  }
}

function initWaveformEvents() {
  const wrapper = elements.canvasWrapper;
  if (!wrapper) return;

  wrapper.addEventListener('mousemove', (e) => {
    if (!state.index) return;
    const rect = wrapper.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const ratio = x / rect.width;
    const hoverTime = ratio * state.index.duration;

    elements.waveformHoverBar.style.display = 'block';
    elements.waveformHoverBar.style.left = `${x}px`;

    elements.waveformHoverLabel.style.display = 'block';
    elements.waveformHoverLabel.style.left = `${x}px`;
    elements.waveformHoverLabel.textContent = formatTime(hoverTime);
  });

  wrapper.addEventListener('mouseleave', () => {
    elements.waveformHoverBar.style.display = 'none';
    elements.waveformHoverLabel.style.display = 'none';
  });

  wrapper.addEventListener('click', (e) => {
    if (!state.index) return;
    const rect = wrapper.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const seekTime = (x / rect.width) * state.index.duration;

    seekToTime(seekTime);
  });
}

function seekToTime(time) {
  state.ui.currentTime = Math.max(0, Math.min(state.index.duration, time));
  elements.currentTimeDisplay.textContent = formatTime(state.ui.currentTime);
  updatePlayheadPosition();

  if (state.ui.previewId === 'whole') {
    elements.previewAudio.currentTime = state.ui.currentTime;
  }
}

function updatePlayheadPosition() {
  if (!state.index) return;
  const ratio = (state.ui.currentTime / state.index.duration) * 100;
  elements.waveformPlayhead.style.left = `${ratio}%`;
}

// =============================================================================
// Auto Split (Silence Detection Logic)
// =============================================================================
function openAutoDialog() {
  if (!state.index) return;

  state.ui.dialog = 'auto';
  elements.autoSplitDialog.classList.add('open');

  analyzeSilence();
}

function analyzeSilence() {
  if (!state.peaks || !state.index) return;

  stopPreview();

  if (elements.autoAnalyzingState) elements.autoAnalyzingState.classList.remove('hidden');
  if (elements.suggestionsList) elements.suggestionsList.innerHTML = '';

  const peaks = state.peaks;
  const duration = state.index.duration;
  const windowSec = 0.05;
  const frameDuration = state.index.frameDuration;

  const thresholdDb = state.settings.silenceDb;
  const minSilenceSec = state.settings.minSilenceSec;
  const minPartSec = state.settings.minPartSec;

  const minSilenceWindows = Math.max(3, Math.round(minSilenceSec / windowSec));

  // 1. Moving Average Smoothing (3-window, ~150ms) to filter out transient pops/spikes
  const smoothed = new Float32Array(peaks.length);
  for (let i = 0; i < peaks.length; i++) {
    const prev = i > 0 ? peaks[i - 1] : peaks[i];
    const curr = peaks[i];
    const next = i < peaks.length - 1 ? peaks[i + 1] : peaks[i];
    smoothed[i] = (prev + curr + next) / 3;
  }

  // 2. Identify silent window sequences
  const silentRanges = [];
  let inSilence = false;
  let silenceStartIdx = 0;

  for (let i = 0; i < smoothed.length; i++) {
    if (smoothed[i] <= thresholdDb) {
      if (!inSilence) {
        inSilence = true;
        silenceStartIdx = i;
      }
    } else {
      if (inSilence) {
        inSilence = false;
        const silenceLen = i - silenceStartIdx;
        if (silenceLen >= minSilenceWindows) {
          // Verify that candidate silence drops into a genuine valley
          // (at least 1.5 dB below threshold, or <= -34 dB).
          let minLoudness = smoothed[silenceStartIdx];
          let minRaw = peaks[silenceStartIdx];
          for (let j = silenceStartIdx; j < i; j++) {
            if (smoothed[j] < minLoudness) minLoudness = smoothed[j];
            if (peaks[j] < minRaw) minRaw = peaks[j];
          }
          if (minLoudness <= thresholdDb - 1.5 || minLoudness <= -34.0) {
            silentRanges.push({
              startIdx: silenceStartIdx,
              endIdx: i,
              minLoudness: minLoudness,
              minRaw: minRaw,
              span: (i - silenceStartIdx) * windowSec,
            });
          }
        }
      }
    }
  }

  if (inSilence && smoothed.length - silenceStartIdx >= minSilenceWindows) {
    let minLoudness = smoothed[silenceStartIdx];
    let minRaw = peaks[silenceStartIdx];
    for (let j = silenceStartIdx; j < smoothed.length; j++) {
      if (smoothed[j] < minLoudness) minLoudness = smoothed[j];
      if (peaks[j] < minRaw) minRaw = peaks[j];
    }
    if (minLoudness <= thresholdDb - 1.5 || minLoudness <= -34.0) {
      silentRanges.push({
        startIdx: silenceStartIdx,
        endIdx: smoothed.length,
        minLoudness: minLoudness,
        minRaw: minRaw,
        span: (smoothed.length - silenceStartIdx) * windowSec,
      });
    }
  }

  // 3. Cut points: calculate precise, safe cut positions inside each silence gap
  // Placing the cut in the early-middle portion (35%) of the silence window ensures
  // the previous song's reverb tail has completely decayed, and leaves ample clean silence
  // before the next song's transient attack, so Part 1 NEVER encroaches into Song 2!
  const candidateCuts = [];
  silentRanges.forEach((range) => {
    const rangeSpan = range.span;
    const cutSec = (range.startIdx * windowSec) + rangeSpan * 0.35;

    // Snap to exact MP3 audio frame boundary
    const snappedTime = Math.round(cutSec / frameDuration) * frameDuration;

    // Discard cuts that are too close to start/end of file (< 4s)
    if (snappedTime >= 4.0 && snappedTime <= duration - 4.0) {
      candidateCuts.push({
        time: snappedTime,
        minLoudness: range.minLoudness,
        minRaw: range.minRaw,
        span: rangeSpan,
      });
    }
  });

  // 4. Cluster cuts closer than minPartSec, picking the deepest silence valley in each cluster
  const clusters = [];
  for (const cut of candidateCuts) {
    if (clusters.length === 0) {
      clusters.push([cut]);
    } else {
      const lastCluster = clusters[clusters.length - 1];
      if (cut.time - lastCluster[lastCluster.length - 1].time < minPartSec) {
        lastCluster.push(cut);
      } else {
        clusters.push([cut]);
      }
    }
  }

  const finalCuts = [];
  for (const cluster of clusters) {
    let best = cluster[0];
    for (let c = 1; c < cluster.length; c++) {
      if (
        cluster[c].minRaw < best.minRaw - 1.0 ||
        (Math.abs(cluster[c].minRaw - best.minRaw) <= 1.0 && cluster[c].minLoudness < best.minLoudness - 0.5) ||
        (Math.abs(cluster[c].minRaw - best.minRaw) <= 1.0 && Math.abs(cluster[c].minLoudness - best.minLoudness) <= 0.5 && cluster[c].span > best.span)
      ) {
        best = cluster[c];
      }
    }
    finalCuts.push(best.time);
  }

  // 5. Candidate parts between cut points
  const candidateBoundaries = [0, ...finalCuts, duration];
  const candidateParts = [];
  for (let i = 0; i < candidateBoundaries.length - 1; i++) {
    candidateParts.push({ start: candidateBoundaries[i], end: candidateBoundaries[i + 1] });
  }

  // 6. Merge edge candidates shorter than minPartSec if needed
  const filteredCandidates = [];
  for (let i = 0; i < candidateParts.length; i++) {
    const cand = candidateParts[i];
    if (filteredCandidates.length === 0) {
      if (cand.end - cand.start < minPartSec && candidateParts.length > 1) {
        candidateParts[1].start = cand.start;
        continue;
      }
      filteredCandidates.push({ ...cand });
    } else {
      if (cand.end - cand.start < minPartSec) {
        filteredCandidates[filteredCandidates.length - 1].end = cand.end;
      } else {
        filteredCandidates.push({ ...cand });
      }
    }
  }

  state.suggestions = filteredCandidates.map((cand, idx) => {
    const padNum = String(idx + 1).padStart(2, '0');
    return {
      id: 'sug_' + Date.now() + '_' + idx,
      name: `Part ${padNum}`,
      start: cand.start,
      end: cand.end,
      duration: cand.end - cand.start,
      selected: true,
    };
  });

  if (elements.autoAnalyzingState) elements.autoAnalyzingState.classList.add('hidden');
  renderSuggestions();
  drawWaveform(); // Update preview cut markers on waveform
}

function renderSuggestions() {
  const container = elements.suggestionsList;
  container.innerHTML = '';

  elements.detectedCountLabel.textContent = `${state.suggestions.length} parts detected`;

  if (state.suggestions.length === 0) {
    container.innerHTML = `
      <div style="padding: 24px; text-align: center; color: var(--md-sys-color-on-surface-variant); font-size: 0.875rem;">
        No clear silence gaps detected with current settings.<br>
        Try raising the threshold (e.g. -40 dB) or reducing min silence length in Advanced settings.
      </div>
    `;
    updateAddSelectedButton();
    return;
  }

  state.suggestions.forEach((sug) => {
    const row = document.createElement('div');
    row.className = 'suggestion-row';
    row.dataset.sugId = sug.id;
    const isPlaying = Boolean(state.ui.previewId && state.ui.previewId === sug.id);
    if (isPlaying) {
      row.classList.add('is-playing');
    }

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = sug.selected;
    checkbox.style.width = '18px';
    checkbox.style.height = '18px';
    checkbox.addEventListener('change', () => {
      sug.selected = checkbox.checked;
      updateAddSelectedButton();
    });

    const info = document.createElement('div');
    info.className = 'suggestion-info';
    info.innerHTML = `
      <div class="suggestion-name">${escapeHtml(sug.name)}</div>
      <div class="suggestion-time tabular-nums">${formatTime(sug.start)} → ${formatTime(sug.end)} (${formatTime(sug.duration)})</div>
    `;

    info.addEventListener('click', () => {
      checkbox.checked = !checkbox.checked;
      sug.selected = checkbox.checked;
      updateAddSelectedButton();
    });

    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className = 'btn-icon btn-preview-sug';
    if (isPlaying) previewBtn.classList.add('is-playing');
    previewBtn.title = isPlaying ? 'Stop preview' : 'Preview this candidate part';
    previewBtn.setAttribute('aria-label', isPlaying ? `Stop preview ${sug.name}` : `Preview ${sug.name}`);
    previewBtn.innerHTML = isPlaying
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
      : `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

    previewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePreviewSuggestion(sug);
    });

    row.appendChild(checkbox);
    row.appendChild(info);
    row.appendChild(previewBtn);
    container.appendChild(row);
  });

  updateAddSelectedButton();
}

function togglePreviewSuggestion(sug) {
  if (state.ui.previewId === sug.id) {
    stopPreview();
  } else {
    playAudioRange(sug.start, sug.end, sug.id);
  }
}

function updateSuggestionPreviewButtons() {
  if (!elements.suggestionsList) return;
  const rows = elements.suggestionsList.querySelectorAll('.suggestion-row');
  rows.forEach((row) => {
    const sugId = row.dataset.sugId;
    const isPlaying = Boolean(sugId && state.ui.previewId === sugId);
    row.classList.toggle('is-playing', isPlaying);
    const btn = row.querySelector('.btn-preview-sug');
    if (btn) {
      btn.classList.toggle('is-playing', isPlaying);
      btn.title = isPlaying ? 'Stop preview' : 'Preview this candidate part';
      btn.setAttribute('aria-label', isPlaying ? 'Stop preview' : 'Preview candidate part');
      btn.innerHTML = isPlaying
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    }
  });
}

function setAllSuggestionsSelected(selected) {
  state.suggestions.forEach((s) => (s.selected = selected));
  renderSuggestions();
}

function updateAddSelectedButton() {
  const selectedCount = state.suggestions.filter((s) => s.selected).length;
  elements.btnAddSelectedAuto.disabled = selectedCount === 0;
  elements.btnAddSelectedAuto.textContent = `Add Selected (${selectedCount})`;
}

function addSelectedSuggestions() {
  const selected = state.suggestions.filter((s) => s.selected);
  if (selected.length === 0) return;

  const existingNames = state.parts.map((p) => p.name);

  selected.forEach((sug) => {
    const uniqueName = makeUniqueName(sug.name, existingNames);
    existingNames.push(uniqueName);

    state.parts.push({
      id: 'part_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      name: uniqueName,
      start: sug.start,
      end: sug.end,
      status: 'idle',
      blobUrl: null,
      lastBlob: null,
    });
  });

  state.parts.sort((a, b) => a.start - b.start);

  closeDialog();
  renderParts();
  drawWaveform();
  showSnackbar(`Added ${selected.length} parts to split list.`);
}

// =============================================================================
// Time Range Dialog Logic
// =============================================================================
function openRangeDialog() {
  if (!state.index) return;

  state.ui.dialog = 'range';
  elements.rangeDialog.classList.add('open');

  elements.inputRangeStart.value = '0';
  elements.inputRangeEnd.value = Math.min(60, state.index.duration).toFixed(1);
  validateRangeInputs();
}

function validateRangeInputs() {
  if (!state.index) return;

  const startVal = parseFloat(elements.inputRangeStart.value);
  const endVal = parseFloat(elements.inputRangeEnd.value);
  const duration = state.index.duration;

  elements.rangeStartHelper.textContent = `Preview: ${formatTime(startVal || 0)}`;
  elements.rangeEndHelper.textContent = `Preview: ${formatTime(endVal || 0)}`;

  let errorMsg = '';

  if (isNaN(startVal) || startVal < 0) {
    errorMsg = 'Start time must be 0 or greater.';
  } else if (isNaN(endVal) || endVal > duration) {
    errorMsg = `End time cannot exceed total duration (${formatTime(duration)}).`;
  } else if (endVal <= startVal) {
    errorMsg = 'End time must be greater than start time.';
  } else if (endVal - startVal < 1.0) {
    errorMsg = 'Part duration must be at least 1.0 second.';
  }

  if (errorMsg) {
    elements.rangeErrorAlert.textContent = errorMsg;
    elements.rangeErrorAlert.classList.remove('hidden');
    elements.btnAddPartRange.disabled = true;
  } else {
    elements.rangeErrorAlert.classList.add('hidden');
    elements.btnAddPartRange.disabled = false;
  }
}

function addRangePart() {
  if (!state.index) return;

  const startSec = parseFloat(elements.inputRangeStart.value);
  const endSec = parseFloat(elements.inputRangeEnd.value);
  const frameDuration = state.index.frameDuration;

  const snappedStart = Math.floor(startSec / frameDuration) * frameDuration;
  const snappedEnd = Math.min(state.index.duration, Math.ceil(endSec / frameDuration) * frameDuration);

  const existingNames = state.parts.map((p) => p.name);
  const baseName = `Part ${String(state.parts.length + 1).padStart(2, '0')}`;
  const uniqueName = makeUniqueName(baseName, existingNames);

  state.parts.push({
    id: 'part_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
    name: uniqueName,
    start: snappedStart,
    end: snappedEnd,
    status: 'idle',
    blobUrl: null,
    lastBlob: null,
  });

  state.parts.sort((a, b) => a.start - b.start);

  closeDialog();
  renderParts();
  drawWaveform();
  showSnackbar(`Part "${uniqueName}" added.`);
}

// =============================================================================
// Parts List Rendering & Operations
// =============================================================================
function renderParts() {
  const list = elements.partsList;
  const emptyState = elements.partsEmptyState;
  const clearBtn = elements.btnClearAllParts;

  elements.partsCardTitle.textContent = `Parts to split (${state.parts.length})`;

  if (state.parts.length === 0) {
    emptyState.classList.remove('hidden');
    list.classList.add('hidden');
    clearBtn.classList.add('hidden');
    list.innerHTML = '';
    return;
  }

  emptyState.classList.add('hidden');
  list.classList.remove('hidden');
  clearBtn.classList.remove('hidden');

  list.innerHTML = '';

  state.parts.forEach((part, index) => {
    const li = document.createElement('li');
    li.className = 'part-item';
    li.id = `item_${part.id}`;

    const badge = document.createElement('div');
    badge.className = 'part-badge';
    badge.textContent = `#${index + 1}`;

    const content = document.createElement('div');
    content.className = 'part-content';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'part-name-input';
    nameInput.value = part.name;
    nameInput.maxLength = 100;
    nameInput.ariaLabel = 'Part track name';

    nameInput.addEventListener('input', (e) => {
      part.name = sanitizeFileName(e.target.value);
    });

    nameInput.addEventListener('blur', (e) => {
      let finalName = sanitizeFileName(e.target.value.trim());
      if (!finalName) {
        finalName = `Part ${String(index + 1).padStart(2, '0')}`;
      }
      const otherNames = state.parts.filter((p) => p.id !== part.id).map((p) => p.name);
      finalName = makeUniqueName(finalName, otherNames);
      part.name = finalName;
      nameInput.value = finalName;
    });

    const meta = document.createElement('div');
    meta.className = 'part-meta tabular-nums';
    const duration = part.end - part.start;
    meta.textContent = `${formatTime(part.start)} → ${formatTime(part.end)} (${formatTime(duration)})`;

    content.appendChild(nameInput);
    content.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'part-actions';

    const btnPreview = document.createElement('button');
    btnPreview.type = 'button';
    btnPreview.className = 'btn-icon';
    const isThisPreviewing = state.ui.previewId === part.id;
    if (isThisPreviewing) {
      btnPreview.classList.add('is-playing');
      li.classList.add('is-playing');
    }
    btnPreview.title = isThisPreviewing ? 'Stop preview' : 'Preview this part';
    btnPreview.ariaLabel = isThisPreviewing ? `Stop preview ${part.name}` : `Preview ${part.name}`;
    btnPreview.innerHTML = isThisPreviewing
      ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
      : `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

    btnPreview.addEventListener('click', () => {
      togglePreviewPart(part);
    });

    const btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'btn-icon';
    btnDelete.title = 'Delete part';
    btnDelete.ariaLabel = `Delete ${part.name}`;
    btnDelete.disabled = part.status === 'working';
    btnDelete.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
      </svg>
    `;
    btnDelete.addEventListener('click', () => {
      deletePart(part.id);
    });

    const btnSplit = document.createElement('button');
    btnSplit.type = 'button';
    btnSplit.className = `btn btn-primary btn-split ${part.status === 'done' ? 'done' : ''}`;
    btnSplit.disabled = part.status === 'working';

    if (part.status === 'working') {
      btnSplit.innerHTML = `<span class="spinner" aria-hidden="true"></span> <span>Splitting...</span>`;
    } else if (part.status === 'done') {
      btnSplit.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span>Download Again</span>
      `;
    } else {
      btnSplit.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="6" cy="6" r="3"/>
          <circle cx="6" cy="18" r="3"/>
          <line x1="20" y1="4" x2="8.12" y2="15.88"/>
          <line x1="14.47" y1="14.48" x2="20" y2="20"/>
          <line x1="8.12" y1="8.12" x2="12" y2="12"/>
        </svg>
        <span>Split</span>
      `;
    }

    btnSplit.addEventListener('click', () => {
      splitPart(part);
    });

    actions.appendChild(btnPreview);
    actions.appendChild(btnDelete);
    actions.appendChild(btnSplit);

    li.appendChild(badge);
    li.appendChild(content);
    li.appendChild(actions);

    list.appendChild(li);
  });
}

function deletePart(id) {
  const partIndex = state.parts.findIndex((p) => p.id === id);
  if (partIndex === -1) return;

  const deleted = state.parts[partIndex];
  if (deleted.blobUrl) {
    URL.revokeObjectURL(deleted.blobUrl);
  }

  if (state.ui.previewId === id) {
    stopPreview();
  }

  state.parts.splice(partIndex, 1);
  renderParts();
  drawWaveform();

  showSnackbar(`Deleted "${deleted.name}".`, 'Undo', () => {
    state.parts.splice(partIndex, 0, deleted);
    renderParts();
    drawWaveform();
  });
}

// =============================================================================
// Preview Audio Handling
// =============================================================================
function togglePlayWholeFile() {
  if (!state.file || !state.file.buffer) return;

  if (state.ui.isWholePlaying) {
    elements.previewAudio.pause();
    state.ui.isWholePlaying = false;
    elements.playIcon.classList.remove('hidden');
    elements.pauseIcon.classList.add('hidden');
  } else {
    if (state.ui.previewId !== 'whole') {
      const blob = new Blob([state.file.buffer], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      elements.previewAudio.src = url;
      state.ui.previewId = 'whole';
    }
    elements.previewAudio.currentTime = state.ui.currentTime;
    elements.previewAudio.play().catch(console.warn);
  }
}

function togglePreviewPart(part) {
  if (state.ui.previewId === part.id) {
    stopPreview();
  } else {
    playAudioRange(part.start, part.end, part.id);
  }
}

function playAudioRange(startSec, endSec, partId = null) {
  if (!state.file || !state.file.buffer || !state.index) return;

  stopPreview();

  const frameDuration = state.index.frameDuration;
  const frameOffsets = state.index.frameOffsets;
  const firstAudioFrameIndex = state.index.firstAudioFrameIndex || 0;

  const startFrame = Math.max(firstAudioFrameIndex, firstAudioFrameIndex + Math.floor(startSec / frameDuration));
  const endFrame = Math.min(frameOffsets.length, firstAudioFrameIndex + Math.ceil(endSec / frameDuration));

  const startByte = frameOffsets[startFrame] || 0;
  const endByte = endFrame < frameOffsets.length ? frameOffsets[endFrame] : state.file.buffer.byteLength;

  const slice = state.file.buffer.slice(startByte, endByte);
  const blob = new Blob([slice], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);

  if (state.ui.previewBlobUrl) {
    try {
      URL.revokeObjectURL(state.ui.previewBlobUrl);
    } catch (_) {}
  }
  state.ui.previewBlobUrl = url;

  elements.previewAudio.src = url;
  state.ui.previewId = partId;

  // Sync UI immediately on click
  renderParts();
  updateSuggestionPreviewButtons();

  elements.previewAudio
    .play()
    .then(() => {
      renderParts();
      updateSuggestionPreviewButtons();
    })
    .catch((err) => {
      console.warn('Playback error:', err);
      stopPreview();
      showSnackbar('Playback not allowed or audio format error.');
    });
}

function stopPreview() {
  if (elements.previewAudio && !elements.previewAudio.paused) {
    elements.previewAudio.pause();
  }
  if (elements.previewAudio) {
    elements.previewAudio.removeAttribute('src');
  }
  if (state.ui.previewBlobUrl) {
    try {
      URL.revokeObjectURL(state.ui.previewBlobUrl);
    } catch (_) {}
    state.ui.previewBlobUrl = null;
  }
  state.ui.previewId = null;
  state.ui.isWholePlaying = false;
  if (elements.playIcon) elements.playIcon.classList.remove('hidden');
  if (elements.pauseIcon) elements.pauseIcon.classList.add('hidden');
  renderParts();
  updateSuggestionPreviewButtons();
}

// =============================================================================
// Lossless MP3 Slicing & Screen Wake Lock
// =============================================================================
async function splitPart(part) {
  if (part.status === 'working') return;

  acquireWakeLock();

  part.status = 'working';
  renderParts();

  try {
    const frameOffsets = state.index.frameOffsets;
    const frameDuration = state.index.frameDuration;
    const firstAudioFrameIndex = state.index.firstAudioFrameIndex || 0;

    const startFrame = Math.max(firstAudioFrameIndex, firstAudioFrameIndex + Math.floor(part.start / frameDuration));
    const endFrame = Math.min(frameOffsets.length, firstAudioFrameIndex + Math.ceil(part.end / frameDuration));

    const startByte = frameOffsets[startFrame];
    const endByte = endFrame < frameOffsets.length ? frameOffsets[endFrame] : state.file.buffer.byteLength;

    if (mp3Worker) {
      try {
        const sliceBuffer = state.file.buffer.slice(startByte, endByte);
        mp3Worker.postMessage(
          {
            action: 'sliceMp3',
            payload: {
              buffer: sliceBuffer,
              startByte: 0,
              endByte: sliceBuffer.byteLength,
              partName: part.name,
              id: part.id,
            },
          },
          [sliceBuffer]
        );
        return;
      } catch (e) {
        console.warn('Worker slice postMessage failed, falling back to in-thread:', e);
      }
    }

    // In-thread slicing
    setTimeout(() => {
      try {
        const slicedBuffer = sliceMp3Direct({
          buffer: state.file.buffer,
          startByte,
          endByte,
          partName: part.name,
        });
        onSliceComplete(part.id, part.name, slicedBuffer);
      } catch (err) {
        part.status = 'error';
        releaseWakeLock();
        renderParts();
        showSnackbar('Failed to split part: ' + err.message);
      }
    }, 20);
  } catch (err) {
    console.error('Split error:', err);
    part.status = 'error';
    releaseWakeLock();
    renderParts();
    showSnackbar('Failed to split part: ' + err.message);
  }
}

function onSliceComplete(id, partName, arrayBuffer) {
  releaseWakeLock();

  const part = state.parts.find((p) => p.id === id);
  if (!part) return;

  const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
  part.lastBlob = blob;
  part.status = 'done';
  renderParts();

  const fileName = `${sanitizeFileName(partName)}.mp3`;
  downloadBlob(blob, fileName);
}

// =============================================================================
// Download & Web Share Fallback (Cross-Platform Mobile & Desktop)
// =============================================================================
async function downloadBlob(blob, fileName) {
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (isIOS && navigator.canShare) {
    try {
      const file = new File([blob], fileName, { type: 'audio/mpeg' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: fileName,
        });
        showSnackbar(`Shared "${fileName}".`);
        return;
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        return;
      }
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  showSnackbar(`Downloaded "${fileName}".`);

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 60000);
}

// =============================================================================
// Screen Wake Lock API Helpers
// =============================================================================
async function acquireWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => {
        state.wakeLock = null;
      });
    } catch (err) {
      console.warn('Wake Lock request error:', err);
    }
  }
}

function releaseWakeLock() {
  if (state.wakeLock) {
    state.wakeLock.release().catch(console.warn);
    state.wakeLock = null;
  }
}

// =============================================================================
// Install PWA Action
// =============================================================================
async function handleInstallClick() {
  if (state.deferredInstallPrompt) {
    state.deferredInstallPrompt.prompt();
    const { outcome } = await state.deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      elements.btnInstall.classList.add('hidden');
    }
    state.deferredInstallPrompt = null;
  } else {
    state.ui.dialog = 'ios';
    elements.iosInstallModal.classList.add('open');
  }
}

// =============================================================================
// Dialog & UI State Helpers
// =============================================================================
function openFileInfoDialog() {
  if (!state.file || !state.index) return;

  state.ui.dialog = 'fileInfo';

  const index = state.index;
  const file = state.file;

  if (elements.infoModalFileName) {
    elements.infoModalFileName.textContent = file.name;
    elements.infoModalFileName.title = file.name;
  }
  if (elements.infoModalDuration) {
    elements.infoModalDuration.textContent = `${formatTime(index.duration)} (${index.duration.toFixed(1)}s)`;
  }
  if (elements.infoModalSize) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    elements.infoModalSize.textContent = `${sizeMb} MB (${file.size.toLocaleString()} bytes)`;
  }
  if (elements.infoModalBitrate) {
    elements.infoModalBitrate.textContent = `${index.bitrate} kbps ${index.isVbr ? '(Variable Bitrate / VBR)' : '(Constant Bitrate / CBR)'}`;
  }
  if (elements.infoModalSampleRate) {
    elements.infoModalSampleRate.textContent = `${index.sampleRate.toLocaleString()} Hz (${(index.sampleRate / 1000).toFixed(1)} kHz)`;
  }
  if (elements.infoModalFrames) {
    const frameCount = index.audioFrameCount || index.frameCount || 0;
    elements.infoModalFrames.textContent = `${frameCount.toLocaleString()} audio frames`;
  }
  if (elements.infoModalFrameDuration) {
    elements.infoModalFrameDuration.textContent = `${(index.frameDuration * 1000).toFixed(2)} ms / frame`;
  }

  if (elements.fileInfoDialog) {
    elements.fileInfoDialog.classList.add('open');
  }
}

function closeDialog() {
  if (elements.autoSplitDialog) elements.autoSplitDialog.classList.remove('open');
  if (elements.rangeDialog) elements.rangeDialog.classList.remove('open');
  if (elements.fileInfoDialog) elements.fileInfoDialog.classList.remove('open');
  if (elements.iosInstallModal) elements.iosInstallModal.classList.remove('open');
  state.ui.dialog = null;
  if (state.ui.previewId) {
    stopPreview();
  }
  drawWaveform();
}

function showLoading(message, title = null) {
  state.ui.loading = true;
  if (elements.loadingSection) elements.loadingSection.classList.remove('hidden');
  if (elements.loadingTitle && title) {
    elements.loadingTitle.textContent = title;
  }
  if (elements.loadingMessage) elements.loadingMessage.textContent = message;
  if (elements.loadingPercent) elements.loadingPercent.textContent = '0%';
  if (elements.loadingProgressBar) elements.loadingProgressBar.style.width = '0%';
}

function updateLoadingProgress(percent, message) {
  const safePercent = Math.min(100, Math.max(0, Math.round(percent)));
  if (elements.loadingPercent) elements.loadingPercent.textContent = `${safePercent}%`;
  if (elements.loadingProgressBar) elements.loadingProgressBar.style.width = `${safePercent}%`;
  if (message && elements.loadingMessage) {
    elements.loadingMessage.textContent = message;
  }
}

function hideLoading() {
  state.ui.loading = false;
  if (elements.loadingSection) elements.loadingSection.classList.add('hidden');
}

function enableActionButtons() {
  if (elements.btnOpenAuto) elements.btnOpenAuto.disabled = false;
  if (elements.btnOpenRange) elements.btnOpenRange.disabled = false;
  if (elements.btnOpenFileInfo) elements.btnOpenFileInfo.disabled = false;
  if (elements.btnPlayWholeFile) elements.btnPlayWholeFile.disabled = false;
  if (elements.btnChangeFile) elements.btnChangeFile.style.pointerEvents = 'auto';
}

function disableActionButtons() {
  if (elements.btnOpenAuto) elements.btnOpenAuto.disabled = true;
  if (elements.btnOpenRange) elements.btnOpenRange.disabled = true;
  if (elements.btnOpenFileInfo) elements.btnOpenFileInfo.disabled = true;
  if (elements.btnPlayWholeFile) elements.btnPlayWholeFile.disabled = true;
  if (elements.btnChangeFile) elements.btnChangeFile.style.pointerEvents = 'none';
}

let snackbarTimer = null;
function showSnackbar(text, actionLabel = null, actionCallback = null) {
  clearTimeout(snackbarTimer);

  elements.snackbarText.textContent = text;

  if (actionLabel && actionCallback) {
    elements.snackbarAction.textContent = actionLabel;
    elements.snackbarAction.classList.remove('hidden');
    elements.snackbarAction.onclick = () => {
      elements.snackbar.classList.remove('show');
      actionCallback();
    };
  } else {
    elements.snackbarAction.classList.add('hidden');
  }

  elements.snackbar.classList.add('show');

  snackbarTimer = setTimeout(() => {
    elements.snackbar.classList.remove('show');
  }, 4500);
}

// =============================================================================
// String & Time Formatting Utilities
// =============================================================================
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00.0';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const mStr = String(mins).padStart(2, '0');
  const sStr = secs.toFixed(1).padStart(4, '0');
  return `${mStr}:${sStr}`;
}

function sanitizeFileName(name) {
  if (!name) return 'Part';
  let clean = name.replace(/[\\/:*?"<>|]/g, '').trim();
  clean = clean.replace(/\s+/g, ' ');
  return clean.slice(0, 100) || 'Part';
}

function makeUniqueName(baseName, existingNames) {
  let name = baseName;
  let counter = 2;
  const lowerExisting = existingNames.map((n) => n.toLowerCase());

  while (lowerExisting.includes(name.toLowerCase())) {
    name = `${baseName} (${counter})`;
    counter++;
  }
  return name;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
