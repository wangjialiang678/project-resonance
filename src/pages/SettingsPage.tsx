import { useNavigate } from 'react-router-dom';
import { AppSettings, ASRSettings, DEFAULT_SETTINGS } from '@/types';
import { useTTS } from '@/hooks/useTTS';
import AccessibilitySettings from '@/components/AccessibilitySettings';
import AccessibleStepper from '@/components/AccessibleStepper';
import ASRSettingsPanel from '@/components/ASRSettingsPanel';
import VoiceClonePanel from '@/components/VoiceClonePanel';
import { List, Mic, ChevronRight } from 'lucide-react';

interface SettingsPageProps {
  settings: AppSettings;
  onUpdate: (settings: AppSettings) => void;
  // 克隆相关
  voiceId: string | null;
  isCloning: boolean;
  ttsError: string | null;
  onCloneVoice: (audioBlob: Blob, referenceText?: string) => Promise<string | null>;
  onSpeak: (text: string) => Promise<void>;
  onStop: () => void;
  isSpeaking: boolean;
  onClearVoice: () => void;
}

export default function SettingsPage({
  settings,
  onUpdate,
  voiceId,
  isCloning,
  ttsError,
  onCloneVoice,
  onSpeak,
  onStop,
  isSpeaking,
  onClearVoice,
}: SettingsPageProps) {
  const { voices, hasChineseVoice } = useTTS();
  const navigate = useNavigate();

  const update = (key: keyof AppSettings, value: number | string) => {
    onUpdate({ ...settings, [key]: value });
  };

  return (
    <section className="max-w-lg mx-auto space-y-5" aria-labelledby="settings-heading">
      <div>
        <h2 id="settings-heading" className="text-xl md:text-2xl font-bold text-foreground">设置</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">调整识别、语音与辅助功能参数</p>
      </div>

      {/* Quick links to hidden pages */}
      <div className="rounded-xl border border-border bg-card divide-y divide-border">
        <button
          onClick={() => navigate('/phrases')}
          className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-muted/50 transition-colors a11y-target"
        >
          <List className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-foreground">词表管理</span>
            <p className="text-xs text-muted-foreground">添加、编辑、导入导出短语</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
        </button>
        <button
          onClick={() => navigate('/training')}
          className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-muted/50 transition-colors a11y-target"
        >
          <Mic className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-foreground">录音训练</span>
            <p className="text-xs text-muted-foreground">录制语音样本用于个性化识别</p>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
        </button>
      </div>

      {/* Accessibility Settings */}
      <AccessibilitySettings />

      {/* ASR Settings */}
      <ASRSettingsPanel
        settings={settings.asr}
        onUpdate={(asr: ASRSettings) => onUpdate({ ...settings, asr })}
      />

      {/* Recognition Settings */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-5">
        <h3 className="font-semibold text-foreground">识别参数</h3>

        <AccessibleStepper
          label="Top-K 候选数"
          value={settings.topK}
          min={1}
          max={5}
          step={1}
          onChange={(v) => update('topK', v)}
          id="topK"
        />

        <AccessibleStepper
          label="置信度阈值"
          value={settings.absThreshold}
          min={0.1}
          max={0.95}
          step={0.05}
          onChange={(v) => update('absThreshold', v)}
          format={(v) => v.toFixed(2)}
          id="absThreshold"
        />

        <AccessibleStepper
          label="每条最大模板数"
          value={settings.maxTemplatesPerPhrase}
          min={2}
          max={20}
          step={1}
          onChange={(v) => update('maxTemplatesPerPhrase', v)}
          id="maxTemplates"
        />
      </div>

      {/* TTS Settings */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-5">
        <h3 className="font-semibold text-foreground">语音合成 (TTS)</h3>

        {!hasChineseVoice && (
          <div className="rounded-lg bg-warning/15 p-3 text-sm text-warning-foreground" role="alert">
            ⚠️ 未检测到中文语音包，TTS 可能无法正常工作。请在系统设置中安装中文语音。
          </div>
        )}

        <AccessibleStepper
          label="语速"
          value={settings.ttsRate}
          min={0.5}
          max={2}
          step={0.1}
          onChange={(v) => update('ttsRate', v)}
          format={(v) => `${v.toFixed(1)}x`}
          id="ttsRate"
        />

        <AccessibleStepper
          label="音量"
          value={settings.ttsVolume}
          min={0}
          max={1}
          step={0.1}
          onChange={(v) => update('ttsVolume', v)}
          format={(v) => `${Math.round(v * 100)}%`}
          id="ttsVolume"
        />

        <AccessibleStepper
          label="音高"
          value={settings.ttsPitch}
          min={0.5}
          max={2}
          step={0.1}
          onChange={(v) => update('ttsPitch', v)}
          format={(v) => v.toFixed(1)}
          id="ttsPitch"
        />

        {voices.length > 0 && (
          <div>
            <label htmlFor="ttsVoice" className="text-sm font-medium text-foreground block mb-1.5">语音</label>
            <select
              id="ttsVoice"
              value={settings.ttsVoice}
              onChange={(e) => update('ttsVoice', e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring a11y-target"
              aria-label="选择语音"
            >
              <option value="">自动选择</option>
              {voices
                .filter((v) => v.lang.startsWith('zh'))
                .map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
            </select>
          </div>
        )}
      </div>

      {/* Voice Clone Panel */}
      <VoiceClonePanel
        voiceId={voiceId}
        isCloning={isCloning}
        error={ttsError}
        onClone={onCloneVoice}
        onSpeak={onSpeak}
        onClearVoice={onClearVoice}
        isSpeaking={isSpeaking}
        onStop={onStop}
      />

      {/* Reset */}
      <button
        onClick={() => onUpdate(DEFAULT_SETTINGS)}
        className="w-full rounded-xl border border-border bg-card py-3 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors a11y-target"
        aria-label="恢复默认设置"
      >
        恢复默认设置
      </button>
    </section>
  );
}
