import { Routes, Route } from 'react-router-dom';
import { useAppData } from '@/hooks/useAppData';
import { useTTS } from '@/hooks/useTTS';
import { useCosyVoiceTTS } from '@/hooks/useCosyVoiceTTS';
import { useMemo, useState, useEffect, lazy, Suspense } from 'react';
import UsagePage from './pages/UsagePage';

const TrainingPage = lazy(() => import('./pages/TrainingPage'));
const PhrasesPage = lazy(() => import('./pages/PhrasesPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

const WelcomePage = lazy(() => import('./pages/WelcomePage'));
const NotFound = lazy(() => import('./pages/NotFound'));

const ONBOARDING_KEY = 'resonance_onboarding_done';

export default function AppRoutes() {
  const [showWelcome, setShowWelcome] = useState(false);
  const [welcomeChecked, setWelcomeChecked] = useState(false);

  const {
    phrases,
    settings,
    setSettings,
    addRecording,
    deleteRecording,
    updatePhrase,
    addPhrase,
    deletePhrase,
    clearAllData,
    clearTrainingData,
    exportData,
    importData,
    recognize,
    isLoaded,
  } = useAppData();

  useEffect(() => {
    if (isLoaded) {
      const done = localStorage.getItem(ONBOARDING_KEY);
      setShowWelcome(!done);
      setWelcomeChecked(true);
    }
  }, [isLoaded]);

  const handleOnboardingComplete = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    setShowWelcome(false);
  };

  const { speak, stop, isSpeaking } = useTTS(
    settings.ttsRate,
    settings.ttsVolume,
    settings.ttsPitch,
    settings.ttsVoice
  );

  const {
    speak: apiSpeak,
    stop: apiStop,
    isSpeaking: apiIsSpeaking,
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

  const trainedCount = useMemo(
    () => phrases.filter((p) => p.enabled && p.recordingCount >= 2).length,
    [phrases]
  );

  const totalRecordings = useMemo(
    () => phrases.reduce((sum, p) => sum + p.recordingCount, 0),
    [phrases]
  );

  if (!welcomeChecked) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', color: '#999', fontSize: 14 }}>
        加载中...
      </div>
    );
  }

  if (showWelcome) {
    return (
      <Suspense fallback={<div className="flex items-center justify-center h-screen">加载中...</div>}>
        <WelcomePage onComplete={handleOnboardingComplete} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen">加载中...</div>}>
      <Routes>
        <Route
          path="/"
          element={
            <UsagePage
              onSpeak={apiSpeak}
              onStop={apiStop}
              isSpeaking={apiIsSpeaking}
              ttsError={ttsError}
              voiceId={voiceId}
              isCloning={isCloning}
              onCloneVoice={cloneAndPersistVoiceId}
              onCancelCloneResult={cancelPendingClone}
              onClearVoice={() => setVoiceId(null)}
            />
          }
        />
        <Route
          path="/training"
          element={
            <TrainingPage
              phrases={phrases}
              onAddRecording={addRecording}
              onDeleteRecording={deleteRecording}
            />
          }
        />
        <Route
          path="/phrases"
          element={
            <PhrasesPage
              phrases={phrases}
              onUpdate={updatePhrase}
              onAdd={addPhrase}
              onDelete={deletePhrase}
              onExport={exportData}
              onImport={importData}
            />
          }
        />
        <Route
          path="/settings"
          element={
            <SettingsPage
              settings={settings}
              onUpdate={setSettings}
              voiceId={voiceId}
              isCloning={isCloning}
              ttsError={ttsError}
              onCloneVoice={cloneAndPersistVoiceId}
              onSpeak={apiSpeak}
              onStop={apiStop}
              isSpeaking={apiIsSpeaking}
              onClearVoice={() => setVoiceId(null)}
            />
          }
        />
        
        
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
