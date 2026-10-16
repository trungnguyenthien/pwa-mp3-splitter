/**
 * MP3 Splitter Web Worker
 * Handles MP3 frame indexing, ID3v2 detection, and lossless slicing without audio decoding.
 */

const BITRATES_MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

const SAMPLERATES = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000],  // MPEG 2.5
};

self.onmessage = function (event) {
  const { action, payload } = event.data;

  try {
    if (action === 'indexMp3') {
      indexMp3(payload.buffer);
    } else if (action === 'sliceMp3') {
      sliceMp3(payload);
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      action,
      error: error.message || String(error),
    });
  }
};

/**
 * Parses ID3v2 tag and builds frame offset table.
 */
function indexMp3(buffer) {
  const bytes = new Uint8Array(buffer);
  const totalLength = bytes.length;

  let offset = 0;
  let id3Size = 0;

  // Check for ID3v2 header: "ID3" (0x49, 0x44, 0x33)
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
    offset = Math.min(id3Size, totalLength);
  }

  // Pre-allocate frame offsets buffer
  let capacity = 32768;
  let frameOffsets = new Uint32Array(capacity);
  let frameCount = 0;

  let firstValidFrameHeader = null;
  let firstAudioFrameIndex = 0;
  let hasXingHeader = false;
  let lastReportedProgress = -1;
  let detectedBitrateSum = 0;
  let detectedBitrates = new Set();

  while (offset + 4 <= totalLength) {
    // Check for trailing ID3v1 tag ("TAG")
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

    // Sync word: 11 bits set (0xFF, upper 3 bits of b1)
    if (b0 === 0xff && (b1 & 0xe0) === 0xe0) {
      const b2 = bytes[offset + 2];
      const b3 = bytes[offset + 3];

      const mpegVersion = (b1 >> 3) & 0x03; // 3: M1, 2: M2, 0: M2.5
      const layer = (b1 >> 1) & 0x03;       // 1: Layer III
      const protection = b1 & 0x01;         // 0: with CRC (2 extra bytes), 1: no CRC
      const bitrateIdx = (b2 >> 4) & 0x0f;
      const sampleRateIdx = (b2 >> 2) & 0x03;
      const padding = (b2 >> 1) & 0x01;
      const channelMode = (b3 >> 6) & 0x03; // 3 = mono, 0..2 = stereo

      if (
        mpegVersion !== 1 &&
        layer === 1 && // Layer III (MP3)
        bitrateIdx > 0 &&
        bitrateIdx < 15 &&
        sampleRateIdx < 3
      ) {
        const bitrates = mpegVersion === 3 ? BITRATES_MPEG1_L3 : BITRATES_MPEG2_L3;
        const bitrateKbps = bitrates[bitrateIdx];
        const sampleRate = SAMPLERATES[mpegVersion][sampleRateIdx];

        let frameLength = 0;
        if (mpegVersion === 3) {
          // MPEG 1 Layer III
          frameLength = Math.floor((144 * bitrateKbps * 1000) / sampleRate) + padding;
        } else {
          // MPEG 2 / 2.5 Layer III
          frameLength = Math.floor((72 * bitrateKbps * 1000) / sampleRate) + padding;
        }

        if (frameLength >= 4 && offset + frameLength <= totalLength) {
          // Check if this is the first frame and if it is a Xing / Info / VBRI header
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

              // "Xing" (0x58, 0x69, 0x6e, 0x67) or "Info" (0x49, 0x6e, 0x66, 0x6f)
              if (
                (x0 === 0x58 && x1 === 0x69 && x2 === 0x6e && x3 === 0x67) ||
                (x0 === 0x49 && x1 === 0x6e && x2 === 0x66 && x3 === 0x6f)
              ) {
                hasXingHeader = true;
              }
            }

            // Also check VBRI at offset + 36
            if (!hasXingHeader && offset + 40 <= totalLength) {
              if (
                bytes[offset + 36] === 0x56 &&
                bytes[offset + 37] === 0x42 &&
                bytes[offset + 38] === 0x52 &&
                bytes[offset + 39] === 0x49
              ) {
                hasXingHeader = true;
              }
            }
          }

          // Expand buffer if needed
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

          // Progress report every ~5%
          const progress = Math.floor((offset / totalLength) * 100);
          if (progress !== lastReportedProgress && progress % 5 === 0) {
            lastReportedProgress = progress;
            self.postMessage({ type: 'indexProgress', progress });
          }

          continue;
        }
      }
    }

    // If not a valid sync, advance 1 byte to resync
    offset++;
  }

  if (frameCount === 0 || !firstValidFrameHeader) {
    throw new Error('No valid MP3 audio frames found in file.');
  }

  // Trim to actual frame count
  const trimmedOffsets = frameOffsets.subarray(0, frameCount);

  // If Xing/Info header was detected in the first frame, exclude it from audio duration calculation
  if (hasXingHeader && frameCount > 1) {
    firstAudioFrameIndex = 1;
  }

  const audioFrameCount = frameCount - firstAudioFrameIndex;
  const frameDuration = firstValidFrameHeader.samplesPerFrame / firstValidFrameHeader.sampleRate;
  const duration = audioFrameCount * frameDuration;
  const avgBitrate = Math.round(detectedBitrateSum / frameCount);
  const isVbr = detectedBitrates.size > 1;

  self.postMessage(
    {
      type: 'indexComplete',
      index: {
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
      },
    },
    [trimmedOffsets.buffer]
  );
}

