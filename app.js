/**
 * MP3 Splitter PWA — Main Application Controller
 * Pure Vanilla JavaScript (ES6)
 * Follows PWA Standards & WebAPK Isolation Rules
 */

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
    silenceDb: -45,
    minSilenceSec: 1.5,
    minPartSec: 30,
  },
  ui: {
    loading: false,
    progress: 0,
    loadingMessage: '',
    dialog: null, // 'auto' | 'range' | 'ios' | null
    previewId: null, // part id or 'whole' or null
    currentTime: 0,
    isWholePlaying: false,
  },
  deletedPartStack: [],
  deferredInstallPrompt: null,
  wakeLock: null,
};

// Worker instance
let mp3Worker = null;
let sharedAudioContext = null;

// DOM Elements
const elements = {
  // Top bar
  btnInstall: document.getElementById('btnInstall'),
  offlineChip: document.getElementById('offlineChip'),

  // Dropzone / File Picker
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('fileInput'),
  btnChooseFile: document.getElementById('btnChooseFile'),
  fileInfoSection: document.getElementById('fileInfoSection'),
  btnChangeFile: document.getElementById('btnChangeFile'),
  fileNameDisplay: document.getElementById('fileNameDisplay'),
  statDuration: document.getElementById('statDuration'),
  statBitrate: document.getElementById('statBitrate'),
  statSampleRate: document.getElementById('statSampleRate'),
  statSize: document.getElementById('statSize'),

  // Loading
  loadingSection: document.getElementById('loadingSection'),
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

// =============================================================================
// Initialization
// =============================================================================
window.addEventListener('DOMContentLoaded', () => {
  initWorker();
  initServiceWorker();
  initEvents();
  initCanvasResize();
});

// =============================================================================
// Web Worker Lifecycle
// =============================================================================
function initWorker() {
  if (window.Worker) {
    mp3Worker = new Worker('./mp3-worker.js?v=1');
    mp3Worker.onmessage = handleWorkerMessage;
    mp3Worker.onerror = (err) => {
      console.error('Worker error:', err);
      showSnackbar('Worker processing error: ' + (err.message || 'Unknown error'));
      hideLoading();
    };
  } else {
    showSnackbar('Your browser does not support Web Workers.');
  }
}

function handleWorkerMessage(event) {
  const { type, index, progress, id, partName, arrayBuffer, error } = event.data;

  if (type === 'indexProgress') {
    updateLoadingProgress(progress, 'Indexing MP3 frames...');
  } else if (type === 'indexComplete') {
    onIndexComplete(index);
  } else if (type === 'sliceComplete') {
    onSliceComplete(id, partName, arrayBuffer);
  } else if (type === 'error') {
    hideLoading();
    showSnackbar('Error: ' + error);
  }
}

// =============================================================================
// Service Worker Registration & PWA Standards
// =============================================================================
function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((reg) => {
        // If activated, show offline ready chip
        if (reg.active) {
          elements.offlineChip.classList.remove('hidden');
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
                elements.offlineChip.classList.remove('hidden');
              }
            });
          }
        });
      })
      .catch((err) => {
        console.warn('Service Worker registration failed:', err);
      });
  }

  // PWA Install Prompt handling
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    elements.btnInstall.classList.remove('hidden');
  });

  window.addEventListener('appinstalled', () => {
    state.deferredInstallPrompt = null;
    elements.btnInstall.classList.add('hidden');
    showSnackbar('MP3 Splitter installed successfully!');
  });
}

