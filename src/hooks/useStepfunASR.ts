import { useState, useCallback } from 'react';
import { formatStepfunError } from '@/utils/stepfunErrors';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface UseStepfunASRReturn {
  /** Transcribed text */
  finalText: string;
  /** Whether transcription is in progress */
  isProcessing: boolean;
  /** Error message if any */
  error: string | null;
  /** Send recorded audio blob to ASR proxy for transcription */
  transcribe: (audioBlob: Blob) => Promise<string | null>;
  /** Reset state */
  reset: () => void;
}

export function useStepfunASR(): UseStepfunASRReturn {
  const [finalText, setFinalText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transcribe = useCallback(async (audioBlob: Blob): Promise<string | null> => {
    setError(null);
    setIsProcessing(true);
    setFinalText('');

    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'recording.webm');
      const response = await fetch(`${API_BASE}/dashscope-asr`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(formatStepfunError(response.status, errData, '语音识别'));
      }

      const data = await response.json();
      const text = typeof data.text === 'string' ? data.text.trim() : '';
      
      if (text) {
        setFinalText(text);
      } else {
        setError('未能识别到语音内容');
      }

      setIsProcessing(false);
      return text || null;
    } catch (err) {
      const message = err instanceof Error ? err.message : '识别失败';
      setError(message);
      setIsProcessing(false);
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setFinalText('');
    setIsProcessing(false);
    setError(null);
  }, []);

  return {
    finalText,
    isProcessing,
    error,
    transcribe,
    reset,
  };
}
