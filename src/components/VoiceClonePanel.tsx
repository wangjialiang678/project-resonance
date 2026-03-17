import { useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { Mic, MicOff, Volume2, Check, Loader2, AlertCircle, Trash2, Upload, Square } from 'lucide-react';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { toast } from 'sonner';

interface VoiceClonePanelProps {
  voiceId: string | null;
  isCloning: boolean;
  error: string | null;
  onClone: (audioBlob: Blob, referenceText?: string) => Promise<string | null>;
  onSpeak: (text: string) => Promise<void>;
  onClearVoice: () => void;
  isSpeaking: boolean;
  onStop: () => void;
}

export default function VoiceClonePanel({
  voiceId,
  isCloning,
  error,
  onClone,
  onSpeak,
  onClearVoice,
  isSpeaking,
  onStop,
}: VoiceClonePanelProps) {
  const { isRecording, duration, startRecording, stopRecording, audioLevel } = useAudioRecorder();
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedDuration, setRecordedDuration] = useState<number | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleStartRecording = useCallback(async () => {
    setRecordedBlob(null);
    setRecordedDuration(null);
    setUploadedFileName(null);
    await startRecording();
  }, [startRecording]);

  const handleStopRecording = useCallback(async () => {
    const result = await stopRecording();
    if (result?.blob) {
      setRecordedBlob(result.blob);
      setRecordedDuration(result.duration);
    }
  }, [stopRecording]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/x-wav', 'audio/webm', 'audio/ogg', 'audio/flac'];
    if (!validTypes.some(t => file.type.startsWith(t.split('/')[0]))) {
      toast.error('请上传音频文件（WAV、MP3 等格式）');
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      toast.error('文件大小不能超过 20MB');
      return;
    }

    setRecordedBlob(file);
    setRecordedDuration(null);
    setUploadedFileName(file.name);
    toast.success(`已选择: ${file.name}`);

    // Reset input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleClone = useCallback(async () => {
    if (!recordedBlob) return;
    if (recordedDuration !== null && recordedDuration < 5) {
      toast.error('录音至少需要 5 秒，请重新录制');
      return;
    }
    const vid = await onClone(recordedBlob, '今天天气真不错，我想出去走走');
    if (vid) {
      toast.success('声音克隆成功！');
      setRecordedBlob(null);
      setRecordedDuration(null);
      setUploadedFileName(null);
    }
  }, [recordedBlob, recordedDuration, onClone]);

  const handleTest = useCallback(async () => {
    if (isSpeaking) {
      onStop();
    } else {
      await onSpeak('你好，这是你的专属数字声音。');
    }
  }, [isSpeaking, onSpeak, onStop]);

  // Already has a cloned voice
  if (voiceId) {
    return (
      <div id="voice-clone-section" className="rounded-2xl border border-border/60 bg-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-success/10">
            <Check className="h-4 w-4 text-success" />
          </div>
          <h3 className="font-semibold text-foreground">声音已克隆</h3>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleTest}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-medium hover:bg-muted/50 transition-colors"
          >
            {isSpeaking ? (
              <>
                <Square className="h-4 w-4" />
                停止试听
              </>
            ) : (
              <>
                <Volume2 className="h-4 w-4" />
                试听克隆音色
              </>
            )}
          </button>

          <button
            onClick={() => {
              if (isSpeaking) onStop();
              onClearVoice();
              toast.info('已清除克隆音色，将使用默认音色');
            }}
            className="flex items-center justify-center gap-2 rounded-xl border border-destructive/30 px-4 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/5 transition-colors"
            aria-label="清除克隆音色"
          >
            <Trash2 className="h-4 w-4" />
            清除
          </button>
        </div>

        <p className="text-xs text-muted-foreground">如需更换声音，清除后重新录制</p>
      </div>
    );
  }

  return (
    <div id="voice-clone-section" className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-foreground">声音克隆</h3>
        <p className="text-xs text-muted-foreground mt-1">
          朗读下面这句话，系统将学习你的声音
        </p>
        <p className="mt-2 rounded-lg bg-muted/50 px-3 py-2 text-sm text-foreground italic text-center">
          「今天天气真不错，我想出去走走」
        </p>
      </div>

      {/* Recording + Upload buttons */}
      <div className="flex items-center justify-center gap-4">
        {/* Record button */}
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={isRecording ? handleStopRecording : handleStartRecording}
            disabled={isCloning}
            className={`relative flex h-16 w-16 items-center justify-center rounded-full transition-all ${
              isRecording
                ? 'bg-destructive text-destructive-foreground animate-pulse'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            } ${isCloning ? 'opacity-50 cursor-not-allowed' : ''}`}
            aria-label={isRecording ? '停止录音' : '录制参考音频'}
          >
            {isRecording ? (
              <MicOff className="h-6 w-6" />
            ) : (
              <Mic className="h-6 w-6" />
            )}
            {isRecording && (
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-destructive"
                animate={{ scale: [1, 1.2 + audioLevel * 0.3], opacity: [0.6, 0] }}
                transition={{ duration: 1, repeat: Infinity }}
              />
            )}
          </button>
          <span className="text-xs text-muted-foreground">录制</span>
        </div>

        {/* Divider */}
        <div className="flex flex-col items-center gap-1 text-muted-foreground">
          <div className="h-6 w-px bg-border" />
          <span className="text-xs">或</span>
          <div className="h-6 w-px bg-border" />
        </div>

        {/* Upload button */}
        <div className="flex flex-col items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.wav,.mp3,.flac,.ogg,.webm"
            onChange={handleFileUpload}
            className="hidden"
            aria-label="上传参考音频文件"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isCloning || isRecording}
            className={`flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-border bg-muted/30 text-muted-foreground transition-all hover:border-primary hover:text-primary hover:bg-primary/5 ${
              isCloning || isRecording ? 'opacity-50 cursor-not-allowed' : ''
            }`}
            aria-label="上传参考音频"
          >
            <Upload className="h-6 w-6" />
          </button>
          <span className="text-xs text-muted-foreground">上传</span>
        </div>
      </div>

      {/* Status text */}
      {isRecording && (
        <p className="text-sm text-muted-foreground text-center">
          录音中... {duration.toFixed(1)}s
          <span className="text-xs ml-1">（至少 5 秒）</span>
        </p>
      )}

      {recordedBlob && !isRecording && (
        <p className="text-sm text-success text-center">
          ✓ {uploadedFileName ? `已选择: ${uploadedFileName}` : '已录制参考音频'}
        </p>
      )}

      {/* Clone button */}
      {recordedBlob && !isRecording && (
        <button
          onClick={handleClone}
          disabled={isCloning}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {isCloning ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              正在复刻音色...
            </>
          ) : (
            '开始复刻音色'
          )}
        </button>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}