// =============================================================================
// Event Handlers Setup
// =============================================================================
function initEvents() {
  // File Picker
  elements.btnChooseFile.addEventListener('click', (e) => {
    e.stopPropagation();
    elements.fileInput.click();
  });

  elements.dropzone.addEventListener('click', () => {
    elements.fileInput.click();
  });

  elements.btnChangeFile.addEventListener('click', () => {
    elements.fileInput.value = '';
    elements.fileInput.click();
  });

  elements.fileInput.addEventListener('change', handleFileSelected);

  // Drag and drop
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

  // Install button
  elements.btnInstall.addEventListener('click', handleInstallClick);
  elements.btnCloseIosModal.addEventListener('click', () => closeDialog());
  elements.btnGotItIos.addEventListener('click', () => closeDialog());

  // Waveform canvas interactions
  initWaveformEvents();

  // Dialog triggers
  elements.btnOpenAuto.addEventListener('click', openAutoDialog);
  elements.btnOpenRange.addEventListener('click', openRangeDialog);

  // Auto Dialog actions
  elements.btnCloseAutoDialog.addEventListener('click', () => closeDialog());
  elements.btnCancelAuto.addEventListener('click', () => closeDialog());
  elements.btnSelectAllSuggestions.addEventListener('click', () => setAllSuggestionsSelected(true));
  elements.btnClearSuggestions.addEventListener('click', () => setAllSuggestionsSelected(false));
  elements.btnAddSelectedAuto.addEventListener('click', addSelectedSuggestions);

  // Accordion toggle
  elements.btnToggleSettings.addEventListener('click', () => {
    elements.settingsAccordion.classList.toggle('open');
  });

  // Settings sliders
  elements.inputSilenceDb.addEventListener('input', (e) => {
    state.settings.silenceDb = parseFloat(e.target.value);
    elements.valSilenceDb.textContent = `${state.settings.silenceDb} dB`;
  });

  elements.inputMinSilence.addEventListener('input', (e) => {
    state.settings.minSilenceSec = parseFloat(e.target.value);
    elements.valMinSilence.textContent = `${state.settings.minSilenceSec}s`;
  });

  elements.inputMinPart.addEventListener('input', (e) => {
    state.settings.minPartSec = parseFloat(e.target.value);
    elements.valMinPart.textContent = `${state.settings.minPartSec}s`;
  });

  elements.btnReanalyze.addEventListener('click', () => {
    analyzeSilence();
  });

  // Range Dialog actions
  elements.btnCloseRangeDialog.addEventListener('click', () => closeDialog());
  elements.btnCancelRange.addEventListener('click', () => closeDialog());
  elements.btnAddPartRange.addEventListener('click', addRangePart);
  elements.inputRangeStart.addEventListener('input', validateRangeInputs);
  elements.inputRangeEnd.addEventListener('input', validateRangeInputs);

  elements.chipStartFromZero.addEventListener('click', () => {
    elements.inputRangeStart.value = '0';
    validateRangeInputs();
  });

  elements.chipEndAtTotal.addEventListener('click', () => {
    if (state.index) {
      elements.inputRangeEnd.value = state.index.duration.toFixed(2);
      validateRangeInputs();
    }
  });

  // Parts List actions
  elements.btnClearAllParts.addEventListener('click', () => {
    if (state.parts.length === 0) return;
    if (confirm('Clear all parts from the list?')) {
      state.parts = [];
      renderParts();
      drawWaveform();
      showSnackbar('All parts cleared.');
    }
  });

  // Shared Preview Audio events
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
  });

  elements.previewAudio.addEventListener('play', () => {
    if (state.ui.previewId === 'whole') {
      state.ui.isWholePlaying = true;
      elements.playIcon.classList.add('hidden');
      elements.pauseIcon.classList.remove('hidden');
    }
  });

  // Play/Pause whole file
  elements.btnPlayWholeFile.addEventListener('click', togglePlayWholeFile);

  // Close dialog on backdrop click or ESC key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDialog();
    }
  });

  [elements.autoSplitDialog, elements.rangeDialog, elements.iosInstallModal].forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        closeDialog();
      }
    });
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
  // Check extension or MIME type
  const isMp3 =
    file.name.toLowerCase().endsWith('.mp3') ||
    file.type === 'audio/mpeg' ||
    file.type === 'audio/mp3';

  if (!isMp3) {
    showSnackbar('Selected file is not recognized as an MP3 audio file.');
    return;
  }

  // Warn if file > 100 MB
  if (file.size > 100 * 1024 * 1024) {
    const proceed = confirm(
      'This file is larger than 100 MB. Processing might take a moment on mobile devices. Continue?'
    );
    if (!proceed) return;
  }

  // Stop any active preview
  stopPreview();

  // Reset state
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
  disableActionButtons();

  showLoading('Reading MP3 file...');

  try {
    const arrayBuffer = await file.arrayBuffer();
    // Keep a copy in memory for slicing and send a copy to worker
    state.file.buffer = arrayBuffer;

    updateLoadingProgress(10, 'Indexing audio frames in worker...');

    // Post to worker (transfer a cloned slice so main thread keeps state.file.buffer)
    const workerBuffer = arrayBuffer.slice(0);
    mp3Worker.postMessage(
      {
        action: 'indexMp3',
        payload: { buffer: workerBuffer },
      },
      [workerBuffer]
    );
  } catch (err) {
    console.error('File read error:', err);
    hideLoading();
    showSnackbar('Failed to read file: ' + err.message);
  }
}

