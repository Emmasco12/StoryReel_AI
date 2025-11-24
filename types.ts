
export enum AppState {
  IDLE = 'IDLE',
  GENERATING_SCRIPT = 'GENERATING_SCRIPT',
  GENERATING_ASSETS = 'GENERATING_ASSETS',
  READY = 'READY',
  ERROR = 'ERROR'
}

export type TransitionEffect = 'none' | 'fade' | 'slide' | 'zoom';

export interface ScriptScene {
  narration: string;
  visual_prompt: string;
}

export interface GeneratedScene extends ScriptScene {
  id: string;
  imageUrl?: string; // Base64 data URI
  videoUrl?: string; // Blob URL to MP4
  audioUrl?: string; // Blob URL or Base64 data URI
  audioDuration?: number;
  status: 'pending' | 'loading' | 'completed' | 'error';
  isRegeneratingAudio?: boolean;
  isRegeneratingImage?: boolean;
  isGeneratingVideo?: boolean;
  currentTask?: string;
  progress?: number;
}

export interface ProjectData {
  title: string;
  originalText: string;
  scenes: GeneratedScene[];
  aspectRatio: '9:16' | '16:9' | '1:1';
}

export interface VoiceOption {
  id: string;
  name: string;
  gender: 'Male' | 'Female';
}

export interface MusicOption {
  id: string;
  name: string;
  url: string;
  style: string;
}
