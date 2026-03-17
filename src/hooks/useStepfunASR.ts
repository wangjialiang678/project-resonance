import { useState, useCallback } from 'react';
import { formatStepfunError } from '@/utils/stepfunErrors';

interface UseStepfunASRReturn {
  /** Transcribed text */
  finalText: string;
  /** Whether transcription is in progress */
  isProcessing: boolean;
  /** Error message if any */
  error: string | null;
  /** Send recorded audio blob to StepFun for transcription */
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
      const directKey = import.meta.env.VITE_STEPFUN_API_KEY;
      const formData = new FormData();
      formData.append('file', audioBlob, 'recording.webm');
      formData.append('model', 'step-asr');

      let response: Response;
      if (directKey) {
        // Direct mode: call StepFun API directly
        response = await fetch('https://api.stepfun.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${directKey}` },
          body: formData,
        });
      } else {
        throw new Error('请在设置中配置 StepFun API Key（VITE_STEPFUN_API_KEY）');
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(formatStepfunError(response.status, errData, '语音识别'));
      }

      const data = await response.json();
      const text = data.text?.trim() || '';
      
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