function onIndexComplete(index) {
  state.index = index;

  // Update UI stats
  elements.fileNameDisplay.textContent = state.file.name;
  elements.statDuration.textContent = formatTime(index.duration);
  elements.statBitrate.textContent = `${index.bitrate} kbps ${index.isVbr ? '(VBR)' : '(CBR)'}`;
  elements.statSampleRate.textContent = `${(index.sampleRate / 1000).toFixed(1)} kHz`;
  elements.statSize.textContent = `${(state.file.size / (1024 * 1024)).toFixed(1)} MB`;
  elements.totalTimeDisplay.textContent = formatTime(index.duration);
  elements.currentTimeDisplay.textContent = '00:00.0';

  // Show file info card & hide empty dropzone
  elements.dropzone.classList.add('hidden');
  elements.fileInfoSection.classList.remove('hidden');
  elements.waveformCard.classList.remove('hidden');

  enableActionButtons();

  updateLoadingProgress(50, 'Analyzing audio waveform...');

  // Start Peak / Loudness Analysis for waveform and silence detection
  computePeaks();
}

// =============================================================================
// Waveform & Loudness Peak Computation (Chunked Web Audio)
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
    // Each peak window represents 50 ms (0.05 s)
    const windowSec = 0.05;
    const totalWindows = Math.max(1, Math.ceil(duration / windowSec));
    const peaks = new Float32Array(totalWindows);
    peaks.fill(-60); // Default silence floor

    // Process file in ~30s chunks
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

      const chunkBuffer = state.file.buffer.slice(startByte, endByte);

      try {
        const audioBuffer = await decodeAudioDataAsync(sharedAudioContext, chunkBuffer);
        const channelData = audioBuffer.getChannelData(0);
        const sampleRate = audioBuffer.sampleRate;
        const windowSizeSamples = Math.floor(sampleRate * windowSec);

        const chunkStartWindow = Math.floor(chunkStartSec / windowSec);
        const chunkWindows = Math.floor(audioBuffer.duration / windowSec);

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
          // Convert to dBFS (-60 to 0)
          const db = Math.max(-60, 20 * Math.log10(rms + 1e-6));
          peaks[globalIdx] = db;
        }
      } catch (decodeErr) {
        // Individual chunk decode failure: skip gently
        console.warn('Chunk decode error:', decodeErr);
      }

      const progress = 50 + Math.floor(((c + 1) / totalChunks) * 50);
      updateLoadingProgress(progress, `Analyzing audio waveform (${c + 1}/${totalChunks})...`);
    }

    state.peaks = peaks;
    hideLoading();
    drawWaveform();
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
  // Gentle synthetic waveform so UI is always fully visual
  for (let i = 0; i < totalWindows; i++) {
    fallbackPeaks[i] = -30 + Math.sin(i * 0.1) * 15;
  }
  state.peaks = fallbackPeaks;
  hideLoading();
  drawWaveform();
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
  if (!canvas || !state.index) return;

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

  // 1. Draw Waveform Bars
  const centerY = h / 2;
  const maxBarHeight = (h - 16) / 2;

  // Wave bar color
  const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const barColor = isDark ? '#D0BCFF' : '#6750A4';
  ctx.fillStyle = barColor;

  for (let b = 0; b < numBars; b++) {
    const x = b * step;
    const windowIdx = Math.floor((b / numBars) * totalWindows);
    const db = peaks[windowIdx] !== undefined ? peaks[windowIdx] : -60;

    // Normalize -60 dB .. 0 dB to 0.05 .. 1.0
    const norm = Math.max(0.05, Math.min(1.0, (db + 60) / 60));
    const barHeight = norm * maxBarHeight;

    ctx.beginPath();
    ctx.roundRect(x, centerY - barHeight, barWidth, barHeight * 2, 2);
    ctx.fill();
  }

  // 2. Draw Shaded Overlays for Added Parts
  state.parts.forEach((part, index) => {
    const startX = (part.start / state.index.duration) * w;
    const endX = (part.end / state.index.duration) * w;
    const partWidth = Math.max(2, endX - startX);

    // Subtle shaded background for part
    ctx.fillStyle = 'rgba(125, 82, 96, 0.18)';
    ctx.fillRect(startX, 0, partWidth, h);

    // Border lines
    ctx.strokeStyle = 'rgba(125, 82, 96, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, 0);
    ctx.lineTo(startX, h);
    ctx.moveTo(endX, 0);
    ctx.lineTo(endX, h);
    ctx.stroke();

    // Part index badge on canvas
    ctx.fillStyle = isDark ? '#FFD8E4' : '#7D5260';
    ctx.font = '600 10px Roboto, sans-serif';
    ctx.fillText(`#${index + 1} ${part.name}`, startX + 4, 14);
  });
}

