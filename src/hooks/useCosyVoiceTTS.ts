import { useState, useCallback, useRef } from 'react';
import { formatApiError } from '@/utils/apiErrors';

interface UseCosyVoiceTTSReturn {
  speak: (text: string, overrideVoice?: string) => Promise<void>;
  stop: () => void;
  isSpeaking: boolean;
  cloneVoice: (audioBlob: Blob, referenceText?: string) => Promise<string | null>;
  isCloning: boolean;
  voiceId: string | null;
  setVoiceId: (id: string | null) => void;
  cancelPendingClone: () => void;
  error: string | null;
}

const VOICE_ID_KEY = 'resonance_cosyvoice_voice_id';
const DEFAULT_VOICE = 'longanyang';
const API_BASE = import.meta.env.VITE_API_URL || '';
const APP_TOKEN = import.meta.env.VITE_APP_TOKEN || 'resonance-2026';

async function playBlobAudio(
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
      audio.pause();
      audio.src = '';
      onEnd();
      URL.revokeObjectURL(audioUrl);
      resolve();
    };

    audio.onended = cleanup;
    audio.onerror = cleanup;
    audio.play().catch(cleanup);
  });
}

function getErrorDetail(errData: Record<string, unknown>): string {
  if (typeof errData.detail === 'string') return errData.detail;
  if (typeof errData.error === 'string') return errData.error;
  if (errData.error && typeof errData.error === 'object') {
    const nested = errData.error as Record<string, unknown>;
    if (typeof nested.message === 'string') return nested.message;
  }
  if (typeof errData.message === 'string') return errData.message;
  return '';
}

export function useCosyVoiceTTS(): UseCosyVoiceTTSReturn {
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
  const cloneGenerationRef = useRef(0);

  const setVoiceId = useCallback((id: string | null) => {
    setVoiceIdState(id);
    try {
      if (id) {
        localStorage.setItem(VOICE_ID_KEY, id);
      } else {
        localStorage.removeItem(VOICE_ID_KEY);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const speak = useCallback(async (text: string, overrideVoice?: string) => {
    setError(null);

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    try {
      setIsSpeaking(true);

      const effectiveVoice = overrideVoice || voiceId || DEFAULT_VOICE;

      const makeRequest = async (voice: string) => fetch(`${API_BASE}/cosyvoice-tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Token': APP_TOKEN,
        },
        body: JSON.stringify({ text, voice }),
      });

      let response = await makeRequest(effectiveVoice);

      if (!response.ok && effectiveVoice !== DEFAULT_VOICE) {
        const errData = await response.json().catch(() => ({}));
        const detail = getErrorDetail(errData).toLowerCase();
        const isVoiceInvalid = response.status === 404 ||
          (response.status === 400 && (detail.includes('not exist') || detail.includes('not found')));
        if (isVoiceInvalid) {
          console.warn('[CosyVoice TTS] Invalid voice_id, clearing and retrying with default');
          setVoiceId(null);
          response = await makeRequest(DEFAULT_VOICE);
        }
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(formatApiError(response.status, errData, '语音合成'));
      }

      await playBlobAudio(response, audioRef, () => setIsSpeaking(false));
    } catch (err) {
      setIsSpeaking(false);
      setError(err instanceof Error ? err.message : 'TTS 播放失败');
    }
  }, [setVoiceId, voiceId]);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setIsSpeaking(false);
    setError(null);
  }, []);

  const cancelPendingClone = useCallback(() => {
    cloneGenerationRef.current += 1;
    setIsCloning(false);
  }, []);

  const cloneVoice = useCallback(async (audioBlob: Blob, _referenceText?: string): Promise<string | null> => {
    const cloneGeneration = cloneGenerationRef.current + 1;
    cloneGenerationRef.current = cloneGeneration;
    console.log('[cosyvoice clone] START — blob size:', audioBlob.size, 'type:', audioBlob.type);
    setError(null);
    setIsCloning(true);

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'reference.wav');

      const response = await fetch(`${API_BASE}/cosyvoice-voice-clone`, {
        method: 'POST',
        headers: {
          'X-App-Token': APP_TOKEN,
        },
        body: formData,
      });

      if (!response.ok) {
        const rawText = await response.text();
        let errData: Record<string, unknown> = {};
        try {
          errData = JSON.parse(rawText) as Record<string, unknown>;
        } catch {
          if (rawText) errData = { error: rawText };
        }
        throw new Error(formatApiError(response.status, errData, '音色复刻'));
      }

      const data = await response.json();
      const newVoiceId =
        typeof data.voice_id === 'string'
          ? data.voice_id
          : typeof data.id === 'string'
            ? data.id
            : null;

      if (!newVoiceId) {
        throw new Error('未获取到音色 ID');
      }

      if (cloneGenerationRef.current !== cloneGeneration) {
        console.warn('[cosyvoice clone] IGNORE stale clone result');
        return null;
      }

      console.log('[cosyvoice clone] SUCCESS — voiceId:', newVoiceId);
      return newVoiceId;
    } catch (err) {
      if (cloneGenerationRef.current !== cloneGeneration) {
        return null;
      }
      const message = err instanceof Error
        ? (err.message === 'Failed to fetch'
          ? '网络连接失败，请检查网络后重试'
          : err.message)
        : '音色复刻失败';
      console.error('[cosyvoice clone] CATCH:', message, err);
      setError(message);
      return null;
    } finally {
      if (cloneGenerationRef.current === cloneGeneration) {
        setIsCloning(false);
      }
    }
  }, []);

  return {
    speak,
    stop,
    isSpeaking,
    cloneVoice,
    isCloning,
    voiceId,
    setVoiceId,
    cancelPendingClone,
    error,
  };
}
