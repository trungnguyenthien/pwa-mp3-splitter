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
  metadata: {
    artist: '',
    album: '',
    year: '',
    coverBytes: null,
    coverMime: null,
    coverDataUrl: null,
    isOriginalCoverUrl: false,
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
    fileCoverThumbnail: document.getElementById('fileCoverThumbnail'),
    fileCoverImg: document.getElementById('fileCoverImg'),
    fileDefaultIcon: document.getElementById('fileDefaultIcon'),
    btnChangeFile: document.getElementById('btnChangeFile'),
    btnOpenEditTags: document.getElementById('btnOpenEditTags'),
    btnOpenFileInfo: document.getElementById('btnOpenFileInfo'),
    fileNameDisplay: document.getElementById('fileNameDisplay'),
    fileSubtext: document.getElementById('fileSubtext'),
    statDuration: document.getElementById('statDuration'),
    statBitrate: document.getElementById('statBitrate'),
    statSampleRate: document.getElementById('statSampleRate'),
    statSize: document.getElementById('statSize'),

    // Edit Tags Dialog Elements
    editTagsModal: document.getElementById('editTagsModal'),
    btnCloseEditTagsDialog: document.getElementById('btnCloseEditTagsDialog'),
    btnCancelEditTags: document.getElementById('btnCancelEditTags'),
    btnSaveTags: document.getElementById('btnSaveTags'),
    modalCoverBox: document.getElementById('modalCoverBox'),
    modalCoverImg: document.getElementById('modalCoverImg'),
    modalCoverPlaceholder: document.getElementById('modalCoverPlaceholder'),
    coverArtFileInput: document.getElementById('coverArtFileInput'),
    btnUploadCoverArt: document.getElementById('btnUploadCoverArt'),
    btnRemoveCoverArt: document.getElementById('btnRemoveCoverArt'),
    inputTagArtist: document.getElementById('inputTagArtist'),
    inputTagAlbum: document.getElementById('inputTagAlbum'),
    inputTagYear: document.getElementById('inputTagYear'),

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

    // Time Range Dialog & Time Wheel Spinner
    rangeDialog: document.getElementById('rangeDialog'),
    btnCloseRangeDialog: document.getElementById('btnCloseRangeDialog'),
    btnCancelRange: document.getElementById('btnCancelRange'),
    btnAddPartRange: document.getElementById('btnAddPartRange'),
    cardRangeStart: document.getElementById('cardRangeStart'),
    cardRangeEnd: document.getElementById('cardRangeEnd'),
    inputRangeStart: document.getElementById('inputRangeStart'),
    inputRangeEnd: document.getElementById('inputRangeEnd'),
    rangeStartHelper: document.getElementById('rangeStartHelper'),
    rangeEndHelper: document.getElementById('rangeEndHelper'),
    rangeDurationPill: document.getElementById('rangeDurationPill'),
    rangeDurationText: document.getElementById('rangeDurationText'),
    rangeErrorAlert: document.getElementById('rangeErrorAlert'),
    chipStartFromZero: document.getElementById('chipStartFromZero'),
    chipEndAtTotal: document.getElementById('chipEndAtTotal'),
    timeWheelContainer: document.getElementById('timeWheelContainer'),
    wheelTargetText: document.getElementById('wheelTargetText'),
    timeWheelViewport: document.getElementById('timeWheelViewport'),
    timeWheelTrack: document.getElementById('timeWheelTrack'),
    btnWheelStepMinus10: document.getElementById('btnWheelStepMinus10'),
    btnWheelStepMinus1: document.getElementById('btnWheelStepMinus1'),
    btnWheelStepPlus1: document.getElementById('btnWheelStepPlus1'),
    btnWheelStepPlus10: document.getElementById('btnWheelStepPlus10'),

    // iOS Install Modal
    iosInstallModal: document.getElementById('iosInstallModal'),
    btnCloseIosModal: document.getElementById('btnCloseIosModal'),
    btnGotItIos: document.getElementById('btnGotItIos'),

    // Format Error Modal
    formatErrorModal: document.getElementById('formatErrorModal'),
    formatModalMessage: document.getElementById('formatModalMessage'),
    btnCloseFormatModal: document.getElementById('btnCloseFormatModal'),
    btnDismissFormatModal: document.getElementById('btnDismissFormatModal'),
    btnChooseMp3Instead: document.getElementById('btnChooseMp3Instead'),

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
      mp3Worker = new Worker('./mp3-worker.js?v=31');
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
    
    if (
      error &&
      (error.includes('M4A') ||
        error.includes('WAV') ||
        error.includes('FLAC') ||
        error.includes('OGG') ||
        error.includes('incompatible') ||
        error.includes('density') ||
        error.includes('not a valid MP3'))
    ) {
      showFormatErrorModal(state.file ? state.file.name : 'Selected file', 'Incompatible Format', error);
    } else {
      showSnackbar('Error: ' + error);
    }
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

  // Standalone display mode check (PWA already running installed)
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // If already running in standalone mode, guarantee install button is hidden
  if (isStandalone && elements.btnInstall) {
    elements.btnInstall.classList.add('hidden');
  } else if (isIOS && elements.btnInstall) {
    // iOS Safari does not support beforeinstallprompt; show button to open instructions modal
    elements.btnInstall.classList.remove('hidden');
  }

  // PWA Install Prompt handling (Android Chrome / Desktop)
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    if (!isStandalone && elements.btnInstall) {
      elements.btnInstall.classList.remove('hidden');
    }
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

  // Format Error Modal triggers
  if (elements.btnCloseFormatModal) {
    elements.btnCloseFormatModal.addEventListener('click', () => closeDialog());
  }
  if (elements.btnDismissFormatModal) {
    elements.btnDismissFormatModal.addEventListener('click', () => closeDialog());
  }
  if (elements.btnChooseMp3Instead) {
    elements.btnChooseMp3Instead.addEventListener('click', () => {
      closeDialog();
      if (elements.fileInput) {
        elements.fileInput.value = '';
        elements.fileInput.click();
      }
    });
  }

  // Waveform canvas interactions
  initWaveformEvents();

  // Dialog triggers
  if (elements.btnOpenAuto) elements.btnOpenAuto.addEventListener('click', openAutoDialog);
  if (elements.btnOpenRange) elements.btnOpenRange.addEventListener('click', openRangeDialog);
  if (elements.btnOpenEditTags) elements.btnOpenEditTags.addEventListener('click', openEditTagsDialog);
  if (elements.fileCoverThumbnail) elements.fileCoverThumbnail.addEventListener('click', openEditTagsDialog);
  if (elements.btnCloseEditTagsDialog) elements.btnCloseEditTagsDialog.addEventListener('click', () => closeDialog());
  if (elements.btnCancelEditTags) elements.btnCancelEditTags.addEventListener('click', () => closeDialog());
  if (elements.btnSaveTags) elements.btnSaveTags.addEventListener('click', saveEditTags);
  if (elements.modalCoverBox) elements.modalCoverBox.addEventListener('click', () => {
    if (elements.coverArtFileInput) elements.coverArtFileInput.click();
  });
  if (elements.btnUploadCoverArt) elements.btnUploadCoverArt.addEventListener('click', () => {
    if (elements.coverArtFileInput) elements.coverArtFileInput.click();
  });
  if (elements.btnRemoveCoverArt) elements.btnRemoveCoverArt.addEventListener('click', removeCoverArtInModal);
  if (elements.coverArtFileInput) {
    elements.coverArtFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        processCoverImageFile(e.target.files[0]);
      }
    });
  }

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

  // Range Dialog & Time Wheel actions
  if (elements.btnCloseRangeDialog) elements.btnCloseRangeDialog.addEventListener('click', () => closeDialog());
  if (elements.btnCancelRange) elements.btnCancelRange.addEventListener('click', () => closeDialog());
  if (elements.btnAddPartRange) elements.btnAddPartRange.addEventListener('click', addRangePart);

  // Dual Touch Cards for Start & End Time
  if (elements.cardRangeStart) {
    elements.cardRangeStart.addEventListener('click', () => openTimeWheel('start'));
  }
  if (elements.cardRangeEnd) {
    elements.cardRangeEnd.addEventListener('click', () => openTimeWheel('end'));
  }

  if (elements.inputRangeStart) {
    elements.inputRangeStart.addEventListener('focus', () => openTimeWheel('start'));
    elements.inputRangeStart.addEventListener('click', (e) => {
      e.stopPropagation();
      openTimeWheel('start');
    });
    elements.inputRangeStart.addEventListener('input', () => {
      validateRangeInputs();
      updateWheelBadges();
      if (activeWheelTarget === 'start') {
        const val = parseTimeToSeconds(elements.inputRangeStart.value);
        if (!isNaN(val)) {
          scrollToWheelSec(Math.round(val), 'smooth');
        }
      }
    });
    elements.inputRangeStart.addEventListener('blur', () => {
      const val = parseTimeToSeconds(elements.inputRangeStart.value);
      if (!isNaN(val)) {
        elements.inputRangeStart.value = formatMmSs(val);
      }
      validateRangeInputs();
      updateWheelBadges();
    });
  }

  if (elements.inputRangeEnd) {
    elements.inputRangeEnd.addEventListener('focus', () => openTimeWheel('end'));
    elements.inputRangeEnd.addEventListener('click', (e) => {
      e.stopPropagation();
      openTimeWheel('end');
    });
    elements.inputRangeEnd.addEventListener('input', () => {
      validateRangeInputs();
      updateWheelBadges();
      if (activeWheelTarget === 'end') {
        const val = parseTimeToSeconds(elements.inputRangeEnd.value);
        if (!isNaN(val)) {
          scrollToWheelSec(Math.round(val), 'smooth');
        }
      }
    });
    elements.inputRangeEnd.addEventListener('blur', () => {
      const val = parseTimeToSeconds(elements.inputRangeEnd.value);
      if (!isNaN(val)) {
        elements.inputRangeEnd.value = formatMmSs(val);
      }
      validateRangeInputs();
      updateWheelBadges();
    });
  }

  if (elements.btnWheelStepMinus10) elements.btnWheelStepMinus10.addEventListener('click', () => stepWheel(-10));
  if (elements.btnWheelStepMinus1) elements.btnWheelStepMinus1.addEventListener('click', () => stepWheel(-1));
  if (elements.btnWheelStepPlus1) elements.btnWheelStepPlus1.addEventListener('click', () => stepWheel(1));
  if (elements.btnWheelStepPlus10) elements.btnWheelStepPlus10.addEventListener('click', () => stepWheel(10));

  if (elements.timeWheelViewport) {
    elements.timeWheelViewport.addEventListener('scroll', onWheelViewportScroll, { passive: true });

    elements.timeWheelViewport.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) >= 12) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dir = e.deltaY > 0 ? 1 : -1;
        stepWheel(dir * step);
      }
    }, { passive: false });

    elements.timeWheelViewport.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        stepWheel(e.shiftKey ? -10 : -1);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        stepWheel(e.shiftKey ? 10 : 1);
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        stepWheel(-10);
      } else if (e.key === 'PageDown') {
        e.preventDefault();
        stepWheel(10);
      }
    });
  }

  if (elements.timeWheelTrack) {
    elements.timeWheelTrack.addEventListener('click', (e) => {
      const item = e.target.closest('.wheel-item');
      if (!item) return;
      const sec = parseInt(item.dataset.sec, 10);
      if (!isNaN(sec)) {
        const targetInput = activeWheelTarget === 'start' ? elements.inputRangeStart : elements.inputRangeEnd;
        if (targetInput) {
          targetInput.value = formatMmSs(sec);
          validateRangeInputs();
          updateWheelBadges();
          scrollToWheelSec(sec, 'smooth');
        }
      }
    });
  }

  if (elements.chipStartFromZero) {
    elements.chipStartFromZero.addEventListener('click', () => {
      if (elements.inputRangeStart) {
        elements.inputRangeStart.value = '00:00';
        openTimeWheel('start');
        validateRangeInputs();
        updateWheelBadges();
        scrollToWheelSec(0, 'smooth');
      }
    });
  }

  if (elements.chipEndAtTotal) {
    elements.chipEndAtTotal.addEventListener('click', () => {
      if (elements.inputRangeEnd && state.index) {
        elements.inputRangeEnd.value = formatMmSs(state.index.duration);
        openTimeWheel('end');
        validateRangeInputs();
        updateWheelBadges();
        scrollToWheelSec(Math.round(state.index.duration), 'smooth');
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

  [elements.autoSplitDialog, elements.rangeDialog, elements.fileInfoDialog, elements.iosInstallModal, elements.formatErrorModal].forEach((backdrop) => {
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
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const isMp3Ext = ext === 'mp3';

  if (!isMp3Ext && file.name.includes('.')) {
    const formatNames = {
      m4a: 'M4A / AAC (Apple Audio)',
      aac: 'AAC Audio Stream',
      wav: 'WAV (Waveform Audio)',
      flac: 'FLAC (Lossless Audio)',
      ogg: 'OGG (Vorbis/Opus)',
      wma: 'WMA Audio',
      mp4: 'MP4 Media Container',
      webm: 'WebM Audio',
      m4r: 'M4R iPhone Ringtone',
      aiff: 'AIFF Audio',
    };
    const detectedFormat = formatNames[ext] || `.${ext.toUpperCase()} Audio`;
    showFormatErrorModal(
      file.name,
      detectedFormat,
      `You selected a file ending with <strong>.${ext}</strong>. MP3 Splitter is a lossless frame cutter strictly designed for <strong>.mp3</strong> files. Slicing non-MP3 files results in false duration calculations (e.g. only a few seconds) and broken audio files. Please convert this file to .mp3 and try again.`
    );
    if (elements.fileInput) elements.fileInput.value = '';
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

  // Reset metadata
  if (state.metadata && state.metadata.coverDataUrl) {
    try { URL.revokeObjectURL(state.metadata.coverDataUrl); } catch (_) {}
  }
  state.metadata = {
    artist: '',
    album: '',
    year: '',
    coverBytes: null,
    coverMime: null,
    coverDataUrl: null,
    isOriginalCoverUrl: false,
  };
  updateMainCardCoverView();

  renderParts();

  showLoading('Reading audio file into memory...', `Processing "${file.name}"...`);

  try {
    const arrayBuffer = await file.arrayBuffer();

    // Check magic bytes before passing to worker/indexing
    const formatCheck = detectAudioFileType(arrayBuffer, file.name);
    if (!formatCheck.isSupported) {
      hideLoading();
      elements.dropzone.classList.remove('hidden');
      if (elements.fileInput) {
        elements.fileInput.disabled = false;
        elements.fileInput.value = '';
      }
      showFormatErrorModal(
        file.name,
        formatCheck.format,
        `File header contains <strong>${escapeHtml(formatCheck.format)}</strong> signatures. MP3 Splitter currently supports .mp3 and .m4a audio files.`
      );
      return;
    }

    state.file.buffer = arrayBuffer;

    // Extract embedded tags and cover art if available
    try {
      const extracted = formatCheck.isM4a ? extractM4aMetadata(arrayBuffer) : extractMp3Metadata(arrayBuffer);
      if (extracted) {
        if (extracted.artist) state.metadata.artist = extracted.artist;
        if (extracted.album) state.metadata.album = extracted.album;
        if (extracted.year) state.metadata.year = extracted.year;
        if (extracted.coverBytes && extracted.coverBytes.length > 0) {
          state.metadata.coverBytes = extracted.coverBytes;
          state.metadata.coverMime = extracted.coverMime || 'image/jpeg';
          state.metadata.coverDataUrl = URL.createObjectURL(new Blob([extracted.coverBytes], { type: state.metadata.coverMime }));
          state.metadata.isOriginalCoverUrl = true;
        }
      }
    } catch (tagErr) {
      console.warn('Metadata extraction non-fatal warning:', tagErr);
    }
    updateMainCardCoverView();

    updateLoadingProgress(15, 'Indexing audio frames (lossless)...');

    if (mp3Worker) {
      try {
        const workerBuffer = arrayBuffer.slice(0);
        mp3Worker.postMessage(
          {
            action: 'indexAudio',
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
        let indexResult;
        if (formatCheck.isM4a) {
          indexResult = parseM4aIndexDirect(state.file.buffer);
        } else {
          indexResult = parseMp3IndexDirect(state.file.buffer, (progress) => {
            const scaled = Math.min(50, Math.round(15 + progress * 0.35));
            updateLoadingProgress(scaled, 'Indexing audio frames (lossless)...');
          });
        }
        onIndexComplete(indexResult);
      } catch (err) {
        hideLoading();
        elements.dropzone.classList.remove('hidden');
        if (elements.fileInput) elements.fileInput.disabled = false;
        showSnackbar('Error reading audio: ' + err.message);
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

  // Fast-path: Worker already computed instant frame peaks (zero-PCM memory, zero-OOM crash on mobile)
  if (index.peaks && index.peaks.length > 0) {
    state.peaks = index.peaks;
    applySmartSilenceThreshold(state.peaks);
    updateLoadingProgress(100, 'Audio ready!');
    finalizeProcessing();
    return;
  }

  updateLoadingProgress(60, 'Computing waveform...');
  computePeaks();
}

// =============================================================================
// Audio File Signature & Container Detection
// =============================================================================
function detectAudioFileType(buffer, fileName = '') {
  if (buffer && buffer.byteLength >= 8) {
    const bytes = new Uint8Array(buffer, 0, Math.min(128, buffer.byteLength));

    // M4A / MP4: "ftyp" box (Apple MPEG-4 AAC/ALAC)
    if (
      (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) ||
      (bytes[0] === 0x66 && bytes[1] === 0x74 && bytes[2] === 0x79 && bytes[3] === 0x70)
    ) {
      return { isSupported: true, isMp3: false, isM4a: true, format: 'M4A' };
    }

    // WAV: "RIFF" ... "WAVE"
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      return { isSupported: false, isMp3: false, isM4a: false, format: 'WAV (Waveform Audio)' };
    }

    // FLAC: "fLaC"
    if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) {
      return { isSupported: false, isMp3: false, isM4a: false, format: 'FLAC (Lossless Audio)' };
    }

    // OGG: "OggS"
    if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
      return { isSupported: false, isMp3: false, isM4a: false, format: 'OGG (Vorbis/Opus Audio)' };
    }

    // WebM / Matroska
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
      return { isSupported: false, isMp3: false, isM4a: false, format: 'WebM / Opus Audio' };
    }
  }

  const ext = (fileName.split('.').pop() || '').toLowerCase();
  if (ext === 'm4a') {
    return { isSupported: true, isMp3: false, isM4a: true, format: 'M4A' };
  }
  if (ext && ext !== 'mp3') {
    const knownFormats = {
      aac: 'AAC Audio Stream',
      wav: 'WAV Audio',
      flac: 'FLAC Lossless Audio',
      ogg: 'OGG Vorbis/Opus Audio',
      wma: 'WMA Audio',
      mp4: 'MP4 Video/Audio',
      webm: 'WebM Audio',
      m4r: 'M4R iPhone Ringtone',
      aiff: 'AIFF Audio',
    };
    return { isSupported: false, isMp3: false, isM4a: false, format: knownFormats[ext] || `.${ext.toUpperCase()} Audio` };
  }

  return { isSupported: true, isMp3: true, isM4a: false, format: 'MP3' };
}

// =============================================================================
// In-Thread MP3 Indexing & Slicing Engine (Guarantees 100% Offline & File:// Support)
// =============================================================================
function parseMp3IndexDirect(buffer, onProgress) {
  const bytes = new Uint8Array(buffer);
  const totalLength = bytes.length;

  // Fast signature check for non-MP3 audio containers
  if (totalLength >= 8) {
    if (
      (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) ||
      (bytes[0] === 0x66 && bytes[1] === 0x74 && bytes[2] === 0x79 && bytes[3] === 0x70)
    ) {
      throw new Error(
        'Selected file is in M4A/AAC format (MPEG-4 container), not MP3. MP3 Splitter is a lossless cutter exclusively designed for .mp3 audio frames.'
      );
    }
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      throw new Error(
        'Selected file is in WAV format, not MP3. MP3 Splitter is a lossless cutter exclusively designed for .mp3 audio frames.'
      );
    }
    if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) {
      throw new Error(
        'Selected file is in FLAC format, not MP3. MP3 Splitter is a lossless cutter exclusively designed for .mp3 audio frames.'
      );
    }
    if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
      throw new Error(
        'Selected file is in OGG format, not MP3. MP3 Splitter is a lossless cutter exclusively designed for .mp3 audio frames.'
      );
    }
  }

  let offset = 0;
  let id3Size = 0;
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
    id3Size = 10 + synchsafeSize + (hasFooter ? 10 : 0);
    offset = Math.min(10 + synchsafeSize + (hasFooter ? 10 : 0), totalLength);
  }

  let capacity = 32768;
  let frameOffsets = new Uint32Array(capacity);
  let frameCount = 0;
  let totalFrameBytes = 0;

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
          totalFrameBytes += frameLength;

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

  const audioDataBytes = Math.max(1, totalLength - id3Size);
  const coverageRatio = totalFrameBytes / audioDataBytes;

  if (frameCount < 5 || coverageRatio < 0.45) {
    throw new Error(
      `File appears to be an incompatible audio format or corrupted MP3. Only ${frameCount} isolated frames found (${(coverageRatio * 100).toFixed(1)}% MP3 frame density). Please use a valid .mp3 file.`
    );
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

  const peaks = computeMp3PeaksFromFrames(bytes, trimmedOffsets, trimmedOffsets.length, duration);

  return {
    format: 'mp3',
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
    peaks,
  };
}

function sliceMp3Direct({ buffer, startByte, endByte, partName, metadata }) {
  const sourceBytes = new Uint8Array(buffer);
  const safeEndByte = Math.min(endByte, sourceBytes.length);
  const safeStartByte = Math.max(0, startByte);

  if (safeEndByte <= safeStartByte) {
    throw new Error('Invalid byte slice range for split.');
  }

  const audioSlice = sourceBytes.subarray(safeStartByte, safeEndByte);
  const meta = Object.assign({}, metadata);
  if (!meta.title) meta.title = partName || 'Split Part';
  const id3Tag = makeId3v2Tag(meta);

  const totalLength = id3Tag.length + audioSlice.length;
  const output = new Uint8Array(totalLength);
  output.set(id3Tag, 0);
  output.set(audioSlice, id3Tag.length);

  return output.buffer;
}

function makeId3v2Tag({ title, artist, album, year, imageBytes, imageMime }) {
  const frames = [];

  function addTextFrame(id, text) {
    if (!text) return;
    const strBytes = new TextEncoder().encode(text);
    const bodyLen = 1 + strBytes.length; // 0x03 (UTF-8) + text
    const frame = new Uint8Array(10 + bodyLen);
    for (let i = 0; i < 4; i++) frame[i] = id.charCodeAt(i);
    frame[4] = (bodyLen >> 24) & 0xff;
    frame[5] = (bodyLen >> 16) & 0xff;
    frame[6] = (bodyLen >> 8) & 0xff;
    frame[7] = bodyLen & 0xff;
    frame[8] = 0;
    frame[9] = 0;
    frame[10] = 0x03; // UTF-8 indicator
    frame.set(strBytes, 11);
    frames.push(frame);
  }

  addTextFrame('TIT2', title);
  addTextFrame('TPE1', artist);
  addTextFrame('TALB', album);
  if (year) addTextFrame('TYER', String(year));

  if (imageBytes && imageBytes.length > 0) {
    const mime = imageMime || 'image/jpeg';
    const mimeBytes = new TextEncoder().encode(mime);
    const bodyLen = 1 + mimeBytes.length + 1 + 1 + 1 + imageBytes.length;
    const frame = new Uint8Array(10 + bodyLen);
    frame[0] = 0x41; frame[1] = 0x50; frame[2] = 0x49; frame[3] = 0x43; // APIC
    frame[4] = (bodyLen >> 24) & 0xff;
    frame[5] = (bodyLen >> 16) & 0xff;
    frame[6] = (bodyLen >> 8) & 0xff;
    frame[7] = bodyLen & 0xff;
    frame[8] = 0;
    frame[9] = 0;

    let p = 10;
    frame[p++] = 0x00; // ISO-8859-1 for mime/description
    frame.set(mimeBytes, p);
    p += mimeBytes.length;
    frame[p++] = 0x00; // null terminator for MIME
    frame[p++] = 0x03; // Picture Type: 0x03 = Cover (front)
    frame[p++] = 0x00; // empty description null terminator
    frame.set(imageBytes, p);
    frames.push(frame);
  }

  let totalFramesLen = 0;
  for (const f of frames) totalFramesLen += f.length;

  const header = new Uint8Array(10);
  header[0] = 0x49; header[1] = 0x44; header[2] = 0x33; // ID3
  header[3] = 0x03; // v2.3.0
  header[4] = 0x00;
  header[5] = 0x00; // flags
  header[6] = (totalFramesLen >> 21) & 0x7f;
  header[7] = (totalFramesLen >> 14) & 0x7f;
  header[8] = (totalFramesLen >> 7) & 0x7f;
  header[9] = totalFramesLen & 0x7f;

  const out = new Uint8Array(10 + totalFramesLen);
  out.set(header, 0);
  let writePtr = 10;
  for (const f of frames) {
    out.set(f, writePtr);
    writePtr += f.length;
  }
  return out;
}

// =============================================================================
// In-Thread M4A (ISO-BMFF / AAC) Indexing & Slicing Engine
// =============================================================================
function packM4aAtom(name, payload) {
  const buf = new Uint8Array(8 + payload.length);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 8 + payload.length);
  for (let i = 0; i < 4; i++) buf[4 + i] = name.charCodeAt(i);
  buf.set(payload, 8);
  return buf;
}

function concatM4aBuffers(...arrays) {
  let total = 0;
  for (const a of arrays) total += a ? a.length : 0;
  const res = new Uint8Array(total);
  let p = 0;
  for (const a of arrays) {
    if (a) {
      res.set(a, p);
      p += a.length;
    }
  }
  return res;
}

function makeM4aMetaUdta(metadataOrTitle) {
  const meta = typeof metadataOrTitle === 'string' ? { title: metadataOrTitle } : (metadataOrTitle || {});
  const atoms = [];

  function addStringAtom(name, str) {
    if (!str) return;
    const strBytes = new TextEncoder().encode(str);
    const dataPayload = concatM4aBuffers(new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0]), strBytes);
    const dataAtom = packM4aAtom('data', dataPayload);
    atoms.push(packM4aAtom(name, dataAtom));
  }

  addStringAtom('\xA9nam', meta.title);
  addStringAtom('\xA9ART', meta.artist);
  addStringAtom('aART', meta.artist);
  addStringAtom('\xA9alb', meta.album);
  if (meta.year) addStringAtom('\xA9day', String(meta.year));

  if (meta.imageBytes && meta.imageBytes.length > 0) {
    const isPng = meta.imageMime && meta.imageMime.includes('png');
    const typeFlag = isPng ? 14 : 13;
    const dataPayload = concatM4aBuffers(new Uint8Array([0, 0, 0, typeFlag, 0, 0, 0, 0]), meta.imageBytes);
    const dataAtom = packM4aAtom('data', dataPayload);
    atoms.push(packM4aAtom('covr', dataAtom));
  }

  if (atoms.length === 0) return new Uint8Array(0);

  const ilstPayload = concatM4aBuffers(...atoms);
  const ilstAtom = packM4aAtom('ilst', ilstPayload);
  const metaPayload = concatM4aBuffers(new Uint8Array([0, 0, 0, 0]), ilstAtom);
  const metaAtom = packM4aAtom('meta', metaPayload);
  return packM4aAtom('udta', metaAtom);
}

function parseM4aAtoms(bytes, view, start, end) {
  const atoms = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = view.getUint32(pos);
    let name = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    let headerSize = 8;
    if (size === 1) {
      if (pos + 16 > end) break;
      size = Number(view.getBigUint64(pos + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < headerSize || pos + size > end) break;
    atoms.push({ name, start: pos, size, headerSize, payloadStart: pos + headerSize, payloadEnd: pos + size });
    pos += size;
  }
  return atoms;
}

function parseM4aIndexDirect(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  const topAtoms = parseM4aAtoms(bytes, view, 0, bytes.length);
  const ftyp = topAtoms.find((a) => a.name === 'ftyp');
  const moov = topAtoms.find((a) => a.name === 'moov');
  if (!ftyp || !moov) {
    throw new Error('Invalid M4A: missing ftyp or moov container box.');
  }

  const moovAtoms = parseM4aAtoms(bytes, view, moov.payloadStart, moov.payloadEnd);
  const mvhd = moovAtoms.find((a) => a.name === 'mvhd');
  const trak = moovAtoms.find((a) => a.name === 'trak');
  if (!trak || !mvhd) {
    throw new Error('Invalid M4A: missing mvhd or trak box.');
  }

  const trakAtoms = parseM4aAtoms(bytes, view, trak.payloadStart, trak.payloadEnd);
  const tkhd = trakAtoms.find((a) => a.name === 'tkhd');
  const mdia = trakAtoms.find((a) => a.name === 'mdia');
  if (!mdia || !tkhd) {
    throw new Error('Invalid M4A: missing tkhd or mdia box.');
  }

  const mdiaAtoms = parseM4aAtoms(bytes, view, mdia.payloadStart, mdia.payloadEnd);
  const mdhd = mdiaAtoms.find((a) => a.name === 'mdhd');
  const hdlr = mdiaAtoms.find((a) => a.name === 'hdlr');
  const minf = mdiaAtoms.find((a) => a.name === 'minf');
  if (!mdhd || !minf || !hdlr) {
    throw new Error('Invalid M4A: missing mdhd, hdlr, or minf box.');
  }

  const minfAtoms = parseM4aAtoms(bytes, view, minf.payloadStart, minf.payloadEnd);
  const smhd = minfAtoms.find((a) => a.name === 'smhd');
  const dinf = minfAtoms.find((a) => a.name === 'dinf');
  const stbl = minfAtoms.find((a) => a.name === 'stbl');
  if (!stbl) {
    throw new Error('Invalid M4A: missing stbl sample table box.');
  }

  const stblAtoms = parseM4aAtoms(bytes, view, stbl.payloadStart, stbl.payloadEnd);
  const stsd = stblAtoms.find((a) => a.name === 'stsd');
  const stts = stblAtoms.find((a) => a.name === 'stts');
  const stsc = stblAtoms.find((a) => a.name === 'stsc');
  const stsz = stblAtoms.find((a) => a.name === 'stsz');
  const stco = stblAtoms.find((a) => a.name === 'stco');
  const co64 = stblAtoms.find((a) => a.name === 'co64');

  if (!stsd || !stts || !stsc || !stsz || (!stco && !co64)) {
    throw new Error('Invalid M4A: missing required sample table atoms.');
  }

  const mdhdVer = view.getUint8(mdhd.payloadStart);
  let timescale, duration;
  if (mdhdVer === 0) {
    timescale = view.getUint32(mdhd.payloadStart + 12);
    duration = view.getUint32(mdhd.payloadStart + 16);
  } else {
    timescale = view.getUint32(mdhd.payloadStart + 20);
    duration = Number(view.getBigUint64(mdhd.payloadStart + 24));
  }

  const mvhdVer = view.getUint8(mvhd.payloadStart);
  const mvhdTimescale = mvhdVer === 0 ? view.getUint32(mvhd.payloadStart + 12) : view.getUint32(mvhd.payloadStart + 20);

  const chunkOffsets = [];
  if (stco) {
    const count = view.getUint32(stco.payloadStart + 4);
    for (let i = 0; i < count; i++) {
      chunkOffsets.push(view.getUint32(stco.payloadStart + 8 + i * 4));
    }
  } else {
    const count = view.getUint32(co64.payloadStart + 4);
    for (let i = 0; i < count; i++) {
      chunkOffsets.push(Number(view.getBigUint64(co64.payloadStart + 8 + i * 8)));
    }
  }

  const uniformSize = view.getUint32(stsz.payloadStart + 4);
  const sampleCount = view.getUint32(stsz.payloadStart + 8);
  const sampleSizes = new Uint32Array(sampleCount);
  let totalAudioBytes = 0;
  if (uniformSize === 0) {
    for (let i = 0; i < sampleCount; i++) {
      const s = view.getUint32(stsz.payloadStart + 12 + i * 4);
      sampleSizes[i] = s;
      totalAudioBytes += s;
    }
  } else {
    sampleSizes.fill(uniformSize);
    totalAudioBytes = uniformSize * sampleCount;
  }

  const stscCount = view.getUint32(stsc.payloadStart + 4);
  const scEntries = [];
  for (let i = 0; i < stscCount; i++) {
    scEntries.push({
      firstChunk: view.getUint32(stsc.payloadStart + 8 + i * 12),
      samplesPerChunk: view.getUint32(stsc.payloadStart + 12 + i * 12),
    });
  }

  const sampleOffsets = new Uint32Array(sampleCount);
  let sIdx = 0;
  for (let cIdx = 1; cIdx <= chunkOffsets.length; cIdx++) {
    let currSpc = scEntries[0].samplesPerChunk;
    for (let k = 0; k < scEntries.length; k++) {
      if (cIdx >= scEntries[k].firstChunk) {
        currSpc = scEntries[k].samplesPerChunk;
      } else {
        break;
      }
    }
    let curOffset = chunkOffsets[cIdx - 1];
    for (let s = 0; s < currSpc && sIdx < sampleCount; s++) {
      sampleOffsets[sIdx] = curOffset;
      curOffset += sampleSizes[sIdx];
      sIdx++;
    }
  }

  const durationSec = duration / timescale;
  const frameDuration = sampleCount > 0 ? durationSec / sampleCount : 0.0232;
  const avgBitrate = durationSec > 0 ? Math.round((totalAudioBytes * 8) / durationSec / 1000) : 128;

  const rawAtoms = {
    ftyp: bytes.slice(ftyp.start, ftyp.payloadEnd),
    mvhd: bytes.slice(mvhd.payloadStart, mvhd.payloadEnd),
    tkhd: bytes.slice(tkhd.payloadStart, tkhd.payloadEnd),
    mdhd: bytes.slice(mdhd.payloadStart, mdhd.payloadEnd),
    hdlr: bytes.slice(hdlr.payloadStart, hdlr.payloadEnd),
    smhd: smhd ? bytes.slice(smhd.payloadStart, smhd.payloadEnd) : null,
    dinf: dinf ? bytes.slice(dinf.payloadStart, dinf.payloadEnd) : null,
    stsd: bytes.slice(stsd.payloadStart, stsd.payloadEnd),
  };

  const peaks = computeM4aPeaksFromSamples(sampleSizes, durationSec);

  return {
    format: 'm4a',
    frameCount: sampleCount,
    audioFrameCount: sampleCount,
    firstAudioFrameIndex: 0,
    sampleRate: timescale,
    frameDuration,
    duration: durationSec,
    bitrate: avgBitrate,
    isVbr: true,
    sampleOffsets,
    sampleSizes,
    frameOffsets: sampleOffsets,
    timescale,
    mvhdTimescale,
    rawAtoms,
    peaks,
  };
}

function sliceM4aDirect({ buffer, sampleSizes, timescale, mvhdTimescale, rawAtoms, partName, metadata }) {
  const audioBytes = new Uint8Array(buffer);
  const numSamples = sampleSizes.length;

  const stszPayload = new Uint8Array(12 + numSamples * 4);
  const stszView = new DataView(stszPayload.buffer);
  stszView.setUint32(0, 0);
  stszView.setUint32(4, 0);
  stszView.setUint32(8, numSamples);
  for (let i = 0; i < numSamples; i++) {
    stszView.setUint32(12 + i * 4, sampleSizes[i]);
  }
  const newStsz = packM4aAtom('stsz', stszPayload);

  const sttsPayload = new Uint8Array(16);
  const sttsView = new DataView(sttsPayload.buffer);
  sttsView.setUint32(0, 0);
  sttsView.setUint32(4, 1);
  sttsView.setUint32(8, numSamples);
  sttsView.setUint32(12, 1024);
  const newStts = packM4aAtom('stts', sttsPayload);

  const stscPayload = new Uint8Array(20);
  const stscView = new DataView(stscPayload.buffer);
  stscView.setUint32(0, 0);
  stscView.setUint32(4, 1);
  stscView.setUint32(8, 1);
  stscView.setUint32(12, numSamples);
  stscView.setUint32(16, 1);
  const newStsc = packM4aAtom('stsc', stscPayload);

  const newAudioDuration = numSamples * 1024;
  const mdhdPayload = new Uint8Array(rawAtoms.mdhd);
  const mdhdView = new DataView(mdhdPayload.buffer, mdhdPayload.byteOffset, mdhdPayload.byteLength);
  if (mdhdView.getUint8(0) === 0) {
    mdhdView.setUint32(16, newAudioDuration);
  } else {
    mdhdView.setBigUint64(24, BigInt(newAudioDuration));
  }
  const newMdhd = packM4aAtom('mdhd', mdhdPayload);

  const newMvhdDuration = Math.round((newAudioDuration * mvhdTimescale) / timescale);
  const mvhdPayload = new Uint8Array(rawAtoms.mvhd);
  const mvhdView = new DataView(mvhdPayload.buffer, mvhdPayload.byteOffset, mvhdPayload.byteLength);
  if (mvhdView.getUint8(0) === 0) {
    mvhdView.setUint32(16, newMvhdDuration);
  } else {
    mvhdView.setBigUint64(24, BigInt(newMvhdDuration));
  }
  const newMvhd = packM4aAtom('mvhd', mvhdPayload);

  const tkhdPayload = new Uint8Array(rawAtoms.tkhd);
  const tkhdView = new DataView(tkhdPayload.buffer, tkhdPayload.byteOffset, tkhdPayload.byteLength);
  if (tkhdView.getUint8(0) === 0) {
    tkhdView.setUint32(20, newMvhdDuration);
  } else {
    tkhdView.setBigUint64(28, BigInt(newMvhdDuration));
  }
  const newTkhd = packM4aAtom('tkhd', tkhdPayload);

  const udtaBytes = makeM4aMetaUdta(metadata || partName);

  function assembleMoov(mdatOffset) {
    const stcoPayload = new Uint8Array(12);
    const stcoView = new DataView(stcoPayload.buffer);
    stcoView.setUint32(0, 0);
    stcoView.setUint32(4, 1);
    stcoView.setUint32(8, mdatOffset);
    const newStco = packM4aAtom('stco', stcoPayload);

    const stblPayload = concatM4aBuffers(packM4aAtom('stsd', rawAtoms.stsd), newStts, newStsc, newStsz, newStco);
    const newStbl = packM4aAtom('stbl', stblPayload);
    const minfPayload = concatM4aBuffers(
      rawAtoms.smhd ? packM4aAtom('smhd', rawAtoms.smhd) : new Uint8Array(0),
      rawAtoms.dinf ? packM4aAtom('dinf', rawAtoms.dinf) : new Uint8Array(0),
      newStbl
    );
    const newMinf = packM4aAtom('minf', minfPayload);
    const mdiaPayload = concatM4aBuffers(newMdhd, packM4aAtom('hdlr', rawAtoms.hdlr), newMinf);
    const newMdia = packM4aAtom('mdia', mdiaPayload);
    const trakPayload = concatM4aBuffers(newTkhd, newMdia);
    const newTrak = packM4aAtom('trak', trakPayload);
    const moovPayload = concatM4aBuffers(newMvhd, newTrak, udtaBytes);
    return packM4aAtom('moov', moovPayload);
  }

  const ftypBytes = rawAtoms.ftyp;
  const dummyMoov = assembleMoov(0);
  const mdatDataOffset = ftypBytes.length + dummyMoov.length + 8;
  const finalMoov = assembleMoov(mdatDataOffset);

  const newMdat = packM4aAtom('mdat', audioBytes);
  const output = concatM4aBuffers(ftypBytes, finalMoov, newMdat);
  return output.buffer;
}

// =============================================================================
// Waveform & Loudness Peak Computation (Instant, Zero-PCM Memory, Zero-OOM)
// =============================================================================
function computeMp3PeaksFromFrames(bytes, frameOffsets, frameCount, duration) {
  const windowSec = 0.05; // 50ms standard resolution
  const totalWindows = Math.max(1, Math.ceil(duration / windowSec));
  const peaks = new Float32Array(totalWindows);
  peaks.fill(-60);

  if (!frameCount || frameCount === 0 || !frameOffsets || frameOffsets.length === 0) return peaks;

  const frameDuration = duration / frameCount;

  for (let i = 0; i < frameCount; i++) {
    const offset = frameOffsets[i];
    if (offset + 10 > bytes.length) continue;

    const b1 = bytes[offset + 1];
    const b3 = bytes[offset + 3];

    const protection = b1 & 0x01;
    const channelMode = (b3 >> 6) & 0x03;

    let gain = 0;
    const headerLen = 4 + (protection === 0 ? 2 : 0);
    const sideInfoOffset = offset + headerLen;

    if (sideInfoOffset + 8 <= bytes.length) {
      if (channelMode === 3) {
        // Mono MP3
        const b4 = bytes[sideInfoOffset + 4];
        const b5 = bytes[sideInfoOffset + 5];
        gain = ((b4 & 0x01) << 7) | ((b5 >> 1) & 0x7f);
      } else {
        // Stereo MP3
        const b5 = bytes[sideInfoOffset + 5];
        const b6 = bytes[sideInfoOffset + 6];
        gain = ((b5 & 0x7f) << 1) | ((b6 >> 7) & 1);
      }
    }

    let db = -60;
    if (gain > 0) {
      // MPEG-1 Layer 3 logarithmic gain mapping: 2^(0.25*(gain-210)) -> 1.505*(gain-210) dB
      db = Math.max(-60, Math.min(0, (gain - 210) * 0.75 - 3));
    }

    const t = i * frameDuration;
    const w = Math.floor(t / windowSec);
    if (w < totalWindows) {
      if (db > peaks[w]) {
        peaks[w] = db;
      }
    }
  }

  return peaks;
}

function computeM4aPeaksFromSamples(sampleSizes, duration) {
  const windowSec = 0.05;
  const totalWindows = Math.max(1, Math.ceil(duration / windowSec));
  const peaks = new Float32Array(totalWindows);
  peaks.fill(-60);

  const sampleCount = sampleSizes ? sampleSizes.length : 0;
  if (sampleCount === 0) return peaks;

  let maxS = 1;
  for (let i = 0; i < sampleCount; i++) {
    if (sampleSizes[i] > maxS) maxS = sampleSizes[i];
  }
  const minThreshold = 25;
  const range = Math.max(1, maxS - minThreshold);
  const sampleDuration = duration / sampleCount;

  for (let i = 0; i < sampleCount; i++) {
    const s = sampleSizes[i];
    let db = -60;
    if (s > minThreshold) {
      const norm = Math.min(1.0, (s - minThreshold) / range);
      db = Math.max(-60, Math.min(0, -60 + 60 * Math.sqrt(norm)));
    }

    const t = i * sampleDuration;
    const w = Math.floor(t / windowSec);
    if (w < totalWindows) {
      if (db > peaks[w]) {
        peaks[w] = db;
      }
    }
  }

  return peaks;
}

function applySmartSilenceThreshold(peaks) {
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
}

async function computePeaks() {
  if (!state.file || !state.file.buffer || !state.index) return;

  try {
    let peaks;
    if (state.index.peaks && state.index.peaks.length > 0) {
      peaks = state.index.peaks;
    } else if (state.index.format === 'm4a') {
      peaks = computeM4aPeaksFromSamples(state.index.sampleSizes, state.index.duration);
    } else {
      const bytes = new Uint8Array(state.file.buffer);
      peaks = computeMp3PeaksFromFrames(bytes, state.index.frameOffsets, state.index.frameCount, state.index.duration);
    }

    state.peaks = peaks;
    applySmartSilenceThreshold(peaks);
    updateLoadingProgress(100, 'Audio ready!');
    finalizeProcessing();
  } catch (err) {
    console.warn('Loudness peak computation fallback:', err);
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

  requestAnimationFrame(() => {
    drawWaveform();
  });
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

  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      if (state.index) drawWaveform();
    }, 150);
  });

  if (window.ResizeObserver && elements.canvasWrapper) {
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && state.index) {
          drawWaveform();
        }
      }
    });
    ro.observe(elements.canvasWrapper);
  }
}

