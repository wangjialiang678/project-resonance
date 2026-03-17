export interface Phrase {
  id: string;
  text: string;
  category: string;
  enabled: boolean;
  recordingCount: number;
  recordings: Recording[];
  createdAt: number;
}

export interface Recording {
  id: string;
  phraseId: string;
  blob: Blob;
  duration: number;
  timestamp: number;
}

export interface RecognitionResult {
  phraseId: string;
  text: string;
  confidence: number;
  distance: number;
}

export interface ASRSettings {
  /** ASR provider: 'dashscope' or 'volcengine' */
  provider: 'dashscope' | 'volcengine';
  appKey: string;
  accessKey: string;
  resourceId: string;
  proxyUrl: string;
  mockMode: boolean;
}

export const DEFAULT_ASR_SETTINGS: ASRSettings = {
  provider: 'dashscope',
  appKey: '',
  accessKey: '',
  resourceId: 'volc.bigasr.sauc.duration',
  proxyUrl: '',
  mockMode: false,
};

export interface AppSettings {
  topK: number;
  absThreshold: number;
  ratioThreshold: number;
  maxTemplatesPerPhrase: number;
  ttsRate: number;
  ttsVolume: number;
  ttsPitch: number;
  ttsVoice: string;
  asr: ASRSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  topK: 3,
  absThreshold: 0.6,
  ratioThreshold: 0.75,
  maxTemplatesPerPhrase: 10,
  ttsRate: 1.0,
  ttsVolume: 1.0,
  ttsPitch: 1.0,
  ttsVoice: '',
  asr: DEFAULT_ASR_SETTINGS,
};

export type PageTab = 'training' | 'usage' | 'phrases' | 'settings' | 'data';

export const CATEGORIES = [
  '生理需求',
  '照护协助',
  '疼痛不适',
  '社交寒暄',
  '家居日常',
  '出行交通',
  '紧急求助',
  '情绪表达',
  '饮食相关',
  '其他',
] as const;

export type Category = typeof CATEGORIES[number];