function initWaveformEvents() {
  const wrapper = elements.canvasWrapper;

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

  elements.autoAnalyzingState.classList.remove('hidden');
  elements.suggestionsList.innerHTML = '';

  const peaks = state.peaks;
  const duration = state.index.duration;
  const windowSec = 0.05;
  const frameDuration = state.index.frameDuration;

  const thresholdDb = state.settings.silenceDb;
  const minSilenceSec = state.settings.minSilenceSec;
  const minPartSec = state.settings.minPartSec;

  const minSilenceWindows = Math.ceil(minSilenceSec / windowSec);

  // Find consecutive silent windows
  const silentRanges = [];
  let inSilence = false;
  let silenceStart = 0;

  for (let i = 0; i < peaks.length; i++) {
    if (peaks[i] <= thresholdDb) {
      if (!inSilence) {
        inSilence = true;
        silenceStart = i;
      }
    } else {
      if (inSilence) {
        inSilence = false;
        const silenceLen = i - silenceStart;
        if (silenceLen >= minSilenceWindows) {
          silentRanges.push({
            start: silenceStart * windowSec,
            end: i * windowSec,
            mid: ((silenceStart + i) / 2) * windowSec,
          });
        }
      }
    }
  }

  // Trailing silence
  if (inSilence && peaks.length - silenceStart >= minSilenceWindows) {
    silentRanges.push({
      start: silenceStart * windowSec,
      end: peaks.length * windowSec,
      mid: ((silenceStart + peaks.length) / 2) * windowSec,
    });
  }

  // Generate cut points
  const cutPoints = [];
  silentRanges.forEach((range) => {
    // Snap to nearest MP3 frame time
    const snappedTime = Math.round(range.mid / frameDuration) * frameDuration;
    if (snappedTime > 0 && snappedTime < duration) {
      cutPoints.push(snappedTime);
    }
  });

  // Build candidate parts between cut points
  const candidateBoundaries = [0, ...cutPoints, duration];
  let rawCandidates = [];

  for (let i = 0; i < candidateBoundaries.length - 1; i++) {
    const start = candidateBoundaries[i];
    const end = candidateBoundaries[i + 1];
    rawCandidates.push({ start, end });
  }

  // Merge parts shorter than minPartSec
  const filteredCandidates = [];
  for (let i = 0; i < rawCandidates.length; i++) {
    const cand = rawCandidates[i];
    if (cand.end - cand.start < minPartSec && filteredCandidates.length > 0) {
      // Merge into previous part
      filteredCandidates[filteredCandidates.length - 1].end = cand.end;
    } else {
      filteredCandidates.push({ ...cand });
    }
  }

  // Format suggestions
  state.suggestions = filteredCandidates.map((cand, idx) => {
    const padNum = String(idx + 1).padStart(2, '0');
    return {
      id: 'sug_' + Date.now() + '_' + idx,
      name: `Part ${padNum}`,
      start: cand.start,
      end: cand.end,
      duration: cand.end - cand.start,
      selected: true, // Selected by default for user convenience
    };
  });

  elements.autoAnalyzingState.classList.add('hidden');
  renderSuggestions();
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
    previewBtn.className = 'btn-icon';
    previewBtn.title = 'Preview this candidate part';
    previewBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
    `;
    previewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playAudioRange(sug.start, sug.end);
    });

    row.appendChild(checkbox);
    row.appendChild(info);
    row.appendChild(previewBtn);
    container.appendChild(row);
  });

  updateAddSelectedButton();
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

  // Sort parts stably by start time
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

  // Default suggested range
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

  // Snap start down and end up to frame boundaries
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

    // Index badge
    const badge = document.createElement('div');
    badge.className = 'part-badge';
    badge.textContent = `#${index + 1}`;

    // Center content (name input & time range)
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

    // Right actions (Preview, Delete, Split)
    const actions = document.createElement('div');
    actions.className = 'part-actions';

    // Preview button
    const btnPreview = document.createElement('button');
    btnPreview.type = 'button';
    btnPreview.className = 'btn-icon';
    btnPreview.title = 'Preview this part';
    btnPreview.ariaLabel = `Preview ${part.name}`;
    const isThisPreviewing = state.ui.previewId === part.id;
    btnPreview.innerHTML = isThisPreviewing
      ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
      : `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

    btnPreview.addEventListener('click', () => {
      togglePreviewPart(part);
    });

    // Delete button
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

    // Split button
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

  // 5-second Undo Toast
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
    // If not loaded into audio element yet
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

  const startFrame = Math.max(0, Math.floor(startSec / frameDuration));
  const endFrame = Math.min(frameOffsets.length, Math.ceil(endSec / frameDuration));

  const startByte = frameOffsets[startFrame] || 0;
  const endByte = endFrame < frameOffsets.length ? frameOffsets[endFrame] : state.file.buffer.byteLength;

  const slice = state.file.buffer.slice(startByte, endByte);
  const blob = new Blob([slice], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);

  elements.previewAudio.src = url;
  state.ui.previewId = partId;

  elements.previewAudio
    .play()
    .then(() => {
      renderParts();
    })
    .catch((err) => {
      console.warn('Playback error:', err);
      showSnackbar('Playback not allowed or audio format error.');
    });
}

function stopPreview() {
  if (!elements.previewAudio.paused) {
    elements.previewAudio.pause();
  }
  elements.previewAudio.removeAttribute('src');
  state.ui.previewId = null;
  state.ui.isWholePlaying = false;
  elements.playIcon.classList.remove('hidden');
  elements.pauseIcon.classList.add('hidden');
  renderParts();
}

// =============================================================================
// Lossless MP3 Slicing & Screen Wake Lock
// =============================================================================
async function splitPart(part) {
  if (part.status === 'working') return;

  // Request screen wake lock so screen doesn't sleep during splitting
  acquireWakeLock();

  part.status = 'working';
  renderParts();

  try {
    const frameOffsets = state.index.frameOffsets;
    const frameDuration = state.index.frameDuration;

    const startFrame = Math.max(0, Math.floor(part.start / frameDuration));
    const endFrame = Math.min(frameOffsets.length, Math.ceil(part.end / frameDuration));

    const startByte = frameOffsets[startFrame];
    const endByte = endFrame < frameOffsets.length ? frameOffsets[endFrame] : state.file.buffer.byteLength;

    // Send slice task to worker
    // We send slice buffer to worker to avoid UI freeze
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

  // If iOS Safari supports Web Share API with files, use it for "Save to Files"
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
        // User cancelled share dialog, safe to ignore
        return;
      }
    }
  }

  // Standard Anchor Download (Android / Desktop / Fallback)
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  showSnackbar(`Downloaded "${fileName}".`);

  // Revoke object URL after 60 seconds to prevent memory leak
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
    // Show iOS install instructions sheet
    state.ui.dialog = 'ios';
    elements.iosInstallModal.classList.add('open');
  }
}

// =============================================================================
// Dialog & UI State Helpers
// =============================================================================
function closeDialog() {
  elements.autoSplitDialog.classList.remove('open');
  elements.rangeDialog.classList.remove('open');
  elements.iosInstallModal.classList.remove('open');
  state.ui.dialog = null;
}

function showLoading(message) {
  state.ui.loading = true;
  elements.loadingSection.classList.remove('hidden');
  elements.loadingMessage.textContent = message;
  elements.loadingPercent.textContent = '0%';
  elements.loadingProgressBar.style.width = '0%';
}

function updateLoadingProgress(percent, message) {
  elements.loadingPercent.textContent = `${percent}%`;
  elements.loadingProgressBar.style.width = `${percent}%`;
  if (message) {
    elements.loadingMessage.textContent = message;
  }
}

function hideLoading() {
  state.ui.loading = false;
  elements.loadingSection.classList.add('hidden');
}

function enableActionButtons() {
  elements.btnOpenAuto.disabled = false;
  elements.btnOpenRange.disabled = false;
}

function disableActionButtons() {
  elements.btnOpenAuto.disabled = true;
  elements.btnOpenRange.disabled = true;
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
  // Strip characters illegal in filesystem names
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