function drawWaveform() {
  const canvas = elements.waveformCanvas;
  if (!canvas || !state.index || !elements.canvasWrapper) return;

  const rect = elements.canvasWrapper.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const dpr = window.devicePixelRatio || 1;
  const w = rect.width;
  const h = rect.height;

  // Lock canvas style dimensions to container width & height to avoid browser scaling distortion
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, w, h);

  const peaks = state.peaks;
  if (!peaks || peaks.length === 0) return;

  const totalWindows = peaks.length;

  // Adaptive bar density for mobile vs desktop: ensures full span from 0 to 100% width
  const isMobile = w < 500;
  const targetBarWidth = isMobile ? 2.5 : 3.0;
  const targetGap = isMobile ? 1.0 : 1.2;
  const approxStep = targetBarWidth + targetGap;
  const numBars = Math.max(24, Math.floor(w / approxStep));
  const actualStep = w / numBars;
  const barWidth = Math.max(1.5, actualStep - targetGap);

  const centerY = h / 2;
  const maxBarHeight = (h - 16) / 2;

  // DAW center zero-level guideline
  ctx.strokeStyle = '#22252D';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(w, centerY);
  ctx.stroke();

  // WavePad electric green waveform
  ctx.fillStyle = '#00E676';

  for (let b = 0; b < numBars; b++) {
    const x = b * actualStep;
    const windowIdx = Math.floor((b / numBars) * totalWindows);
    const db = peaks[windowIdx] !== undefined ? peaks[windowIdx] : -60;

    const norm = Math.max(0.05, Math.min(1.0, (db + 60) / 60));
    const barHeight = norm * maxBarHeight;

    ctx.beginPath();
    ctx.roundRect(x, centerY - barHeight, barWidth, barHeight * 2, isMobile ? 1 : 2);
    ctx.fill();
  }

  // Draw defined parts regions
  state.parts.forEach((part, index) => {
    const startX = (part.start / state.index.duration) * w;
    const endX = (part.end / state.index.duration) * w;
    const partWidth = Math.max(2, endX - startX);

    ctx.fillStyle = 'rgba(0, 230, 118, 0.14)';
    ctx.fillRect(startX, 0, partWidth, h);

    ctx.strokeStyle = 'rgba(0, 230, 118, 0.65)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, 0);
    ctx.lineTo(startX, h);
    ctx.moveTo(endX, 0);
    ctx.lineTo(endX, h);
    ctx.stroke();

    if (partWidth > 28) {
      ctx.fillStyle = '#00E676';
      ctx.font = '600 10px Inter, -apple-system, sans-serif';
      ctx.fillText(`#${index + 1} ${part.name}`, startX + 4, 14);
    }
  });

  // Draw suggested cut lines on waveform when Auto Split dialog is open
  if (state.ui.dialog === 'auto' && state.suggestions.length > 1) {
    ctx.strokeStyle = '#FF3344';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);

    for (let i = 1; i < state.suggestions.length; i++) {
      const cutSec = state.suggestions[i].start;
      const x = (cutSec / state.index.duration) * w;

      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();

      ctx.fillStyle = '#FF5252';
      ctx.font = '600 9px Inter, -apple-system, sans-serif';
      ctx.fillText(`✂ ${formatTime(cutSec)}`, Math.min(w - 44, Math.max(2, x + 3)), 26);
    }
    ctx.setLineDash([]);
  }
}

