import { useState, useCallback, useRef, useEffect } from 'react';
import { formatStepfunError } from '@/utils/stepfunErrors';

interface UseStepfunTTSReturn {
  speak: (text: string, overrideVoice?: string) => Promise<void>;
  stop: () => void;
  isSpeaking: boolean;
  cloneVoice: (audioBlob: Blob, referenceText?: string) => Promise<string | null>;
  isCloning: boolean;
  voiceId: string | null;
  setVoiceId: (id: string | null) => void;
  error: string | null;
}

const VOICE_ID_KEY = 'resonance_cloned_voice_id';

/**
 * Play audio from a fetch Response.
 *
 * Uses full-blob playback (download first, then play) to avoid MSE truncation
 * issues with audio/mpeg. TTS responses are typically small (<500KB), so the
 * latency difference vs streaming is negligible.
 */
async function playStreamingAudio(
  response: Response,
  audioRef: React.MutableRefObject<HTMLAudioElement | null>,
  onEnd: () => void,
): Promise<void> {
  const audioBlob = await response.blob();
  const audioUrl = URL.createObjectURL(audioBlob);
  const audio = new Audio(audioUrl);
  audioRef.current = audio;

  return new Promise<void>((resolve) => {
    const cleanup = () => {
      onEnd();
      URL.revokeObjectURL(audioUrl);
      resolve();
    };
    audio.onended = cleanup;
    audio.onerror = cleanup;
    audio.play().catch(cleanup);
  });
}

