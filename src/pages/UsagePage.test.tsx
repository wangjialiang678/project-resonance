import { Blob as NodeBlob } from 'node:buffer';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import UsagePage from '@/pages/UsagePage';

const {
  stopRecordingMock,
  startRecordingMock,
  resetASRMock,
  transcribeMock,
  truncateWavMock,
  toastInfoMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  stopRecordingMock: vi.fn(),
  startRecordingMock: vi.fn(),
  resetASRMock: vi.fn(),
  transcribeMock: vi.fn(),
  truncateWavMock: vi.fn(),
  toastInfoMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('@/hooks/useAudioRecorder', () => ({
  useAudioRecorder: () => ({
    isRecording: true,
    duration: 6,
    startRecording: startRecordingMock,
    stopRecording: stopRecordingMock,
    error: null,
    audioLevel: 0,
  }),
}));

vi.mock('@/hooks/useStepfunASR', () => ({
  useStepfunASR: () => ({
    finalText: '',
    isProcessing: false,
    error: null,
    transcribe: transcribeMock,
    reset: resetASRMock,
  }),
}));

vi.mock('@/hooks/useWechatBridge', () => ({
  useWechatBridge: () => ({
    isWechat: false,
    startNativeRecording: vi.fn(),
    transcript: '',
    recordDuration: 0,
    clearTranscript: vi.fn(),
  }),
  getWechatDebugInfo: () => ({ platform: 'test' }),
}));

vi.mock('@/hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn(),
}));

vi.mock('@/hooks/useAccessibility', () => ({
  useAccessibility: () => ({
    isMotionReduced: true,
  }),
}));

vi.mock('@/utils/audioUtils', () => ({
  truncateWav: truncateWavMock,
}));

vi.mock('@/components/AudioRecorderButton', () => ({
  default: ({ onStop }: { onStop: () => void }) => (
    <button type="button" onClick={onStop}>
      stop recording
    </button>
  ),
}));

vi.mock('@/components/ASRStreamingResult', () => ({
  default: ({ finalText }: { finalText: string }) => <div>{finalText}</div>,
}));

vi.mock('sonner', () => ({
  toast: {
    info: toastInfoMock,
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('UsagePage first clone waiting flow', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    stopRecordingMock.mockReset();
    startRecordingMock.mockReset();
    resetASRMock.mockReset();
    transcribeMock.mockReset();
    truncateWavMock.mockReset();
    toastInfoMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('shows the under-5s hint and falls back to default speech without cloning', async () => {
    const webmBlob = new NodeBlob(['webm'], { type: 'audio/webm' });
    const wavBlob = new NodeBlob(['wav'], { type: 'audio/wav' });
    const onSpeak = vi.fn().mockResolvedValue(undefined);
    const onCloneVoice = vi.fn().mockResolvedValue('voice-ignored');

    stopRecordingMock.mockResolvedValueOnce({
      webmBlob,
      wavBlob,
      duration: 4.9,
    });
    transcribeMock.mockResolvedValueOnce('你好');

    await act(async () => {
      root.render(
        <UsagePage
          onSpeak={onSpeak}
          onStop={vi.fn()}
          isSpeaking={false}
          ttsError={null}
          voiceId={null}
          isCloning={false}
          onCloneVoice={onCloneVoice}
          onClearVoice={vi.fn()}
        />
      );
    });

    await act(async () => {
      container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(transcribeMock).toHaveBeenCalledWith(webmBlob);
      expect(onSpeak).toHaveBeenCalledWith('你好');
    });

    expect(onCloneVoice).not.toHaveBeenCalled();
    expect(truncateWavMock).not.toHaveBeenCalled();
    expect(toastInfoMock).toHaveBeenCalledWith('录音不足5秒，将用默认音色朗读，下次多说几句就能学习你的声音');
  });

  it('waits for clone success before speaking when first recording is at least 5s', async () => {
    const webmBlob = new NodeBlob(['webm'], { type: 'audio/webm' });
    const wavBlob = new NodeBlob(['wav'], { type: 'audio/wav' });
    const truncatedWavBlob = new NodeBlob(['truncated'], { type: 'audio/wav' });
    const onSpeak = vi.fn().mockResolvedValue(undefined);
    const onCloneVoice = vi.fn();
    const cloneRequest = deferred<string | null>();

    stopRecordingMock.mockResolvedValueOnce({
      webmBlob,
      wavBlob,
      duration: 6.2,
    });
    transcribeMock.mockResolvedValueOnce('请朗读这句话');
    truncateWavMock.mockResolvedValueOnce(truncatedWavBlob);
    onCloneVoice.mockReturnValueOnce(cloneRequest.promise);

    await act(async () => {
      root.render(
        <UsagePage
          onSpeak={onSpeak}
          onStop={vi.fn()}
          isSpeaking={false}
          ttsError={null}
          voiceId={null}
          isCloning={false}
          onCloneVoice={onCloneVoice}
          onClearVoice={vi.fn()}
        />
      );
    });

    await act(async () => {
      container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain('正在学习你的声音...');
      expect(container.textContent).toContain('首次使用，正在学习你的音色');
    });

    await vi.waitFor(() => {
      expect(truncateWavMock).toHaveBeenCalledWith(wavBlob, 10);
      expect(onCloneVoice).toHaveBeenCalledWith(truncatedWavBlob, '请朗读这句话');
    });

    expect(onSpeak).not.toHaveBeenCalled();

    await act(async () => {
      cloneRequest.resolve('voice-123');
      await cloneRequest.promise;
    });

    await vi.waitFor(() => {
      expect(onSpeak).toHaveBeenCalledWith('请朗读这句话', 'voice-123');
      expect(toastSuccessMock).toHaveBeenCalledWith('已学习你的声音');
    });
  });
});