function initWaveformEvents() {
  const wrapper = elements.canvasWrapper;
  if (!wrapper) return;

  function updateHover(x) {
    if (!state.index) return;
    const rect = wrapper.getBoundingClientRect();
    const clampedX = Math.max(0, Math.min(rect.width, x));
    const ratio = clampedX / rect.width;
    const hoverTime = ratio * state.index.duration;

    elements.waveformHoverBar.style.display = 'block';
    elements.waveformHoverBar.style.left = `${clampedX}px`;

    elements.waveformHoverLabel.style.display = 'block';
    elements.waveformHoverLabel.style.left = `${clampedX}px`;
    elements.waveformHoverLabel.textContent = formatTime(hoverTime);
  }

  function hideHover() {
    elements.waveformHoverBar.style.display = 'none';
    elements.waveformHoverLabel.style.display = 'none';
  }

  wrapper.addEventListener('mousemove', (e) => {
    const rect = wrapper.getBoundingClientRect();
    updateHover(e.clientX - rect.left);
  });

  wrapper.addEventListener('mouseleave', () => {
    hideHover();
  });

  wrapper.addEventListener('click', (e) => {
    if (!state.index) return;
    const rect = wrapper.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const seekTime = (x / rect.width) * state.index.duration;
    seekToTime(seekTime);
  });

  // Touch Support for mobile touch-to-seek and drag-to-seek
  let isTouchingWaveform = false;

  function handleTouchSeek(e) {
    if (!state.index || !e.touches || e.touches.length === 0) return;
    const touch = e.touches[0];
    const rect = wrapper.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, touch.clientX - rect.left));
    const seekTime = (x / rect.width) * state.index.duration;

    updateHover(x);
    seekToTime(seekTime);
  }

  wrapper.addEventListener('touchstart', (e) => {
    isTouchingWaveform = true;
    handleTouchSeek(e);
  }, { passive: true });

  wrapper.addEventListener('touchmove', (e) => {
    if (isTouchingWaveform) {
      handleTouchSeek(e);
    }
  }, { passive: true });

  wrapper.addEventListener('touchend', () => {
    isTouchingWaveform = false;
    setTimeout(() => {
      hideHover();
    }, 1200);
  });

  wrapper.addEventListener('touchcancel', () => {
    isTouchingWaveform = false;
    hideHover();
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
// Time Wheel Spinner Controller (DAW Jog Wheel) & mm:ss Helpers
// =============================================================================
function formatMmSs(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const totalRounded = Math.round(seconds);
  const mins = Math.floor(totalRounded / 60);
  const secs = totalRounded % 60;
  const mStr = String(mins).padStart(2, '0');
  const sStr = String(secs).padStart(2, '0');
  return `${mStr}:${sStr}`;
}

function parseTimeToSeconds(val) {
  if (typeof val === 'number') return isNaN(val) ? NaN : val;
  if (!val || typeof val !== 'string') return NaN;
  const trimmed = val.trim();
  if (!trimmed) return NaN;

  if (trimmed.includes(':')) {
    const parts = trimmed.split(':');
    if (parts.length === 2) {
      const mins = parseFloat(parts[0]);
      const secs = parseFloat(parts[1]);
      if (isNaN(mins) || isNaN(secs)) return NaN;
      return mins * 60 + secs;
    } else if (parts.length === 3) {
      const hrs = parseFloat(parts[0]);
      const mins = parseFloat(parts[1]);
      const secs = parseFloat(parts[2]);
      if (isNaN(hrs) || isNaN(mins) || isNaN(secs)) return NaN;
      return hrs * 3600 + mins * 60 + secs;
    }
  }

  const num = parseFloat(trimmed.replace(',', '.'));
  return isNaN(num) ? NaN : num;
}

const WHEEL_ITEM_HEIGHT = 36;
let activeWheelTarget = 'start'; // 'start' | 'end'
let wheelMaxSec = 300;
let builtWheelDuration = -1;
let isProgrammaticWheelScroll = false;
let wheelScrollRaf = null;
let scrollResetTimeout = null;
let lastSelectedSec = -1;

function buildTimeWheelTrack(duration) {
  if (!elements.timeWheelTrack) return;
  const maxSec = Math.max(10, Math.ceil(duration || 300));
  if (builtWheelDuration === maxSec && elements.timeWheelTrack.childElementCount > 0) {
    wheelMaxSec = maxSec;
    return;
  }
  wheelMaxSec = maxSec;
  builtWheelDuration = maxSec;

  const frag = document.createDocumentFragment();
  for (let s = 0; s <= maxSec; s++) {
    const item = document.createElement('div');
    item.className = 'wheel-item';
    item.dataset.sec = String(s);
    item.innerHTML = `<span class="wheel-time-fmt">${formatMmSs(s)}</span><span class="wheel-sep">•</span><span class="wheel-sec-num">${s}s</span>`;
    frag.appendChild(item);
  }
  elements.timeWheelTrack.innerHTML = '';
  elements.timeWheelTrack.appendChild(frag);
}

function openTimeWheel(targetField = 'start') {
  if (!elements.timeWheelContainer) return;
  activeWheelTarget = targetField;

  if (state.index && state.index.duration) {
    buildTimeWheelTrack(state.index.duration);
  }

  if (elements.cardRangeStart) elements.cardRangeStart.classList.toggle('active', targetField === 'start');
  if (elements.cardRangeEnd) elements.cardRangeEnd.classList.toggle('active', targetField === 'end');

  updateWheelBadges();

  const targetInput = targetField === 'start' ? elements.inputRangeStart : elements.inputRangeEnd;
  const currentVal = targetInput ? Math.round(parseTimeToSeconds(targetInput.value) || 0) : 0;

  requestAnimationFrame(() => {
    scrollToWheelSec(currentVal, 'auto');
  });
}

function closeTimeWheel() {
  // Wheel remains permanently visible on mobile layout
}

function scrollToWheelSec(sec, behavior = 'auto') {
  if (!elements.timeWheelViewport) return;
  const clampedSec = Math.max(0, Math.min(wheelMaxSec, Math.round(sec)));
  isProgrammaticWheelScroll = true;

  elements.timeWheelViewport.scrollTo({
    top: clampedSec * WHEEL_ITEM_HEIGHT,
    behavior,
  });

  updateSelectedWheelItem(clampedSec);

  if (scrollResetTimeout) clearTimeout(scrollResetTimeout);
  scrollResetTimeout = setTimeout(() => {
    isProgrammaticWheelScroll = false;
  }, behavior === 'smooth' ? 300 : 50);
}

function updateSelectedWheelItem(activeSec) {
  if (!elements.timeWheelTrack || lastSelectedSec === activeSec) return;
  lastSelectedSec = activeSec;

  const currentSel = elements.timeWheelTrack.querySelector('.wheel-item.is-selected');
  if (currentSel) currentSel.classList.remove('is-selected');

  const targetItem = elements.timeWheelTrack.querySelector(`.wheel-item[data-sec="${activeSec}"]`);
  if (targetItem) targetItem.classList.add('is-selected');
}

function updateWheelBadges() {
  const isStart = activeWheelTarget === 'start';
  const targetInput = isStart ? elements.inputRangeStart : elements.inputRangeEnd;
  const curVal = targetInput ? targetInput.value : '00:00';
  if (elements.wheelTargetText) {
    elements.wheelTargetText.textContent = isStart ? `Bắt đầu (${curVal})` : `Kết thúc (${curVal})`;
  }
}

function stepWheel(delta) {
  const targetInput = activeWheelTarget === 'start' ? elements.inputRangeStart : elements.inputRangeEnd;
  if (!targetInput) return;

  const current = parseTimeToSeconds(targetInput.value) || 0;
  const next = Math.max(0, Math.min(wheelMaxSec, Math.round(current + delta)));
  targetInput.value = formatMmSs(next);
  validateRangeInputs();
  updateWheelBadges();
  scrollToWheelSec(next, 'smooth');
}

function onWheelViewportScroll() {
  if (isProgrammaticWheelScroll || !elements.timeWheelViewport) return;

  if (wheelScrollRaf) cancelAnimationFrame(wheelScrollRaf);
  wheelScrollRaf = requestAnimationFrame(() => {
    const scrollTop = elements.timeWheelViewport.scrollTop;
    const sec = Math.max(0, Math.min(wheelMaxSec, Math.round(scrollTop / WHEEL_ITEM_HEIGHT)));

    const targetInput = activeWheelTarget === 'start' ? elements.inputRangeStart : elements.inputRangeEnd;
    const mmSsVal = formatMmSs(sec);
    if (targetInput && targetInput.value !== mmSsVal) {
      targetInput.value = mmSsVal;
      validateRangeInputs();
      updateWheelBadges();
    }
    updateSelectedWheelItem(sec);
  });
}

// =============================================================================
// Time Range Dialog Logic
// =============================================================================
function openRangeDialog() {
  if (!state.index) return;

  state.ui.dialog = 'range';
  elements.rangeDialog.classList.add('open');

  elements.inputRangeStart.value = '00:00';
  elements.inputRangeEnd.value = formatMmSs(Math.min(60, state.index.duration));
  validateRangeInputs();

  // Initialize and open time wheel on Start Time
  buildTimeWheelTrack(state.index.duration);
  openTimeWheel('start');
}

function validateRangeInputs() {
  if (!state.index) return;

  const startVal = parseTimeToSeconds(elements.inputRangeStart.value);
  const endVal = parseTimeToSeconds(elements.inputRangeEnd.value);
  const duration = state.index.duration;

  if (elements.rangeStartHelper) {
    elements.rangeStartHelper.textContent = isNaN(startVal)
      ? '00:00.0 (0s)'
      : `${formatMmSs(startVal)}.0 (${Math.round(startVal)}s)`;
  }

  if (elements.rangeEndHelper) {
    elements.rangeEndHelper.textContent = isNaN(endVal)
      ? '00:00.0 (0s)'
      : `${formatMmSs(endVal)}.0 (${Math.round(endVal)}s)`;
  }

  let errorMsg = '';
  const partDuration = endVal - startVal;

  if (isNaN(startVal) || startVal < 0) {
    errorMsg = 'Thời gian bắt đầu không hợp lệ (mm:ss) ≥ 00:00.';
  } else if (isNaN(endVal) || endVal > duration) {
    errorMsg = `Thời gian kết thúc không được vượt quá độ dài bài (${formatMmSs(duration)}).`;
  } else if (endVal <= startVal) {
    errorMsg = 'Thời gian kết thúc phải lớn hơn thời gian bắt đầu.';
  } else if (partDuration < 1.0) {
    errorMsg = 'Thời lượng đoạn phải từ 1.0 giây trở lên.';
  }

  if (elements.rangeDurationText) {
    if (isNaN(startVal) || isNaN(endVal) || endVal <= startVal) {
      elements.rangeDurationText.textContent = '--:-- (0s)';
      if (elements.rangeDurationPill) elements.rangeDurationPill.classList.add('is-invalid');
    } else {
      elements.rangeDurationText.textContent = `${formatMmSs(partDuration)} (${Math.round(partDuration)}s)`;
      if (elements.rangeDurationPill) elements.rangeDurationPill.classList.remove('is-invalid');
    }
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

  const startSec = parseTimeToSeconds(elements.inputRangeStart.value);
  const endSec = parseTimeToSeconds(elements.inputRangeEnd.value);
  if (isNaN(startSec) || isNaN(endSec)) return;

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
      const mimeType = state.index && state.index.format === 'm4a' ? 'audio/mp4' : 'audio/mpeg';
      const blob = new Blob([state.file.buffer], { type: mimeType });
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

  const isM4a = state.index.format === 'm4a';
  const frameDuration = state.index.frameDuration;
  const frameOffsets = state.index.frameOffsets;
  let blob;

  if (isM4a) {
    const sampleSizes = state.index.sampleSizes;
    const totalSamples = frameOffsets.length;
    const startFrame = Math.max(0, Math.min(totalSamples - 1, Math.floor(startSec / frameDuration)));
    const endFrame = Math.max(startFrame + 1, Math.min(totalSamples, Math.ceil(endSec / frameDuration)));

    const startByte = frameOffsets[startFrame];
    const lastFrame = endFrame - 1;
    const endByte = frameOffsets[lastFrame] + sampleSizes[lastFrame];

    const slicedSampleSizes = sampleSizes.slice(startFrame, endFrame);
    const sliceAudioBuffer = state.file.buffer.slice(startByte, endByte);

    const m4aBytes = sliceM4aDirect({
      buffer: sliceAudioBuffer,
      sampleSizes: slicedSampleSizes,
      timescale: state.index.timescale,
      mvhdTimescale: state.index.mvhdTimescale,
      rawAtoms: state.index.rawAtoms,
      partName: 'Preview',
    });
    blob = new Blob([m4aBytes], { type: 'audio/mp4' });
  } else {
    const firstAudioFrameIndex = state.index.firstAudioFrameIndex || 0;
    const startFrame = Math.max(firstAudioFrameIndex, firstAudioFrameIndex + Math.floor(startSec / frameDuration));
    const endFrame = Math.min(frameOffsets.length, firstAudioFrameIndex + Math.ceil(endSec / frameDuration));

    const startByte = frameOffsets[startFrame] || 0;
    const endByte = endFrame < frameOffsets.length ? frameOffsets[endFrame] : state.file.buffer.byteLength;

    const slice = state.file.buffer.slice(startByte, endByte);
    blob = new Blob([slice], { type: 'audio/mpeg' });
  }

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
// Lossless Audio Slicing & Screen Wake Lock (MP3 & M4A)
// =============================================================================
async function splitPart(part) {
  if (part.status === 'working') return;

  acquireWakeLock();

  part.status = 'working';
  renderParts();

  try {
    const isM4a = state.index && state.index.format === 'm4a';

    const metadataPayload = {
      title: part.name,
      artist: state.metadata?.artist || '',
      album: state.metadata?.album || '',
      year: state.metadata?.year || '',
      imageBytes: state.metadata?.coverBytes || null,
      imageMime: state.metadata?.coverMime || null,
    };

    if (isM4a) {
      const frameOffsets = state.index.frameOffsets;
      const sampleSizes = state.index.sampleSizes;
      const frameDuration = state.index.frameDuration;
      const totalSamples = frameOffsets.length;

      const startFrame = Math.max(0, Math.min(totalSamples - 1, Math.floor(part.start / frameDuration)));
      const endFrame = Math.max(startFrame + 1, Math.min(totalSamples, Math.ceil(part.end / frameDuration)));

      const startByte = frameOffsets[startFrame];
      const lastFrame = endFrame - 1;
      const endByte = frameOffsets[lastFrame] + sampleSizes[lastFrame];

      const slicedSampleSizes = sampleSizes.slice(startFrame, endFrame);
      const sliceBuffer = state.file.buffer.slice(startByte, endByte);

      if (mp3Worker) {
        try {
          mp3Worker.postMessage(
            {
              action: 'sliceAudio',
              payload: {
                format: 'm4a',
                buffer: sliceBuffer,
                sampleSizes: slicedSampleSizes,
                timescale: state.index.timescale,
                mvhdTimescale: state.index.mvhdTimescale,
                rawAtoms: state.index.rawAtoms,
                partName: part.name,
                id: part.id,
                metadata: metadataPayload,
              },
            },
            [sliceBuffer]
          );
          return;
        } catch (e) {
          console.warn('Worker slice postMessage failed, falling back to in-thread:', e);
        }
      }

      // In-thread M4A slicing fallback
      setTimeout(() => {
        try {
          const slicedBuffer = sliceM4aDirect({
            buffer: sliceBuffer,
            sampleSizes: slicedSampleSizes,
            timescale: state.index.timescale,
            mvhdTimescale: state.index.mvhdTimescale,
            rawAtoms: state.index.rawAtoms,
            partName: part.name,
            metadata: metadataPayload,
          });
          onSliceComplete(part.id, part.name, slicedBuffer);
        } catch (err) {
          part.status = 'error';
          releaseWakeLock();
          renderParts();
          showSnackbar('Failed to split part: ' + err.message);
        }
      }, 20);
      return;
    }

    // Standard MP3 frame slicing
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
              metadata: metadataPayload,
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
          metadata: metadataPayload,
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

  const isM4a = state.index && state.index.format === 'm4a';
  const mimeType = isM4a ? 'audio/mp4' : 'audio/mpeg';
  const ext = isM4a ? 'm4a' : 'mp3';

  const blob = new Blob([arrayBuffer], { type: mimeType });
  part.lastBlob = blob;
  part.status = 'done';
  renderParts();

  const fileName = `${sanitizeFileName(partName)}.${ext}`;
  downloadBlob(blob, fileName, mimeType);
}

// =============================================================================
// Download & Web Share Fallback (Cross-Platform Mobile & Desktop)
// =============================================================================
async function downloadBlob(blob, fileName, mimeType = 'audio/mpeg') {
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (isIOS && navigator.canShare) {
    try {
      const file = new File([blob], fileName, { type: mimeType });
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
let tempModalCover = {
  bytes: null,
  mime: null,
  dataUrl: null,
};

function openEditTagsDialog() {
  if (!state.file) {
    showSnackbar('Please choose an audio file first.');
    return;
  }

  if (state.ui.loading) {
    showSnackbar('Audio file is still indexing, please wait a moment...');
    return;
  }

  state.ui.dialog = 'editTags';

  const meta = state.metadata || (state.metadata = {
    artist: '',
    album: '',
    year: '',
    coverBytes: null,
    coverMime: null,
    coverDataUrl: null,
    isOriginalCoverUrl: false,
  });

  tempModalCover = {
    bytes: meta.coverBytes || null,
    mime: meta.coverMime || null,
    dataUrl: meta.coverDataUrl || null,
  };

  if (elements.inputTagArtist) {
    elements.inputTagArtist.value = meta.artist || '';
  }
  if (elements.inputTagAlbum) {
    elements.inputTagAlbum.value = meta.album || '';
  }
  if (elements.inputTagYear) {
    elements.inputTagYear.value = meta.year || '';
  }

  updateModalCoverView();

  if (elements.editTagsModal) {
    elements.editTagsModal.classList.add('open');
    elements.editTagsModal.style.display = 'flex';
    elements.editTagsModal.style.opacity = '1';
    elements.editTagsModal.style.pointerEvents = 'auto';
  }
}

function processCoverImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    showSnackbar('Please select a valid image file (JPG, PNG, WEBP).');
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(objectUrl);

    // Limit maximum dimensions to 500x500 to keep exported audio files lightweight (~40-60KB)
    const maxDim = 500;
    let targetW = img.width;
    let targetH = img.height;

    if (targetW > maxDim || targetH > maxDim) {
      if (targetW > targetH) {
        targetH = Math.round((targetH * maxDim) / targetW);
        targetW = maxDim;
      } else {
        targetW = Math.round((targetW * maxDim) / targetH);
        targetH = maxDim;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const isPng = file.type === 'image/png';
    const outputMime = isPng ? 'image/png' : 'image/jpeg';
    const outputQuality = isPng ? undefined : 0.85;

    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          showSnackbar('Failed to process cover image.');
          return;
        }

        const arrayBuf = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuf);
        const dataUrl = URL.createObjectURL(blob);

        if (tempModalCover.dataUrl && tempModalCover.dataUrl !== state.metadata.coverDataUrl) {
          try { URL.revokeObjectURL(tempModalCover.dataUrl); } catch (_) {}
        }

        tempModalCover = {
          bytes,
          mime: outputMime,
          dataUrl,
        };

        updateModalCoverView();
      },
      outputMime,
      outputQuality
    );
  };

  img.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    showSnackbar('Could not load image. Please try another file.');
  };

  img.src = objectUrl;
}

function updateModalCoverView() {
  if (tempModalCover.dataUrl) {
    if (elements.modalCoverImg) {
      elements.modalCoverImg.src = tempModalCover.dataUrl;
      elements.modalCoverImg.classList.remove('hidden');
    }
    if (elements.modalCoverPlaceholder) {
      elements.modalCoverPlaceholder.classList.add('hidden');
    }
    if (elements.btnRemoveCoverArt) {
      elements.btnRemoveCoverArt.classList.remove('hidden');
    }
  } else {
    if (elements.modalCoverImg) {
      elements.modalCoverImg.src = '';
      elements.modalCoverImg.classList.add('hidden');
    }
    if (elements.modalCoverPlaceholder) {
      elements.modalCoverPlaceholder.classList.remove('hidden');
    }
    if (elements.btnRemoveCoverArt) {
      elements.btnRemoveCoverArt.classList.add('hidden');
    }
  }
}

function removeCoverArtInModal() {
  if (tempModalCover.dataUrl && tempModalCover.dataUrl !== state.metadata.coverDataUrl) {
    try { URL.revokeObjectURL(tempModalCover.dataUrl); } catch (_) {}
  }
  tempModalCover = { bytes: null, mime: null, dataUrl: null };
  if (elements.coverArtFileInput) {
    elements.coverArtFileInput.value = '';
  }
  updateModalCoverView();
}

function saveEditTags() {
  if (elements.inputTagArtist) {
    state.metadata.artist = elements.inputTagArtist.value.trim();
  }
  if (elements.inputTagAlbum) {
    state.metadata.album = elements.inputTagAlbum.value.trim();
  }
  if (elements.inputTagYear) {
    state.metadata.year = elements.inputTagYear.value.trim();
  }

  // Update cover artwork
  if (tempModalCover.dataUrl !== state.metadata.coverDataUrl) {
    if (state.metadata.coverDataUrl && !state.metadata.isOriginalCoverUrl) {
      try { URL.revokeObjectURL(state.metadata.coverDataUrl); } catch (_) {}
    }
    state.metadata.coverBytes = tempModalCover.bytes;
    state.metadata.coverMime = tempModalCover.mime;
    state.metadata.coverDataUrl = tempModalCover.dataUrl;
    state.metadata.isOriginalCoverUrl = false;
  }

  updateMainCardCoverView();
  closeDialog();
  showSnackbar('Tags and cover artwork updated!');
}

function updateMainCardCoverView() {
  if (state.metadata.coverDataUrl) {
    if (elements.fileCoverImg) {
      elements.fileCoverImg.src = state.metadata.coverDataUrl;
      elements.fileCoverImg.classList.remove('hidden');
    }
    if (elements.fileDefaultIcon) {
      elements.fileDefaultIcon.classList.add('hidden');
    }
  } else {
    if (elements.fileCoverImg) {
      elements.fileCoverImg.src = '';
      elements.fileCoverImg.classList.add('hidden');
    }
    if (elements.fileDefaultIcon) {
      elements.fileDefaultIcon.classList.remove('hidden');
    }
  }

  if (elements.fileSubtext) {
    if (state.metadata.artist || state.metadata.album) {
      const parts = [];
      if (state.metadata.artist) parts.push(state.metadata.artist);
      if (state.metadata.album) parts.push(state.metadata.album);
      elements.fileSubtext.textContent = parts.join(' • ');
      elements.fileSubtext.title = parts.join(' • ');
    } else {
      elements.fileSubtext.textContent = 'Indexed & ready to split';
      elements.fileSubtext.title = 'Indexed & ready to split';
    }
  }
}

function extractMp3Metadata(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    return null;
  }
  const version = bytes[3];
  const tagSize = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
  const end = Math.min(10 + tagSize, bytes.length);

  let pos = 10;
  const tags = {};

  while (pos + 10 <= end) {
    if (bytes[pos] === 0) break;
    const id = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    let frameSize = 0;
    if (version === 4) {
      frameSize = ((bytes[pos + 4] & 0x7f) << 21) | ((bytes[pos + 5] & 0x7f) << 14) | ((bytes[pos + 6] & 0x7f) << 7) | (bytes[pos + 7] & 0x7f);
    } else {
      frameSize = (bytes[pos + 4] << 24) | (bytes[pos + 5] << 16) | (bytes[pos + 6] << 8) | bytes[pos + 7];
    }
    if (frameSize <= 0 || pos + 10 + frameSize > end) break;
    const payload = bytes.subarray(pos + 10, pos + 10 + frameSize);
    pos += 10 + frameSize;

    if (id === 'TIT2' || id === 'TPE1' || id === 'TALB' || id === 'TYER' || id === 'TDRC') {
      const enc = payload[0];
      const textBytes = payload.subarray(1);
      let text = '';
      try {
        if (enc === 0 || enc === 3) {
          text = new TextDecoder(enc === 3 ? 'utf-8' : 'iso-8859-1').decode(textBytes).replace(/\0+$/, '');
        } else if (enc === 1 || enc === 2) {
          text = new TextDecoder('utf-16').decode(textBytes).replace(/\0+$/, '');
        }
      } catch (_) {}
      if (id === 'TIT2') tags.title = text;
      else if (id === 'TPE1') tags.artist = text;
      else if (id === 'TALB') tags.album = text;
      else if (id === 'TYER' || id === 'TDRC') tags.year = text.slice(0, 4);
    } else if (id === 'APIC') {
      try {
        const enc = payload[0];
        let p = 1;
        let mime = '';
        while (p < payload.length && payload[p] !== 0) mime += String.fromCharCode(payload[p++]);
        p++; // skip null
        const picType = payload[p++];
        if (enc === 0 || enc === 3) {
          while (p < payload.length && payload[p] !== 0) p++;
          p++;
        } else {
          while (p + 1 < payload.length && !(payload[p] === 0 && payload[p + 1] === 0)) p += 2;
          p += 2;
        }
        if (p < payload.length) {
          const imgData = payload.subarray(p);
          tags.coverBytes = imgData;
          tags.coverMime = mime || 'image/jpeg';
        }
      } catch (_) {}
    }
  }
  return tags;
}

function extractM4aMetadata(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  try {
    const topAtoms = parseM4aAtoms(bytes, view, 0, bytes.length);
    const moov = topAtoms.find((a) => a.name === 'moov');
    if (!moov) return null;
    const moovAtoms = parseM4aAtoms(bytes, view, moov.payloadStart, moov.payloadEnd);
    const udta = moovAtoms.find((a) => a.name === 'udta');
    if (!udta) return null;
    const udtaAtoms = parseM4aAtoms(bytes, view, udta.payloadStart, udta.payloadEnd);
    const meta = udtaAtoms.find((a) => a.name === 'meta');
    if (!meta) return null;
    const ilst = parseM4aAtoms(bytes, view, meta.payloadStart + 4, meta.payloadEnd).find((a) => a.name === 'ilst');
    if (!ilst) return null;

    const tagAtoms = parseM4aAtoms(bytes, view, ilst.payloadStart, ilst.payloadEnd);
    const tags = {};
    for (const atom of tagAtoms) {
      const dataAtoms = parseM4aAtoms(bytes, view, atom.payloadStart, atom.payloadEnd);
      const data = dataAtoms.find((a) => a.name === 'data');
      if (!data || data.payloadStart + 8 > data.payloadEnd) continue;
      const type = view.getUint32(data.payloadStart);
      const content = bytes.subarray(data.payloadStart + 8, data.payloadEnd);
      if (atom.name === 'covr') {
        tags.coverMime = type === 14 ? 'image/png' : 'image/jpeg';
        tags.coverBytes = content;
      } else {
        const text = new TextDecoder('utf-8').decode(content).replace(/\0+$/, '');
        if (atom.name === '\xA9nam') tags.title = text;
        else if (atom.name === '\xA9ART') tags.artist = text;
        else if (atom.name === 'aART' && !tags.artist) tags.artist = text;
        else if (atom.name === '\xA9alb') tags.album = text;
        else if (atom.name === '\xA9day') tags.year = text.slice(0, 4);
      }
    }
    return tags;
  } catch (_) {
    return null;
  }
}

function openFileInfoDialog() {
  if (!state.file || !state.index) return;

  state.ui.dialog = 'fileInfo';

  const index = state.index;
  const file = state.file;

  if (elements.fileInfoDialogTitle) {
    elements.fileInfoDialogTitle.textContent = index.format === 'm4a' ? 'M4A / AAC File Details' : 'MP3 File Details';
  }
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

function showFormatErrorModal(fileName, formatName, details = null) {
  if (!elements.formatErrorModal) return;

  const safeFileName = fileName || 'Selected File';
  const displayFormat = formatName || 'Incompatible audio format';

  let msgHtml = `
    <div style="margin-bottom: 12px;">
      <div style="font-size: 0.8125rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--md-sys-color-on-surface-variant); margin-bottom: 4px;">Detected format</div>
      <div style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 6px; background: rgba(239, 68, 68, 0.18); border: 1px solid rgba(239, 68, 68, 0.35); color: #fca5a5; font-weight: 600; font-size: 0.875rem;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="10" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
        <span>${escapeHtml(displayFormat)}</span>
      </div>
    </div>
    <div style="font-size: 0.875rem; color: var(--md-sys-color-on-surface); line-height: 1.5; margin-bottom: 12px;">
      File <strong style="color: #ffffff; word-break: break-all;">"${escapeHtml(safeFileName)}"</strong> is not a supported audio file.
    </div>
    <div style="font-size: 0.8125rem; color: var(--md-sys-color-on-surface-variant); line-height: 1.5;">
      ${details ? escapeHtml(details) : 'MP3 Splitter currently supports standard MP3 (.mp3) and M4A/AAC (.m4a) files. Please choose a compatible audio file and load it again.'}
    </div>
  `;

  if (elements.formatModalMessage) {
    elements.formatModalMessage.innerHTML = msgHtml;
  }

  closeDialog();
  elements.formatErrorModal.classList.add('open');
  state.ui.dialog = 'formatError';
}

function closeDialog() {
  if (elements.autoSplitDialog) elements.autoSplitDialog.classList.remove('open');
  if (elements.rangeDialog) elements.rangeDialog.classList.remove('open');
  if (elements.fileInfoDialog) elements.fileInfoDialog.classList.remove('open');
  if (elements.iosInstallModal) elements.iosInstallModal.classList.remove('open');
  if (elements.formatErrorModal) elements.formatErrorModal.classList.remove('open');
  if (elements.editTagsModal) {
    elements.editTagsModal.classList.remove('open');
    elements.editTagsModal.style.display = '';
    elements.editTagsModal.style.opacity = '';
    elements.editTagsModal.style.pointerEvents = '';
  }
  closeTimeWheel();
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
  if (elements.btnOpenEditTags) elements.btnOpenEditTags.disabled = false;
  if (elements.btnOpenFileInfo) elements.btnOpenFileInfo.disabled = false;
  if (elements.btnPlayWholeFile) elements.btnPlayWholeFile.disabled = false;
  if (elements.btnChangeFile) elements.btnChangeFile.style.pointerEvents = 'auto';
}

function disableActionButtons() {
  if (elements.btnOpenAuto) elements.btnOpenAuto.disabled = true;
  if (elements.btnOpenRange) elements.btnOpenRange.disabled = true;
  if (elements.btnOpenEditTags) elements.btnOpenEditTags.disabled = true;
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

// =============================================================================
// Window Exports (for inline HTML handlers, mobile resilience, and testing)
// =============================================================================
window.openEditTagsDialog = openEditTagsDialog;
window.closeDialog = closeDialog;
window.saveEditTags = saveEditTags;
window.removeCoverArtInModal = removeCoverArtInModal;
window.processCoverImageFile = processCoverImageFile;
window.openFileInfoDialog = openFileInfoDialog;
window.openAutoDialog = openAutoDialog;
window.openRangeDialog = openRangeDialog;

