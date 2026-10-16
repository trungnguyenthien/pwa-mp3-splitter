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
    if (action === 'indexAudio' || action === 'indexMp3') {
      const bytes = new Uint8Array(payload.buffer);
      if (isM4aBuffer(bytes)) {
        indexM4a(payload.buffer);
      } else {
        indexMp3(payload.buffer);
      }
    } else if (action === 'sliceAudio' || action === 'sliceMp3' || action === 'sliceM4a') {
      if (payload.format === 'm4a') {
        sliceM4a(payload);
      } else {
        sliceMp3(payload);
      }
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      action,
      error: error.message || String(error),
    });
  }
};

function isM4aBuffer(bytes) {
  if (bytes.length < 8) return false;
  return (
    (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) ||
    (bytes[0] === 0x66 && bytes[1] === 0x74 && bytes[2] === 0x79 && bytes[3] === 0x70)
  );
}

function packAtom(name, payload) {
  const buf = new Uint8Array(8 + payload.length);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 8 + payload.length);
  for (let i = 0; i < 4; i++) buf[4 + i] = name.charCodeAt(i);
  buf.set(payload, 8);
  return buf;
}

function concatBuffers(...arrays) {
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

function makeMetaUdta(metadataOrTitle) {
  const meta = typeof metadataOrTitle === 'string' ? { title: metadataOrTitle } : (metadataOrTitle || {});
  const atoms = [];

  function addStringAtom(name, str) {
    if (!str) return;
    const strBytes = new TextEncoder().encode(str);
    const dataPayload = concatBuffers(new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0]), strBytes);
    const dataAtom = packAtom('data', dataPayload);
    atoms.push(packAtom(name, dataAtom));
  }

  addStringAtom('\xA9nam', meta.title);
  addStringAtom('\xA9ART', meta.artist);
  addStringAtom('aART', meta.artist);
  addStringAtom('\xA9alb', meta.album);
  if (meta.year) addStringAtom('\xA9day', String(meta.year));

  if (meta.imageBytes && meta.imageBytes.length > 0) {
    const isPng = meta.imageMime && meta.imageMime.includes('png');
    const typeFlag = isPng ? 14 : 13;
    const dataPayload = concatBuffers(new Uint8Array([0, 0, 0, typeFlag, 0, 0, 0, 0]), meta.imageBytes);
    const dataAtom = packAtom('data', dataPayload);
    atoms.push(packAtom('covr', dataAtom));
  }

  if (atoms.length === 0) return new Uint8Array(0);

  const ilstPayload = concatBuffers(...atoms);
  const ilstAtom = packAtom('ilst', ilstPayload);
  const metaPayload = concatBuffers(new Uint8Array([0, 0, 0, 0]), ilstAtom);
  const metaAtom = packAtom('meta', metaPayload);
  return packAtom('udta', metaAtom);
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

/**
 * Indexes an M4A (AAC / ALAC in ISO-BMFF) container losslessly.
 */
function indexM4a(buffer) {
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

  self.postMessage(
    {
      type: 'indexComplete',
      index: {
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
      },
    },
    [sampleOffsets.buffer, sampleSizes.buffer, peaks.buffer]
  );
}

/**
 * Losslessly slices AAC audio frames and repacks into a clean, compliant M4A file.
 */
