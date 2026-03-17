import { useCosyVoiceTTS } from '@/hooks/useCosyVoiceTTS';
import UsagePage from './UsagePage';

const Index = () => {
  const {
    speak,
    stop,
    isSpeaking,
    cloneVoice,
    isCloning,
    voiceId,
    setVoiceId,
    cancelPendingClone,
    error: ttsError,
  } = useCosyVoiceTTS();

  const cloneAndPersistVoiceId = async (audioBlob: Blob, referenceText?: string) => {
    const nextVoiceId = await cloneVoice(audioBlob, referenceText);
    if (nextVoiceId) {
      setVoiceId(nextVoiceId);
    }
    return nextVoiceId;
  };

  return (
    <UsagePage
      onSpeak={speak}
      onStop={stop}
      isSpeaking={isSpeaking}
      voiceId={voiceId}
      isCloning={isCloning}
      ttsError={ttsError}
      onCloneVoice={cloneAndPersistVoiceId}
      onCancelCloneResult={cancelPendingClone}
      onClearVoice={() => setVoiceId(null)}
    />
  );
};

export default Index;