/**
 * Losslessly extracts frames for a part and prepends a clean ID3v2.3 tag with TIT2.
 */
function sliceMp3({ buffer, startByte, endByte, partName, id }) {
  const sourceBytes = new Uint8Array(buffer);
  const safeEndByte = Math.min(endByte, sourceBytes.length);
  const safeStartByte = Math.max(0, startByte);

  if (safeEndByte <= safeStartByte) {
    throw new Error('Invalid byte slice range for split.');
  }

  const audioSlice = sourceBytes.subarray(safeStartByte, safeEndByte);

  // Build ID3v2.3 header + TIT2 frame
  const titleBytes = new TextEncoder().encode(partName || 'Split Part');
  // TIT2 body: 0x03 (UTF-8 encoding) + title bytes
  const frameBodyLen = 1 + titleBytes.length;
  const frameHeader = new Uint8Array(10);
  // "TIT2"
  frameHeader[0] = 0x54;
  frameHeader[1] = 0x49;
  frameHeader[2] = 0x54;
  frameHeader[3] = 0x32;
  // Frame size (32-bit int)
  frameHeader[4] = (frameBodyLen >> 24) & 0xff;
  frameHeader[5] = (frameBodyLen >> 16) & 0xff;
  frameHeader[6] = (frameBodyLen >> 8) & 0xff;
  frameHeader[7] = frameBodyLen & 0xff;
  // Flags: 0, 0
  frameHeader[8] = 0x00;
  frameHeader[9] = 0x00;

  const totalTagBodySize = 10 + frameBodyLen;

  // ID3v2 header: 10 bytes
  const id3Header = new Uint8Array(10);
  // "ID3"
  id3Header[0] = 0x49;
  id3Header[1] = 0x44;
  id3Header[2] = 0x33;
  // Version 2.3.0
  id3Header[3] = 0x03;
  id3Header[4] = 0x00;
  id3Header[5] = 0x00; // flags
  // Synchsafe integer for totalTagBodySize
  id3Header[6] = (totalTagBodySize >> 21) & 0x7f;
  id3Header[7] = (totalTagBodySize >> 14) & 0x7f;
  id3Header[8] = (totalTagBodySize >> 7) & 0x7f;
  id3Header[9] = totalTagBodySize & 0x7f;

  // Combine: id3Header (10) + frameHeader (10) + frameBody (1 + titleBytes.length) + audioSlice
  const totalLength = 10 + 10 + frameBodyLen + audioSlice.length;
  const output = new Uint8Array(totalLength);

  let writePtr = 0;
  output.set(id3Header, writePtr);
  writePtr += 10;
  output.set(frameHeader, writePtr);
  writePtr += 10;
  output[writePtr] = 0x03; // UTF-8 indicator
  writePtr += 1;
  output.set(titleBytes, writePtr);
  writePtr += titleBytes.length;
  output.set(audioSlice, writePtr);

  self.postMessage(
    {
      type: 'sliceComplete',
      id,
      partName,
      arrayBuffer: output.buffer,
    },
    [output.buffer]
  );
}
