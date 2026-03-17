import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import SettingsPage from './SettingsPage';
import VoiceClonePanel from '@/components/VoiceClonePanel';
import { DEFAULT_SETTINGS, type AppSettings } from '@/types';

const navigateSpy = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

vi.mock('@/hooks/useTTS', () => ({
  useTTS: () => ({
    voices: [],
    hasChineseVoice: true,
  }),
}));

vi.mock('@/hooks/useAudioRecorder', () => ({
  useAudioRecorder: () => ({
    isRecording: false,
    duration: 0,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    audioLevel: 0,
  }),
}));

vi.mock('@/components/AccessibilitySettings', () => ({
  default: () => <div>AccessibilitySettings</div>,
}));

vi.mock('@/components/AccessibleStepper', () => ({
  default: ({ label }: { label: string }) => <div>{label}</div>,
}));

vi.mock('@/components/ASRSettingsPanel', () => ({
  default: () => <div>ASRSettingsPanel</div>,
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

const baseSettings: AppSettings = DEFAULT_SETTINGS;

let container: HTMLDivElement;
let root: Root;

const renderApp = async (node: ReactNode) => {
  await act(async () => {
    root.render(node);
  });
};

const getButtonByText = (text: string) => {
  const button = Array.from(container.querySelectorAll('button')).find((element) =>
    element.textContent?.includes(text),
  );

  if (!button) {
    throw new Error(`Button with text "${text}" not found`);
  }

  return button;
};

describe('SettingsPage', () => {
  beforeEach(() => {
    navigateSpy.mockReset();
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

  it('scrolls to the voice clone section instead of navigating to training', async () => {
    const scrollIntoViewSpy = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

    HTMLElement.prototype.scrollIntoView = scrollIntoViewSpy;

    await renderApp(
      <SettingsPage
        settings={baseSettings}
        onUpdate={vi.fn()}
        voiceId={null}
        isCloning={false}
        ttsError={null}
        onCloneVoice={vi.fn(async () => null)}
        onSpeak={vi.fn(async () => {})}
        onStop={vi.fn()}
        isSpeaking={false}
        onClearVoice={vi.fn()}
      />,
    );

    getButtonByText('声音克隆').click();

    expect(scrollIntoViewSpy).toHaveBeenCalledOnce();
    expect(navigateSpy).not.toHaveBeenCalled();

    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  });
});

describe('VoiceClonePanel', () => {
  beforeEach(() => {
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

  it('uses the compact cloned layout without exposing the technical voice id', async () => {
    const onClearVoice = vi.fn();

    await renderApp(
      <VoiceClonePanel
        voiceId="voice-tone-123"
        isCloning={false}
        error={null}
        onClone={vi.fn(async () => null)}
        onSpeak={vi.fn(async () => {})}
        onClearVoice={onClearVoice}
        isSpeaking={false}
        onStop={vi.fn()}
      />,
    );

    expect(document.getElementById('voice-clone-section')).not.toBeNull();
    expect(container.textContent).toContain('声音已克隆');
    expect(container.textContent).not.toContain('voice-tone-123');
    expect(container.textContent).not.toContain('ID:');
    expect(container.textContent).toContain('试听克隆音色');

    getButtonByText('清除').click();

    expect(onClearVoice).toHaveBeenCalledOnce();
  });
});