function sliceM4a({ buffer, sampleSizes, timescale, mvhdTimescale, rawAtoms, partName, id }) {
  const audioBytes = new Uint8Array(buffer);
  const numSamples = sampleSizes.length;

  const stszPayload = new Uint8Array(12 + numSamples * 4);
  const stszView = new DataView(stszPayload.buffer);
  stszView.setUint32(0, 0); // version/flags
  stszView.setUint32(4, 0); // uniform size = 0
  stszView.setUint32(8, numSamples);
  for (let i = 0; i < numSamples; i++) {
    stszView.setUint32(12 + i * 4, sampleSizes[i]);
  }
  const newStsz = packAtom('stsz', stszPayload);

  const sttsPayload = new Uint8Array(16);
  const sttsView = new DataView(sttsPayload.buffer);
  sttsView.setUint32(0, 0);
  sttsView.setUint32(4, 1);
  sttsView.setUint32(8, numSamples);
  sttsView.setUint32(12, 1024);
  const newStts = packAtom('stts', sttsPayload);

  const stscPayload = new Uint8Array(20);
  const stscView = new DataView(stscPayload.buffer);
  stscView.setUint32(0, 0);
  stscView.setUint32(4, 1);
  stscView.setUint32(8, 1);
  stscView.setUint32(12, numSamples);
  stscView.setUint32(16, 1);
  const newStsc = packAtom('stsc', stscPayload);

  const newAudioDuration = numSamples * 1024;
  const mdhdPayload = new Uint8Array(rawAtoms.mdhd);
  const mdhdView = new DataView(mdhdPayload.buffer, mdhdPayload.byteOffset, mdhdPayload.byteLength);
  if (mdhdView.getUint8(0) === 0) {
    mdhdView.setUint32(16, newAudioDuration);
  } else {
    mdhdView.setBigUint64(24, BigInt(newAudioDuration));
  }
  const newMdhd = packAtom('mdhd', mdhdPayload);

  const newMvhdDuration = Math.round((newAudioDuration * mvhdTimescale) / timescale);
  const mvhdPayload = new Uint8Array(rawAtoms.mvhd);
  const mvhdView = new DataView(mvhdPayload.buffer, mvhdPayload.byteOffset, mvhdPayload.byteLength);
  if (mvhdView.getUint8(0) === 0) {
    mvhdView.setUint32(16, newMvhdDuration);
  } else {
    mvhdView.setBigUint64(24, BigInt(newMvhdDuration));
  }
  const newMvhd = packAtom('mvhd', mvhdPayload);

  const tkhdPayload = new Uint8Array(rawAtoms.tkhd);
  const tkhdView = new DataView(tkhdPayload.buffer, tkhdPayload.byteOffset, tkhdPayload.byteLength);
  if (tkhdView.getUint8(0) === 0) {
    tkhdView.setUint32(20, newMvhdDuration);
  } else {
    tkhdView.setBigUint64(28, BigInt(newMvhdDuration));
  }
  const newTkhd = packAtom('tkhd', tkhdPayload);

  const udtaBytes = makeMetaUdta(payload.metadata || partName);

  function assembleMoov(mdatOffset) {
    const stcoPayload = new Uint8Array(12);
    const stcoView = new DataView(stcoPayload.buffer);
    stcoView.setUint32(0, 0);
    stcoView.setUint32(4, 1);
    stcoView.setUint32(8, mdatOffset);
    const newStco = packAtom('stco', stcoPayload);

    const stblPayload = concatBuffers(packAtom('stsd', rawAtoms.stsd), newStts, newStsc, newStsz, newStco);
    const newStbl = packAtom('stbl', stblPayload);
    const minfPayload = concatBuffers(
      rawAtoms.smhd ? packAtom('smhd', rawAtoms.smhd) : new Uint8Array(0),
      rawAtoms.dinf ? packAtom('dinf', rawAtoms.dinf) : new Uint8Array(0),
      newStbl
    );
    const newMinf = packAtom('minf', minfPayload);
    const mdiaPayload = concatBuffers(newMdhd, packAtom('hdlr', rawAtoms.hdlr), newMinf);
    const newMdia = packAtom('mdia', mdiaPayload);
    const trakPayload = concatBuffers(newTkhd, newMdia);
    const newTrak = packAtom('trak', trakPayload);
    const moovPayload = concatBuffers(newMvhd, newTrak, udtaBytes);
    return packAtom('moov', moovPayload);
  }

  const ftypBytes = rawAtoms.ftyp;
  const dummyMoov = assembleMoov(0);
  const mdatDataOffset = ftypBytes.length + dummyMoov.length + 8;
  const finalMoov = assembleMoov(mdatDataOffset);

  const newMdat = packAtom('mdat', audioBytes);
  const output = concatBuffers(ftypBytes, finalMoov, newMdat);

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

/**
 * Parses ID3v2 tag and builds frame offset table for MP3.
 */
function indexMp3(buffer) {
  const bytes = new Uint8Array(buffer);
  const totalLength = bytes.length;

  // Fast signature check for non-MP3 audio containers
  if (totalLength >= 8) {
    // WAV ("RIFF" ... "WAVE")
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
      throw new Error(
        'Selected file is in WAV format, not MP3. MP3 Splitter is a lossless cutter exclusively designed for .mp3 audio frames.'
      );
    }
    // FLAC ("fLaC")
    if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) {
      throw new Error(
        'Selected file is in FLAC format, not MP3. MP3 Splitter is a lossless cutter exclusively designed for .mp3 audio frames.'
      );
    }
    // OGG ("OggS")
    if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
      throw new Error(
        'Selected file is in OGG format, not MP3. MP3 Splitter is a lossless cutter exclusively designed for .mp3 audio frames.'
      );
    }
  }

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
  let totalFrameBytes = 0;

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
          totalFrameBytes += frameLength;

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

  // Calculate audio frame coverage density
  const audioDataBytes = Math.max(1, totalLength - id3Size);
  const coverageRatio = totalFrameBytes / audioDataBytes;

  // In real MP3 files, valid frames account for > 85% of data.
  // In non-MP3 files (e.g. AAC/M4A or arbitrary binary), accidental syncs cover < 5%.
  if (frameCount < 5 || coverageRatio < 0.45) {
    throw new Error(
      `File appears to be an incompatible audio format or corrupted MP3. Only ${frameCount} isolated frames found (${(coverageRatio * 100).toFixed(1)}% MP3 frame density). Please use a valid .mp3 file.`
    );
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

  const peaks = computeMp3PeaksFromFrames(bytes, trimmedOffsets, trimmedOffsets.length, duration);

  self.postMessage(
    {
      type: 'indexComplete',
      index: {
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
      },
    },
    [trimmedOffsets.buffer, peaks.buffer]
  );
}

