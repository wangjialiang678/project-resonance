import { Blob as NodeBlob } from 'node:buffer';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { truncateWav } from '@/utils/audioUtils';

const OriginalBlob = globalThis.Blob;

function createWavBlob({
  durationSeconds,
  sampleRate = 16000,
  numChannels = 1,
  bitsPerSample = 16,
}: {
  durationSeconds: number;
  sampleRate?: number;
  numChannels?: number;
  bitsPerSample?: number;
}) {
  const headerSize = 44;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = sampleRate * numChannels * bytesPerSample * durationSeconds;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  return new NodeBlob([buffer], { type: 'audio/wav' });
}

describe('truncateWav', () => {
  beforeAll(() => {
    vi.stubGlobal('Blob', NodeBlob as unknown as typeof Blob);
  });

  afterAll(() => {
    vi.stubGlobal('Blob', OriginalBlob);
  });

  it('returns the original blob when it is already shorter than the limit', async () => {
    const wavBlob = createWavBlob({ durationSeconds: 2 });

    const result = await truncateWav(wavBlob, 10);

    expect(result).toBe(wavBlob);
  });

  it('truncates data and updates the wav header sizes', async () => {
    const wavBlob = createWavBlob({ durationSeconds: 3, sampleRate: 8000, numChannels: 2 });

    const result = await truncateWav(wavBlob, 1);
    const truncatedBuffer = await result.arrayBuffer();
    const view = new DataView(truncatedBuffer);

    expect(result.size).toBe(44 + 8000 * 2 * 2);
    expect(view.getUint32(4, true)).toBe(result.size - 8);
    expect(view.getUint32(40, true)).toBe(8000 * 2 * 2);
  });
});
