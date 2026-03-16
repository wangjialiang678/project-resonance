import { useState, useCallback, useRef, useEffect } from 'react';

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
 * Try streaming audio playback via MediaSource Extensions (Chrome/Edge).
 * Falls back to full-blob playback on unsupported browsers (Safari/Firefox).
 */
async function playStreamingAudio(
  response: Response,
  audioRef: React.MutableRefObject<HTMLAudioElement | null>,
  onEnd: () => void,
): Promise<void> {
  const body = response.body;

  // Check MSE support for audio/mpeg
  const mseSupported =
    typeof MediaSource !== 'undefined' &&
    MediaSource.isTypeSupported('audio/mpeg');

  if (mseSupported && body) {
    // --- Streaming playback: start playing as soon as first chunks arrive ---
    const audio = new Audio();
    audioRef.current = audio;

    const mediaSource = new MediaSource();
    audio.src = URL.createObjectURL(mediaSource);

    await new Promise<void>((resolve, reject) => {
      mediaSource.addEventListener('sourceopen', async () => {
        try {
          const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
          const reader = body.getReader();
          let started = false;

          const appendChunk = (chunk: ArrayBuffer) =>
            new Promise<void>((res) => {
              sourceBuffer.appendBuffer(chunk);
              sourceBuffer.addEventListener('updateend', () => res(), { once: true });
            });

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              if (mediaSource.readyState === 'open') {
                mediaSource.endOfStream();
              }
              break;
            }
            if (value) {
              await appendChunk(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer);
              // Start playback after first chunk is buffered
              if (!started) {
                started = true;
                audio.play().catch(() => {});
              }
            }
          }

          audio.onended = () => { onEnd(); resolve(); };
          audio.onerror = () => { onEnd(); resolve(); };

          // If audio already ended (very short clip)
          if (audio.ended) { onEnd(); resolve(); }
        } catch (e) {
          onEnd();
          reject(e);
        }
      }, { once: true });
    });
  } else {
    // --- Fallback: full-blob playback ---
    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    audioRef.current = audio;

    audio.onended = () => {
      onEnd();
      URL.revokeObjectURL(audioUrl);
    };
    audio.onerror = () => {
      onEnd();
      URL.revokeObjectURL(audioUrl);
    };

    await audio.play();
  }
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
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      if (!supabaseUrl) throw new Error('未配置后端地址');

      setIsSpeaking(true);

      const effectiveVoice = overrideVoice || voiceId || 'cixingnansheng';

      const makeRequest = async (voice: string) => {
        return fetch(`${supabaseUrl}/functions/v1/stepfun-tts`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ text, voice, speed: 1.0 }),
        });
      };

      let response = await makeRequest(effectiveVoice);

      // If cloned voice is invalid, auto-clear and retry with default
      if (!response.ok && effectiveVoice !== 'cixingnansheng') {
        const errData = await response.json().catch(() => ({}));
        const detail = errData.detail || errData.error || '';
        if (detail.includes('voice_id_invalid') || detail.includes('does not exist')) {
          console.warn('[TTS] Invalid voice_id, clearing and retrying with default');
          setVoiceId(null);
          response = await makeRequest('cixingnansheng');
        }
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `TTS 请求失败 (${response.status})`);
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
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      if (!supabaseUrl) throw new Error('未配置后端地址');

      const formData = new FormData();
      formData.append('audio', audioBlob, 'reference.wav');
      if (referenceText) {
        formData.append('text', referenceText);
      }

      // 60s timeout to prevent infinite spinner (clone involves upload + API call)
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      console.log('[cloneVoice] fetching', supabaseUrl + '/functions/v1/stepfun-voice-clone');
      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/stepfun-voice-clone`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: formData,
          signal: controller.signal,
        });

        console.log('[cloneVoice] response status:', response.status);

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          console.error('[cloneVoice] API error:', JSON.stringify(errData));
          throw new Error(errData.error || `音色复刻失败 (${response.status})`);
        }

        const data = await response.json();
        console.log('[cloneVoice] API response:', JSON.stringify(data));
        const newVoiceId = data.voice_id;

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
