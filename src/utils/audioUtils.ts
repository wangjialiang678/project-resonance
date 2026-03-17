/**
 * 截取 WAV blob 的前 maxSeconds 秒。
 * 假设标准 44 字节 WAV header, PCM 16-bit, 可变 sampleRate/channels。
 * 如果 WAV 已经短于 maxSeconds，直接返回原 blob。
 * 如果输入不是有效 WAV，返回原 blob（安全降级）。
 */
export async function truncateWav(wavBlob: Blob, maxSeconds: number): Promise<Blob> {
  const buffer = await wavBlob.arrayBuffer();

  // 安全校验：至少需要 44 字节的 WAV header
  if (buffer.byteLength < 44) return wavBlob;

  const view = new DataView(buffer);

  // 校验 RIFF/WAVE 魔数
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (riff !== 'RIFF' || wave !== 'WAVE') return wavBlob;

  const numChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);

  // 合理性检查
  if (sampleRate === 0 || numChannels === 0 || bitsPerSample === 0) return wavBlob;

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
