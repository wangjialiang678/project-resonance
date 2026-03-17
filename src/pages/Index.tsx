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
    error: ttsError,
  } = useCosyVoiceTTS();

  return (
    <UsagePage
      onSpeak={speak}
      onStop={stop}
      isSpeaking={isSpeaking}
      voiceId={voiceId}
      isCloning={isCloning}
      ttsError={ttsError}
      onCloneVoice={cloneVoice}
      onClearVoice={() => setVoiceId(null)}
    />
  );
};

export default Index;
