/**
 * 截取 WAV blob 的前 maxSeconds 秒。
 * 假设标准 44 字节 WAV header, PCM 16-bit, 可变 sampleRate/channels。
 * 如果 WAV 已经短于 maxSeconds，直接返回原 blob。
 */
export async function truncateWav(wavBlob: Blob, maxSeconds: number): Promise<Blob> {
  const buffer = await wavBlob.arrayBuffer();
  const view = new DataView(buffer);

  const numChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);

  const bytesPerSecond = sampleRate * numChannels * (bitsPerSample / 8);
  const maxDataBytes = bytesPerSecond * maxSeconds;
  const headerSize = 44;
  const currentDataSize = buffer.byteLength - headerSize;

  if (currentDataSize <= maxDataBytes) return wavBlob;

  const newDataSize = maxDataBytes;
  const newFileSize = headerSize + newDataSize;
  const newBuffer = buffer.slice(0, newFileSize);
  const newView = new DataView(newBuffer);

  newView.setUint32(4, newFileSize - 8, true);
  newView.setUint32(40, newDataSize, true);

  return new Blob([newBuffer], { type: 'audio/wav' });
}