export function useStepfunTTS(): UseStepfunTTSReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [voiceId, setVoiceIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(VOICE_ID_KEY);
    } catch {
      return null;
    }
  });
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const setVoiceId = useCallback((id: string | null) => {
    setVoiceIdState(id);
    try {
      if (id) {
        localStorage.setItem(VOICE_ID_KEY, id);
      } else {
        localStorage.removeItem(VOICE_ID_KEY);
      }
    } catch { /* ignore */ }
  }, []);

  const speak = useCallback(async (text: string, overrideVoice?: string) => {
    setError(null);
    // Stop any current playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    try {
      const directKey = import.meta.env.VITE_STEPFUN_API_KEY;

      setIsSpeaking(true);

      const effectiveVoice = overrideVoice || voiceId || 'cixingnansheng';

      const makeRequest = async (voice: string) => {
        if (directKey) {
          // Direct mode: call StepFun API directly
          return fetch('https://api.stepfun.com/v1/audio/speech', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${directKey}`,
            },
            body: JSON.stringify({ model: 'step-tts-mini', input: text, voice, response_format: 'mp3', speed: 1.0 }),
          });
        }
        throw new Error('请在设置中配置 StepFun API Key（VITE_STEPFUN_API_KEY）');
      };

      let response = await makeRequest(effectiveVoice);

      // If cloned voice is invalid, auto-clear and retry with default
      if (!response.ok && effectiveVoice !== 'cixingnansheng') {
        const errData = await response.json().catch(() => ({}));
        const detail = errData.detail || (typeof errData.error === 'string' ? errData.error : errData.error?.message) || '';
        if (typeof detail === 'string' && (detail.includes('voice_id_invalid') || detail.includes('does not exist'))) {
          console.warn('[TTS] Invalid voice_id, clearing and retrying with default');
          setVoiceId(null);
          response = await makeRequest('cixingnansheng');
        }
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(formatStepfunError(response.status, errData, '语音合成'));
      }

      // Stream audio playback - starts playing before full download completes
      await playStreamingAudio(response, audioRef, () => setIsSpeaking(false));
    } catch (err) {
      setIsSpeaking(false);
      const message = err instanceof Error ? err.message : 'TTS 播放失败';
      setError(message);
    }
  }, [voiceId, setVoiceId]);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setIsSpeaking(false);
    setError(null);
  }, []);

  const cloneVoice = useCallback(async (audioBlob: Blob, referenceText?: string): Promise<string | null> => {
    console.log('[cloneVoice] START — blob size:', audioBlob.size, 'type:', audioBlob.type, 'refText:', referenceText || '(none)');
    setError(null);
    setIsCloning(true);

    try {
      const directKey = import.meta.env.VITE_STEPFUN_API_KEY;

      // 60s timeout to prevent infinite spinner (clone involves upload + API call)
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      /** Custom error that preserves raw API response for CER detection */
      class CloneApiError extends Error {
        constructor(public status: number, public rawBody: string) {
          // Parse for user-friendly display
          let parsed: Record<string, unknown> = {};
          try { parsed = JSON.parse(rawBody); } catch { /* not JSON */ }
          super(formatStepfunError(status, parsed, '音色复刻'));
        }
        get isCerFailure(): boolean {
          return this.rawBody.includes('CER_NOT_PASS');
        }
      }

      // Direct mode: upload once, reuse fileId for retries
      let uploadedFileId: string | undefined;

      const ensureFileUploaded = async (): Promise<string> => {
        if (uploadedFileId) return uploadedFileId;
        const uploadForm = new FormData();
        uploadForm.append('file', audioBlob, 'reference.wav');
        uploadForm.append('purpose', 'storage');

        console.log('[cloneVoice] direct mode — uploading to StepFun...');
        const uploadResp = await fetch('https://api.stepfun.com/v1/files', {
          method: 'POST',
          headers: { Authorization: `Bearer ${directKey}` },
          body: uploadForm,
          signal: controller.signal,
        });
        if (!uploadResp.ok) {
          const errData = await uploadResp.json().catch(() => ({}));
          throw new Error(formatStepfunError(uploadResp.status, errData, '上传音频'));
        }
        const uploadResult = await uploadResp.json();
        uploadedFileId = uploadResult.id;
        if (!uploadedFileId) throw new Error('上传成功但未获取到 file_id');
        console.log('[cloneVoice] file uploaded, id:', uploadedFileId);
        return uploadedFileId;
      };

      /** Attempt clone with optional referenceText */
      const attemptClone = async (refText?: string): Promise<string | undefined> => {
        if (directKey) {
          const fileId = await ensureFileUploaded();
          const cloneBody: Record<string, unknown> = { file_id: fileId, model: 'step-tts-mini' };
          if (refText) cloneBody.text = refText;

          console.log('[cloneVoice] direct mode — cloning voice...', refText ? '(with refText)' : '(no refText)');
          const cloneResp = await fetch('https://api.stepfun.com/v1/audio/voices', {
            method: 'POST',
            headers: { Authorization: `Bearer ${directKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(cloneBody),
            signal: controller.signal,
          });
          if (!cloneResp.ok) {
            throw new CloneApiError(cloneResp.status, await cloneResp.text());
          }
          const cloneResult = await cloneResp.json();
          console.log('[cloneVoice] clone result:', JSON.stringify(cloneResult));
          return cloneResult.id;
        } else {
          throw new Error('请在设置中配置 StepFun API Key（VITE_STEPFUN_API_KEY）');
        }
      };

      try {
        let newVoiceId: string | undefined;

        try {
          newVoiceId = await attemptClone(referenceText);
        } catch (firstErr) {
          // CER_NOT_PASS: ASR text mismatch too high → retry without referenceText
          if (referenceText && firstErr instanceof CloneApiError && firstErr.isCerFailure) {
            console.warn('[cloneVoice] CER check failed, retrying without referenceText...');
            newVoiceId = await attemptClone(); // reuses uploaded fileId
          } else {
            throw firstErr;
          }
        }

        if (newVoiceId) {
          setVoiceId(newVoiceId);
          console.log('[cloneVoice] SUCCESS — voiceId:', newVoiceId);
          return newVoiceId;
        }
        throw new Error('未获取到音色 ID');
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      const message = err instanceof Error
        ? (err.name === 'AbortError' ? '声音克隆超时，请重试' : err.message)
        : '音色复刻失败';
      console.error('[cloneVoice] CATCH:', message, err);
      setError(message);
      return null;
    } finally {
      console.log('[cloneVoice] FINALLY — isCloning set to false');
      setIsCloning(false);
    }
  }, [setVoiceId]);

  return {
    speak,
    stop,
    isSpeaking,
    cloneVoice,
    isCloning,
    voiceId,
    setVoiceId,
    error,
  };
}