/**
 * Fast, zero-PCM memory loudness peak computation from MP3 frame headers (global_gain).
 * Never triggers WebAudio OOM crashes on large files (e.g. 85MB+).
 */
function computeMp3PeaksFromFrames(bytes, frameOffsets, frameCount, duration) {
  const windowSec = 0.05; // 50ms standard resolution
  const totalWindows = Math.max(1, Math.ceil(duration / windowSec));
  const peaks = new Float32Array(totalWindows);
  peaks.fill(-60);

  if (frameCount === 0) return peaks;

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
      // Normal music falls between 150-200 (-36 dB to -10 dB)
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

/**
 * Fast, zero-PCM memory loudness peak computation from M4A (AAC) packet sizes.
 */
function computeM4aPeaksFromSamples(sampleSizes, duration) {
  const windowSec = 0.05;
  const totalWindows = Math.max(1, Math.ceil(duration / windowSec));
  const peaks = new Float32Array(totalWindows);
  peaks.fill(-60);

  const sampleCount = sampleSizes.length;
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

  // Build ID3v2.3 tag with Title, Artist, Album, Year, and Cover Art (APIC)
  const meta = Object.assign({}, payload.metadata);
  if (!meta.title) meta.title = partName || 'Split Part';
  const id3Tag = makeId3v2Tag(meta);

  const totalLength = id3Tag.length + audioSlice.length;
  const output = new Uint8Array(totalLength);
  output.set(id3Tag, 0);
  output.set(audioSlice, id3Tag.length);

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
    frame[10] = 0x03; // UTF-8
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
