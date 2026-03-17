import { useState, useCallback, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Mic, RotateCcw } from 'lucide-react';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useDashscopeASR } from '@/hooks/useDashscopeASR';
import { useWechatBridge, getWechatDebugInfo } from '@/hooks/useWechatBridge';
import AudioRecorderButton from '@/components/AudioRecorderButton';
import ASRStreamingResult from '@/components/ASRStreamingResult';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useAccessibility } from '@/hooks/useAccessibility';
import { toast } from 'sonner';

interface UsagePageProps {
  onSpeak: (text: string, overrideVoice?: string) => Promise<void>;
  onStop: () => void;
  isSpeaking: boolean;
  ttsError: string | null;
  voiceId: string | null;
  isCloning: boolean;
  onCloneVoice: (audioBlob: Blob, referenceText?: string) => Promise<string | null>;
  onCancelCloneResult: () => void;
  onClearVoice: () => void;
}

type FlowState = 'idle' | 'recording' | 'processing' | 'cloning' | 'speaking' | 'result';

export default function UsagePage({
  onSpeak,
  onStop,
  isSpeaking,
  ttsError,
  voiceId,
  isCloning,
  onCloneVoice,
  onCancelCloneResult,
  onClearVoice,
}: UsagePageProps) {
  const { isRecording, duration, startRecording, stopRecording, error: recError, audioLevel } = useAudioRecorder();
  const [flowState, setFlowState] = useState<FlowState>('idle');
  const [lastTranscript, setLastTranscript] = useState('');
  const { isWechat, startNativeRecording, transcript: wxTranscript, recordDuration: wxDuration, clearTranscript } = useWechatBridge();

  const {
    finalText,
    isProcessing,
    error: asrError,
    transcribe,
    reset: resetASR,
  } = useDashscopeASR();

  // Handle transcript received from WeChat native recording
  useEffect(() => {
    if (wxTranscript) {
      setLastTranscript(wxTranscript);
      setFlowState('speaking');
      onSpeak(wxTranscript).catch(() => {}).finally(() => setFlowState('result'));
      clearTranscript();
    }
  }, [wxTranscript, onSpeak, clearTranscript]);

  const handleStart = useCallback(async () => {
    if (isWechat) {
      console.log('[UsagePage] WeChat detected, starting native recording');
      startNativeRecording();
      return;
    }
    // Fallback: if getUserMedia unavailable but wx.miniProgram exists, try native bridge anyway
    if (!navigator.mediaDevices?.getUserMedia) {
      if (window.wx?.miniProgram) {
        console.log('[UsagePage] No getUserMedia but wx bridge available, trying native recording');
        startNativeRecording();
        return;
      }
      toast.error('当前环境不支持录音，请在微信小程序或现代浏览器中使用');
      console.error('[UsagePage] Debug info:', getWechatDebugInfo());
      return;
    }
    setFlowState('recording');
    setLastTranscript('');
    await startRecording();
  }, [isWechat, startNativeRecording, startRecording]);

  const handleStop = useCallback(async () => {
    setFlowState('processing');

    const needClone = !voiceId;
    console.log('[handleStop] START — voiceId:', voiceId, 'needClone:', needClone);
    const result = await stopRecording({ includeWav: needClone });
    if (!result) {
      console.log('[handleStop] stopRecording returned null');
      setFlowState('idle');
      return;
    }

    const { webmBlob, wavBlob, duration: recDuration } = result;
    console.log(
      '[handleStop] recording result — duration:',
      recDuration.toFixed(1),
      's, webmBlob:',
      webmBlob.size,
      'B, wavBlob:',
      wavBlob?.size ?? 0,
      'B, wavType:',
      wavBlob?.type ?? '(none)'
    );

    const text = await transcribe(webmBlob);

    if (needClone && text) {
      if (recDuration < 5) {
        toast.info('录音不足5秒，将用默认音色朗读，下次多说几句就能学习你的声音');
      } else if (wavBlob) {
        setFlowState('cloning');
        let clonedVid: string | null = null;
        try {
          const { truncateWav } = await import('@/utils/audioUtils');
          const truncatedWav = await truncateWav(wavBlob, 10);

          console.log('[handleStop] CLONE triggered — sending', truncatedWav.size, 'bytes (truncated) with refText:', text);

          let cancelled = false;
          const clonePromise = onCloneVoice(truncatedWav, text).then((vid) => (
            cancelled ? null : vid
          ));
          let timeoutId: ReturnType<typeof setTimeout>;
          const timeoutPromise = new Promise<null>((resolve) => {
            timeoutId = setTimeout(() => {
              cancelled = true;
              onCancelCloneResult();
              resolve(null);
            }, 20000);
          });
          const vid = await Promise.race([clonePromise, timeoutPromise]);
          clearTimeout(timeoutId!);

          if (vid) {
            console.log('[handleStop] CLONE SUCCESS — voiceId:', vid);
            toast.success('已学习你的声音');
            clonedVid = vid;
          } else {
            console.warn('[handleStop] CLONE timeout or returned null');
            toast.info('声音学习未完成，先用默认音色朗读');
          }
        } catch (err) {
          console.error('[handleStop] CLONE ERROR:', err);
          toast.info('声音学习未成功，先用默认音色朗读');
        }

        // 克隆成功后用克隆音色朗读（onSpeak 闭包中 voiceId 尚未更新，需显式传入）
        if (clonedVid && text) {
          setLastTranscript(text);
          setFlowState('speaking');
          try { await onSpeak(text, clonedVid); } catch { /* handled by parent */ }
          setFlowState('result');
          return;
        }
      } else {
        console.log('[handleStop] clone skipped — missing wavBlob for first-time clone');
      }
    } else {
      console.log(
        '[handleStop] clone skipped — needClone:',
        needClone,
        'duration:',
        recDuration.toFixed(1),
        's, wavBlob:',
        !!wavBlob,
        'text:',
        !!text
      );
    }

    if (!text) {
      setFlowState('result');
      return;
    }

    setLastTranscript(text);

    // Auto-speak the transcribed text immediately
    setFlowState('speaking');
    try {
      await onSpeak(text);
    } catch {
      // TTS error handled by parent
    }

    setFlowState('result');
  }, [stopRecording, transcribe, onSpeak, voiceId, onCloneVoice, onCancelCloneResult]);

  const handleReset = useCallback(() => {
    setFlowState('idle');
    setLastTranscript('');
    resetASR();
  }, [resetASR]);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast.success('已复制到剪贴板');
    });
  }, []);

  // Keyboard shortcuts
  const shortcuts = useMemo(
    () => [
      {
        key: ' ',
        label: '录音',
        description: '开始/停止录音',
        handler: () => {
          if (flowState === 'idle') handleStart();
          else if (flowState === 'recording') handleStop();
        },
        enabled: flowState === 'idle' || flowState === 'recording',
      },
      {
        key: 'r',
        label: '重置',
        description: '再说一次',
        handler: handleReset,
        enabled: flowState === 'result',
      },
      {
        key: 't',
        label: '复述',
        description: '语音复述',
        handler: () => {
          const text = finalText || lastTranscript;
          if (text) {
            if (isSpeaking) { onStop(); } else { void onSpeak(text); }
          }
        },
        enabled: flowState === 'result' && !!(finalText || lastTranscript),
      },
      {
        key: 'c',
        label: '复制',
        description: '复制文本',
        handler: () => {
          const text = finalText || lastTranscript;
          if (text) handleCopy(text);
        },
        enabled: flowState === 'result' && !!(finalText || lastTranscript),
      },
      {
        key: 'Escape',
        label: '取消',
        description: '取消录音',
        handler: () => {
          if (flowState === 'recording') {
            stopRecording();
            resetASR();
            setFlowState('idle');
          }
        },
        enabled: flowState === 'recording',
      },
    ],
    [flowState, handleStart, handleStop, handleReset, handleCopy, finalText, lastTranscript, isSpeaking, onSpeak, onStop, stopRecording, resetASR]
  );

  useKeyboardShortcuts(shortcuts, 'high');
  const { isMotionReduced } = useAccessibility();

  const displayText = finalText || lastTranscript;

  return (
    <section className="max-w-lg mx-auto space-y-5 relative" aria-labelledby="usage-heading">
      {/* Decorative background blobs */}
      <div className="pointer-events-none absolute -top-20 -left-20 h-40 w-40 rounded-full bg-primary/8 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -top-10 -right-16 h-32 w-32 rounded-full bg-accent/10 blur-3xl" aria-hidden="true" />

      {/* Header with gradient text */}
      <div className="text-center">
        <motion.div
          initial={isMotionReduced ? {} : { opacity: 0, y: -10 }}
          animate={isMotionReduced ? {} : { opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h2 id="usage-heading" className="text-2xl md:text-3xl font-extrabold bg-gradient-to-r from-primary via-primary to-accent bg-clip-text text-transparent">
            语音识别
          </h2>
          <div className="mt-2 flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">录音</span>
            <span className="text-muted-foreground/40">→</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">识别</span>
            <span className="text-muted-foreground/40">→</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">朗读</span>
          </div>
        </motion.div>
      </div>

      {/* Keyboard hint */}
      {flowState === 'idle' && (
        <motion.div
          initial={isMotionReduced ? {} : { opacity: 0 }}
          animate={isMotionReduced ? {} : { opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="flex items-center justify-center gap-2 text-xs text-muted-foreground"
        >
          <span>按</span>
          <kbd className="kbd-hint">空格</kbd>
          <span>开始录音</span>
        </motion.div>
      )}

      {/* First-time voice clone hint */}
      {!voiceId && !isCloning && flowState === 'idle' && (
        <div className="text-center text-xs text-muted-foreground bg-primary/5 rounded-lg px-3 py-2">
          首次录音将自动学习你的声音（需说 5 秒以上）
        </div>
      )}

      {/* Cloning in progress indicator */}
      {isCloning && (
        <div className="flex items-center justify-center gap-2 text-xs text-primary bg-primary/5 rounded-lg px-3 py-2">
          <div className="h-3 w-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          正在学习你的声音...
        </div>
      )}

      {/* Voice cloned indicator + switch person */}
      {voiceId && !isCloning && flowState === 'idle' && (
        <div className="flex items-center justify-center gap-3 text-xs">
          <span className="flex items-center gap-1.5 text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            已使用你的声音
          </span>
          <button
            onClick={() => { onClearVoice(); toast.info('已切换，下次录音将重新学习声音'); }}
            className="text-muted-foreground hover:text-primary transition-colors underline underline-offset-2"
          >
            换人
          </button>
        </div>
      )}

      {/* Recording Area */}
      {(flowState === 'idle' || flowState === 'recording') && (
        <motion.div
          initial={isMotionReduced ? {} : { opacity: 0, y: 12 }}
          animate={isMotionReduced ? {} : { opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="relative rounded-2xl border border-border/60 bg-gradient-to-b from-card to-card/80 p-6 md:p-8 shadow-lg shadow-primary/5 overflow-hidden"
        >
          {/* Subtle inner glow when recording */}
          {isRecording && (
            <div className="absolute inset-0 bg-gradient-to-t from-recording/5 to-transparent pointer-events-none" aria-hidden="true" />
          )}
          <div className="relative flex flex-col items-center">
            <AudioRecorderButton
              isRecording={isRecording}
              duration={duration}
              audioLevel={audioLevel}
              onStart={handleStart}
              onStop={handleStop}
              size="lg"
            />
          </div>
        </motion.div>
      )}

      {/* Processing / Cloning / Speaking states */}
      {(flowState === 'processing' || flowState === 'cloning' || flowState === 'speaking') && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2 }}
          className="relative rounded-2xl border border-border/60 bg-gradient-to-b from-card to-card/80 p-8 text-center space-y-4 shadow-lg shadow-primary/5 overflow-hidden"
          role="status"
          aria-live="polite"
        >
          <div className="absolute inset-0 bg-gradient-to-t from-primary/3 to-transparent pointer-events-none" aria-hidden="true" />
          <div className="relative mx-auto h-14 w-14">
            <div className="absolute inset-0 rounded-full bg-primary/10" aria-hidden="true" />
            <div className="absolute inset-0 rounded-full border-[3px] border-primary/20" aria-hidden="true" />
            <div className="absolute inset-0 rounded-full border-[3px] border-primary border-t-transparent animate-spin" aria-hidden="true" />
          </div>
          <p className="relative text-foreground font-semibold">
            {flowState === 'processing' && '正在识别语音...'}
            {flowState === 'cloning' && '正在学习你的声音...'}
            {flowState === 'speaking' && '正在朗读...'}
          </p>
          {flowState === 'processing' && (
            <p className="relative text-xs text-muted-foreground animate-pulse">正在上传压缩音频</p>
          )}
          {flowState === 'cloning' && (
            <p className="relative text-xs text-muted-foreground animate-pulse">首次使用，正在学习你的音色</p>
          )}
          {flowState !== 'processing' && displayText && (
            <p className="relative text-sm text-muted-foreground italic">「{displayText}」</p>
          )}
        </motion.div>
      )}

      {/* Results */}
      {flowState === 'result' && (
        <>
          {displayText ? (
            <ASRStreamingResult
              partialText=""
              finalText={displayText}
              onSpeak={onSpeak}
              onStop={onStop}
              isSpeaking={isSpeaking}
            />
          ) : (
            <motion.div
              initial={isMotionReduced ? {} : { opacity: 0 }}
              animate={isMotionReduced ? {} : { opacity: 1 }}
              className="rounded-2xl border border-border/60 bg-card p-8 text-center"
              role="alert"
            >
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <Mic className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              </div>
              <p className="text-sm text-muted-foreground">未能识别到语音内容，请重试</p>
            </motion.div>
          )}

          <motion.button
            initial={isMotionReduced ? {} : { opacity: 0, y: 5 }}
            animate={isMotionReduced ? {} : { opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            onClick={handleReset}
            className="a11y-target flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20 py-3.5 text-sm font-semibold text-primary hover:from-primary/15 hover:to-accent/15 transition-all"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            再说一次
            <kbd className="kbd-hint ml-2" aria-hidden="true">R</kbd>
          </motion.button>
        </>
      )}

      {(recError || asrError || ttsError) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-xl bg-destructive/10 border border-destructive/20 p-3.5 text-sm text-destructive"
          role="alert"
        >
          {recError || asrError || ttsError}
        </motion.div>
      )}

      {/* Debug info */}
      {(isWechat || import.meta.env.DEV) && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">调试信息</summary>
          <pre className="mt-1 rounded-lg bg-muted p-2 overflow-auto max-h-32">
            {JSON.stringify(getWechatDebugInfo(), null, 2)}
          </pre>
        </details>
      )}
    </section>
  );
}
