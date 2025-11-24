
import React, { useState } from 'react';
import { 
  Sparkles, 
  Video, 
  Type as TypeIcon, 
  Image as ImageIcon, 
  Music, 
  ChevronRight, 
  Loader2, 
  LayoutTemplate,
  Volume2,
  RefreshCw,
  GalleryHorizontal,
  UserCircle,
  Clapperboard,
  CheckCircle2,
  AlertCircle,
  Clock,
  Play,
  Download,
  Film,
  Palette,
  Key,
  Youtube,
  UploadCloud,
  X,
  Wand2
} from 'lucide-react';
import { AppState, ProjectData, GeneratedScene, VoiceOption, MusicOption, TransitionEffect } from './types';
import { generateScript, generateImageForScene, generateSpeechForScene, generateVideoFromImage } from './services/gemini';
import { VideoPlayer } from './components/VideoPlayer';
import { generateVideo, downloadBlob } from './utils/videoGenerator';

// Custom TikTok Icon (Lucide doesn't have it)
const TikTokIcon = ({ size = 20, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M19.589 6.686a4.793 4.793 0 0 1-3.77-4.245V2h-3.445v13.672a2.896 2.896 0 0 1-5.201 1.743l-.002-.001.002.001a2.895 2.895 0 0 1 3.183-4.51v-3.5a6.329 6.329 0 0 0-5.394 10.692 6.33 6.33 0 0 0 10.857-4.424V8.687a8.182 8.182 0 0 0 4.773 1.526V6.79a4.831 4.831 0 0 1-1.003-.104z" />
  </svg>
);

// Mock Voice Options
const VOICE_OPTIONS: VoiceOption[] = [
  { id: 'Kore', name: 'Kore (Female)', gender: 'Female' },
  { id: 'Fenrir', name: 'Fenrir (Male)', gender: 'Male' },
  { id: 'Puck', name: 'Puck (Male)', gender: 'Male' },
  { id: 'Aoede', name: 'Aoede (Female)', gender: 'Female' },
];

// Mock Music Options
const MUSIC_OPTIONS: MusicOption[] = [
  { id: 'none', name: 'No Music', style: 'None', url: '' },
  { id: 'calm', name: 'Calm & Relaxing', style: 'Ambient', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3' },
  { id: 'upbeat', name: 'Upbeat & Happy', style: 'Pop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
  { id: 'dramatic', name: 'Dramatic & Epic', style: 'Cinematic', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3' },
  { id: 'lofi', name: 'Late Night Lo-fi', style: 'Lo-fi', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-10.mp3' },
  { id: 'chillhop', name: 'Chillhop Vibes', style: 'Chillhop', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-16.mp3' },
  { id: 'action', name: 'High Octane Action', style: 'Cinematic', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-15.mp3' },
  { id: 'mystery', name: 'Mystery & Suspense', style: 'Soundtrack', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-14.mp3' },
];

const STYLE_PRESETS = [
  "Cinematic 4K",
  "Pixar 3D Style",
  "Japanese Anime",
  "Cyberpunk Neon",
  "Watercolor Painting",
  "Vintage Film Noir",
  "GTA Loading Screen",
  "Low Poly"
];

// Helper for retrying async operations
async function retryOperation<T>(operation: () => Promise<T>, retries = 5, delay = 4000): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    if (retries <= 0) throw error;
    
    // Check for rate limiting errors
    const errorStr = error?.message || JSON.stringify(error);
    const isRateLimit = errorStr.includes('429') || errorStr.includes('RESOURCE_EXHAUSTED') || errorStr.includes('quota');
    
    // If rate limited, wait significantly longer (min 20s) to allow quota bucket to refill
    const waitTime = isRateLimit ? Math.max(delay, 20000) : delay;
    
    console.warn(`Operation failed${isRateLimit ? ' (Rate Limit)' : ''}. Retrying in ${waitTime}ms... (${retries} attempts left)`);
    
    await new Promise(resolve => setTimeout(resolve, waitTime));
    return retryOperation(operation, retries - 1, isRateLimit ? waitTime * 1.5 : waitTime * 2); 
  }
}

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [inputText, setInputText] = useState('');
  const [characterDesc, setCharacterDesc] = useState('');
  const [selectedRatio, setSelectedRatio] = useState<'9:16' | '16:9' | '1:1'>('9:16');
  const [selectedVoice, setSelectedVoice] = useState<string>('Kore');
  const [selectedMusic, setSelectedMusic] = useState<string>('calm');
  const [selectedTransition, setSelectedTransition] = useState<TransitionEffect>('fade');
  const [scenes, setScenes] = useState<GeneratedScene[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [notificationMsg, setNotificationMsg] = useState<string | null>(null); // For success/info messages
  
  // Lifted state from VideoPlayer
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const [isExportingFull, setIsExportingFull] = useState(false);

  const handleAddStyle = (style: string) => {
    if (!characterDesc) {
      setCharacterDesc(style);
    } else if (!characterDesc.includes(style)) {
      setCharacterDesc(prev => `${prev}, ${style}`);
    }
  };

  const handleCreateMagic = async () => {
    if (!inputText.trim()) return;

    // Check & Prompt for API Key automatically if not selected
    try {
      if ((window as any).aistudio) {
        const hasKey = await (window as any).aistudio.hasSelectedApiKey();
        if (!hasKey) {
          await (window as any).aistudio.openSelectKey();
        }
      }
    } catch (e) {
      console.warn("Auto API Key check failed:", e);
    }
    
    setAppState(AppState.GENERATING_SCRIPT);
    setErrorMsg(null);
    setNotificationMsg(null);

    try {
      const scriptScenes = await retryOperation(() => generateScript(inputText, characterDesc));
      
      const initialScenes: GeneratedScene[] = scriptScenes.map((s, idx) => ({
        ...s,
        id: `scene-${idx}-${Date.now()}`,
        status: 'pending',
        progress: 0
      }));

      setScenes(initialScenes);
      setAppState(AppState.GENERATING_ASSETS);

      for (let i = 0; i < initialScenes.length; i++) {
        const scene = initialScenes[i];
        try {
          // Start Loading - Phase 1: Image
          setScenes(prev => prev.map(s => s.id === scene.id ? { 
            ...s, 
            status: 'loading',
            currentTask: 'Painting scene...',
            progress: 20
          } : s));
          
          const imgBase64 = await retryOperation(() => generateImageForScene(scene.visual_prompt, selectedRatio, characterDesc));
          
          // Phase 2: Audio
          setScenes(prev => prev.map(s => s.id === scene.id ? { 
            ...s, 
            imageUrl: imgBase64,
            currentTask: 'Recording voiceover...',
            progress: 60
          } : s));

          await new Promise(r => setTimeout(r, 1000));
          const audioBase64 = await retryOperation(() => generateSpeechForScene(scene.narration, selectedVoice));

          // Completed
          setScenes(prev => prev.map(s => s.id === scene.id ? {
            ...s,
            audioUrl: audioBase64,
            status: 'completed',
            currentTask: 'Done',
            progress: 100
          } : s));

        } catch (e) {
          console.error(`Failed to generate assets for scene ${i}`, e);
          setScenes(prev => prev.map(s => s.id === scene.id ? { 
            ...s, 
            status: 'error', 
            currentTask: 'Failed',
            progress: 0 
          } : s));
        }

        if (i < initialScenes.length - 1) {
           await new Promise(resolve => setTimeout(resolve, 2000)); // Slight delay between scenes
        }
      }
      
      setAppState(AppState.READY);

    } catch (err: any) {
      console.error(err);
      let msg = err.message || "Something went wrong during generation.";
      if (msg.includes("API Key")) {
         msg = "API Key not found. Please click the 'API Key' button in the top right to select your key.";
      }
      setErrorMsg(msg);
      setAppState(AppState.ERROR);
    }
  };

  const handleReset = () => {
    setAppState(AppState.IDLE);
    setScenes([]);
    setErrorMsg(null);
    setNotificationMsg(null);
    setCurrentSceneIndex(0);
    setIsPlaying(false);
  };

  const handleUpdateSceneText = (id: string, field: 'narration' | 'visual_prompt', value: string) => {
    setScenes(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  };

  const handleRegenerateAudio = async (id: string) => {
    const scene = scenes.find(s => s.id === id);
    if (!scene) return;
    setScenes(prev => prev.map(s => s.id === id ? { ...s, isRegeneratingAudio: true } : s));

    try {
      const audioUrl = await retryOperation(() => generateSpeechForScene(scene.narration, selectedVoice));
      setScenes(prev => prev.map(s => s.id === id ? { ...s, audioUrl, isRegeneratingAudio: false } : s));
    } catch (e) {
      console.error("Failed to regenerate audio", e);
      setScenes(prev => prev.map(s => s.id === id ? { ...s, isRegeneratingAudio: false } : s));
    }
  };

  const handleRegenerateImage = async (id: string) => {
    const scene = scenes.find(s => s.id === id);
    if (!scene) return;
    setScenes(prev => prev.map(s => s.id === id ? { ...s, isRegeneratingImage: true } : s));

    try {
      const imageUrl = await retryOperation(() => generateImageForScene(scene.visual_prompt, selectedRatio, characterDesc));
      setScenes(prev => prev.map(s => s.id === id ? { ...s, imageUrl, isRegeneratingImage: false } : s));
    } catch (e) {
      console.error("Failed to regenerate image", e);
      setScenes(prev => prev.map(s => s.id === id ? { ...s, isRegeneratingImage: false } : s));
    }
  };

  const handleAnimateScene = async (id: string) => {
    const scene = scenes.find(s => s.id === id);
    if (!scene || !scene.imageUrl) return;

    try {
      const hasKey = await (window as any).aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await (window as any).aistudio.openSelectKey();
      }
    } catch (e) {
      console.error("API Key selection error:", e);
      setErrorMsg("Failed to verify API Key. Please try again using the Key button.");
      return;
    }

    setScenes(prev => prev.map(s => s.id === id ? { ...s, isGeneratingVideo: true } : s));

    try {
      const fullPrompt = characterDesc 
        ? `Character/Style Reference: ${characterDesc}. \nScene Action: ${scene.visual_prompt}` 
        : scene.visual_prompt;
      
      const videoUrl = await generateVideoFromImage(scene.imageUrl, fullPrompt, selectedRatio);
      
      setScenes(prev => prev.map(s => s.id === id ? { ...s, videoUrl, isGeneratingVideo: false } : s));
    } catch (e: any) {
      console.error("Failed to animate scene", e);
      if (e.message.includes("API_KEY_REQUIRED") || e.message.includes("403") || e.message.includes("401")) {
         setErrorMsg("Valid API Key required for video generation. Please select a paid key using the Key button in the header.");
         try { await (window as any).aistudio.openSelectKey(); } catch {}
      } else {
         setErrorMsg(`Animation failed: ${e.message}`);
      }
      setScenes(prev => prev.map(s => s.id === id ? { ...s, isGeneratingVideo: false } : s));
    }
  };

  const handleRegenerateScene = async (id: string) => {
    const scene = scenes.find(s => s.id === id);
    if (!scene) return;

    setScenes(prev => prev.map(s => s.id === id ? { 
      ...s, 
      isRegeneratingAudio: true, 
      isRegeneratingImage: true,
      videoUrl: undefined 
    } : s));

    try {
      const newImageUrl = await retryOperation(() => generateImageForScene(scene.visual_prompt, selectedRatio, characterDesc));
      await new Promise(r => setTimeout(r, 1000));
      const newAudioUrl = await retryOperation(() => generateSpeechForScene(scene.narration, selectedVoice));

      setScenes(prev => prev.map(s => s.id === id ? { 
        ...s, 
        imageUrl: newImageUrl, 
        audioUrl: newAudioUrl, 
        isRegeneratingAudio: false, 
        isRegeneratingImage: false,
        status: 'completed'
      } : s));
    } catch (e) {
      console.error("Failed to regenerate scene", e);
      setScenes(prev => prev.map(s => s.id === id ? { 
        ...s, 
        isRegeneratingAudio: false, 
        isRegeneratingImage: false 
      } : s));
    }
  };

  const handleDownloadScene = async (scene: GeneratedScene, index: number) => {
    try {
      const blob = await generateVideo([scene], selectedRatio);
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      downloadBlob(blob, `storyreel-scene-${index + 1}.${ext}`);
    } catch (e) {
      console.error("Download failed", e);
      const link = document.createElement('a');
      if (scene.videoUrl) {
        link.href = scene.videoUrl;
        link.download = `storyreel-scene-${index + 1}.mp4`;
      } else if (scene.imageUrl) {
        link.href = scene.imageUrl;
        link.download = `storyreel-scene-${index + 1}.png`;
      } else {
        return;
      }
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleExportFullMovie = async () => {
    if (scenes.length === 0) return;
    setIsExportingFull(true);
    setIsPlaying(false);
    setNotificationMsg("Rendering full movie... please wait.");

    try {
      const readyScenes = scenes.filter(s => (s.imageUrl || s.videoUrl) && s.audioUrl);
      if (readyScenes.length === 0) throw new Error("No completed scenes to export");

      const blob = await generateVideo(readyScenes, selectedRatio);
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      downloadBlob(blob, `storyreel-full-movie.${ext}`);
      setNotificationMsg("Download started!");
    } catch (e: any) {
      console.error("Export Full Movie Failed", e);
      setErrorMsg("Failed to export full movie: " + e.message);
      setNotificationMsg(null);
    } finally {
      setIsExportingFull(false);
    }
  };

  const handleSocialExport = async (platform: 'tiktok' | 'youtube') => {
    if (scenes.length === 0) return;
    setIsExportingFull(true);
    setIsPlaying(false);
    
    const platformName = platform === 'tiktok' ? 'TikTok' : 'YouTube';
    setNotificationMsg(`Preparing video for ${platformName}...`);

    try {
      const readyScenes = scenes.filter(s => (s.imageUrl || s.videoUrl) && s.audioUrl);
      if (readyScenes.length === 0) throw new Error("No completed scenes");

      const blob = await generateVideo(readyScenes, selectedRatio);
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      const filename = `storyreel-${platform}-${Date.now()}.${ext}`;

      downloadBlob(blob, filename);

      const url = platform === 'tiktok' 
        ? 'https://www.tiktok.com/upload?lang=en' 
        : 'https://www.youtube.com/upload';
      
      window.open(url, '_blank');
      
      setNotificationMsg(`Video downloaded! Opening ${platformName} upload page...`);
      
    } catch (e: any) {
      console.error("Social Export failed", e);
      setErrorMsg(`Failed to prepare for ${platformName}: ${e.message}`);
      setNotificationMsg(null);
    } finally {
      setIsExportingFull(false);
    }
  };

  const selectedMusicUrl = MUSIC_OPTIONS.find(m => m.id === selectedMusic)?.url;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-blue-500/30">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={handleReset}>
            <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-2 rounded-lg">
              <Video size={20} className="text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight">StoryReel AI</span>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => {
                try {
                  (window as any).aistudio?.openSelectKey();
                } catch(e) { console.warn("Key selector not available", e); }
              }}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium border border-slate-700 transition"
              title="Manage Gemini API Key"
            >
              <Key size={14} />
              <span className="hidden sm:inline">API Key</span>
            </button>
            <span className="text-xs font-medium px-2 py-1 bg-blue-500/10 text-blue-400 rounded border border-blue-500/20">BETA</span>
            <div className="w-8 h-8 rounded-full bg-gradient-to-r from-purple-500 to-pink-500"></div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8">
        
        {/* Notifications & Errors */}
        <div className="space-y-4 mb-6">
          {errorMsg && (
            <div className="p-4 bg-red-900/20 border border-red-800 text-red-200 rounded-lg flex items-center justify-between animate-fade-in shadow-sm">
              <div className="flex items-center gap-2">
                <AlertCircle size={18} />
                <span>{errorMsg}</span>
              </div>
              <button onClick={() => setErrorMsg(null)} className="p-1 hover:bg-red-900/40 rounded"><X size={16} /></button>
            </div>
          )}
          {notificationMsg && (
            <div className="p-4 bg-blue-900/20 border border-blue-800 text-blue-200 rounded-lg flex items-center justify-between animate-fade-in shadow-sm">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-blue-400" />
                <span>{notificationMsg}</span>
              </div>
              <button onClick={() => setNotificationMsg(null)} className="p-1 hover:bg-blue-900/40 rounded"><X size={16} /></button>
            </div>
          )}
        </div>

        {appState === AppState.IDLE && (
          <div className="max-w-3xl mx-auto animate-fade-in-up">
            <div className="text-center mb-10">
              <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-300 to-purple-400 mb-4">
                Turn Text into Viral Videos
              </h1>
              <p className="text-slate-400 text-lg max-w-2xl mx-auto">
                Create engaging stories for TikTok, Reels, and Shorts in seconds using AI. 
                Just type your idea, and we'll handle the script, visuals, and voice.
              </p>
            </div>

            <div className="bg-slate-900 rounded-2xl border border-slate-800 p-6 md:p-8 shadow-2xl">
              
              {/* Text Input */}
              <div className="mb-6">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-3">
                  <TypeIcon size={16} />
                  <span>Your Story or Script</span>
                </label>
                <textarea
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-4 text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition resize-none h-32"
                  placeholder="E.g., A cyberpunk detective walking through a neon-lit city in rain, looking for clues about a missing robot..."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                />
              </div>

              {/* Character & Style Input */}
              <div className="mb-8 p-6 bg-gradient-to-r from-indigo-900/30 to-purple-900/30 border border-indigo-500/30 rounded-xl shadow-lg relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 blur-3xl rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
                
                <div className="flex flex-col gap-4 relative z-10">
                  <label className="flex items-center gap-2 text-lg font-bold text-white">
                    <UserCircle size={24} className="text-indigo-400" />
                    <span>Character & Art Style Reference</span>
                  </label>
                  
                  <div className="bg-indigo-950/40 rounded-lg p-3 border border-indigo-500/20 text-sm text-indigo-200/90 leading-relaxed">
                    <p className="mb-1"><span className="text-indigo-300 font-semibold">Pro Tip:</span> Describes your main character and visual style for <strong>consistent</strong> results across all scenes.</p>
                  </div>

                  <input
                    type="text"
                    className="w-full bg-slate-950/80 border border-indigo-500/30 rounded-lg p-4 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all shadow-inner backdrop-blur-sm"
                    placeholder="Describe character appearance and art style here..."
                    value={characterDesc}
                    onChange={(e) => setCharacterDesc(e.target.value)}
                  />

                  {/* Quick Style Chips */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 mr-2">
                       <Palette size={12} />
                       <span>Quick Styles:</span>
                    </div>
                    {STYLE_PRESETS.map((style) => (
                      <button
                        key={style}
                        onClick={() => handleAddStyle(style)}
                        className={`text-xs px-2.5 py-1.5 rounded-full border transition-all ${
                          characterDesc.includes(style) 
                            ? 'bg-indigo-500 text-white border-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.4)]' 
                            : 'bg-slate-900/50 border-slate-700 text-slate-400 hover:border-indigo-400 hover:text-indigo-300'
                        }`}
                      >
                        {style}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Settings Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-3">
                    <LayoutTemplate size={16} />
                    <span>Video Format</span>
                  </label>
                  <div className="flex gap-2">
                    {[
                      { id: '9:16', label: '9:16' },
                      { id: '16:9', label: '16:9' },
                      { id: '1:1', label: '1:1' }
                    ].map(ratio => (
                      <button
                        key={ratio.id}
                        onClick={() => setSelectedRatio(ratio.id as any)}
                        className={`flex-1 py-2.5 text-xs lg:text-sm rounded-lg border transition ${
                          selectedRatio === ratio.id 
                            ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/30' 
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-750 hover:border-slate-600'
                        }`}
                      >
                        {ratio.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-3">
                    <GalleryHorizontal size={16} />
                    <span>Transition</span>
                  </label>
                  <select 
                    value={selectedTransition}
                    onChange={(e) => setSelectedTransition(e.target.value as TransitionEffect)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-sm"
                  >
                    <option value="fade">Cross Fade</option>
                    <option value="slide">Slide</option>
                    <option value="zoom">Zoom In</option>
                    <option value="none">None (Cut)</option>
                  </select>
                </div>

                <div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-3">
                    <Volume2 size={16} />
                    <span>AI Narrator</span>
                  </label>
                  <select 
                    value={selectedVoice}
                    onChange={(e) => setSelectedVoice(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-sm"
                  >
                    {VOICE_OPTIONS.map(v => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-3">
                    <Music size={16} />
                    <span>Background Music</span>
                  </label>
                  <select 
                    value={selectedMusic}
                    onChange={(e) => setSelectedMusic(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-sm"
                  >
                    {MUSIC_OPTIONS.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                onClick={handleCreateMagic}
                disabled={!inputText.trim()}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-3 transition-all transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-blue-900/20"
              >
                <Sparkles size={20} className="animate-pulse" />
                <span>Generate Video</span>
              </button>
            </div>
          </div>
        )}

        {appState === AppState.GENERATING_SCRIPT && (
          <div className="flex flex-col items-center justify-center py-20 animate-fade-in">
             <div className="relative">
                <div className="absolute inset-0 bg-blue-500 blur-xl opacity-20 animate-pulse rounded-full"></div>
                <Loader2 size={64} className="text-blue-500 animate-spin relative z-10" />
             </div>
             <h2 className="text-2xl font-bold mt-8 text-white">Writing Script & Scenes...</h2>
             <p className="text-slate-400 mt-2 text-center max-w-md">
                Our AI is directing the movie in its head.
             </p>
          </div>
        )}

        {appState === AppState.GENERATING_ASSETS && (
          <div className="max-w-4xl mx-auto py-12 animate-fade-in">
             <div className="text-center mb-10">
                <div className="inline-flex items-center justify-center p-3 bg-blue-500/10 rounded-full mb-4">
                  <Wand2 size={24} className="text-blue-400 animate-pulse" />
                </div>
                <h2 className="text-3xl font-bold text-white mb-2">Bringing Your Story to Life</h2>
                <p className="text-slate-400">Generating high-quality images and voiceovers for each scene.</p>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               {scenes.map((scene, idx) => (
                 <div key={scene.id} className={`
                    relative overflow-hidden p-4 rounded-xl border transition-all duration-500 flex flex-col gap-4
                    ${scene.status === 'loading' ? 'bg-blue-900/10 border-blue-500/50 shadow-lg shadow-blue-900/10 scale-[1.01]' : 
                      scene.status === 'completed' ? 'bg-slate-900/80 border-green-500/30' : 
                      scene.status === 'error' ? 'bg-red-900/10 border-red-500/30' :
                      'bg-slate-900/40 border-slate-800 opacity-60 grayscale-[0.5]'}
                 `}>
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                           <div className={`
                             w-8 h-8 rounded-full flex items-center justify-center border
                             ${scene.status === 'pending' ? 'bg-slate-800 border-slate-700 text-slate-500' :
                               scene.status === 'loading' ? 'bg-blue-900/50 border-blue-500 text-blue-400' :
                               scene.status === 'completed' ? 'bg-green-900/50 border-green-500 text-green-400' :
                               'bg-red-900/50 border-red-500 text-red-400'}
                           `}>
                              {scene.status === 'pending' && <Clock size={14} />}
                              {scene.status === 'loading' && <Loader2 size={14} className="animate-spin" />}
                              {scene.status === 'completed' && <CheckCircle2 size={14} />}
                              {scene.status === 'error' && <AlertCircle size={14} />}
                           </div>
                           
                           <div>
                              <div className="flex items-center gap-2">
                                <span className={`text-xs font-bold uppercase tracking-wider ${scene.status === 'loading' ? 'text-blue-300' : 'text-slate-500'}`}>
                                  Scene {idx + 1}
                                </span>
                                {scene.status === 'loading' && (
                                   <span className="text-xs text-blue-300 font-mono animate-pulse">{scene.currentTask || 'Processing...'}</span>
                                )}
                              </div>
                              <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">{scene.narration}</p>
                           </div>
                        </div>
                    </div>

                    {/* Progress Bar Area */}
                    {scene.status === 'loading' && (
                       <div className="w-full bg-slate-800/50 rounded-full h-2 overflow-hidden relative">
                          <div 
                             className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-700 ease-out"
                             style={{ width: `${scene.progress || 5}%` }}
                          ></div>
                          <div className="absolute inset-0 bg-white/10 animate-pulse"></div>
                       </div>
                    )}
                 </div>
               ))}
             </div>
          </div>
        )}

        {appState === AppState.READY && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fade-in">
            {/* Left Col: Player */}
            <div className="lg:col-span-2 flex flex-col items-center sticky top-24 h-fit">
               <VideoPlayer 
                  scenes={scenes} 
                  aspectRatio={selectedRatio} 
                  backgroundMusicUrl={selectedMusicUrl}
                  transitionEffect={selectedTransition}
                  currentSceneIndex={currentSceneIndex}
                  onIndexChange={setCurrentSceneIndex}
                  isPlaying={isPlaying}
                  onPlayChange={setIsPlaying}
               />
            </div>

            {/* Right Col: Scenes List & Actions */}
            <div className="bg-slate-900 rounded-xl border border-slate-800 h-fit max-h-[800px] flex flex-col overflow-hidden">
              <div className="p-4 border-b border-slate-800 bg-slate-900/50 backdrop-blur">
                 <h3 className="text-lg font-bold flex items-center gap-2">
                   <ImageIcon size={18} className="text-blue-400" />
                   Edit Scenes
                 </h3>
              </div>

              <div className="space-y-6 flex-1 overflow-y-auto p-4 custom-scrollbar">
                {scenes.map((scene, idx) => (
                  <div key={scene.id} className={`bg-slate-950 p-4 rounded-lg border transition group ${currentSceneIndex === idx ? 'border-blue-500 ring-1 ring-blue-500/30' : 'border-slate-800 hover:border-slate-700'}`}>
                    <div className="flex justify-between items-center mb-3">
                      <div className="flex items-center gap-2">
                         <span className="text-xs font-mono text-slate-500 uppercase font-bold">Scene {idx + 1}</span>
                         <button 
                           onClick={() => { setCurrentSceneIndex(idx); setIsPlaying(true); }}
                           className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-blue-400 transition"
                           title="Play this scene"
                         >
                           <Play size={14} fill="currentColor" />
                         </button>
                         <button
                           onClick={() => handleDownloadScene(scene, idx)}
                           className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-green-400 transition"
                           title="Download scene"
                         >
                           <Download size={14} />
                         </button>
                      </div>

                      <div className="flex items-center gap-2">
                        {scene.status === 'error' && <span className="text-xs text-red-400 font-medium">Generation Failed</span>}
                        <button 
                          onClick={() => handleRegenerateScene(scene.id)}
                          disabled={scene.isRegeneratingAudio || scene.isRegeneratingImage || scene.isGeneratingVideo}
                          className="text-xs flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded border border-slate-700 transition disabled:opacity-50"
                        >
                          <RefreshCw size={12} className={(scene.isRegeneratingAudio || scene.isRegeneratingImage) ? "animate-spin" : ""} />
                          <span>Regen</span>
                        </button>
                      </div>
                    </div>

                    {scene.videoUrl && (
                        <div className="w-full mb-4 flex items-center justify-center gap-2 bg-green-900/20 border border-green-500/30 text-green-300 py-2 rounded-lg text-xs font-bold">
                            <Video size={14} />
                            <span>Video Generated</span>
                        </div>
                    )}

                    <div className="mb-4">
                      <div className="flex justify-between items-center mb-1">
                        <label className="text-xs font-semibold text-slate-400">Narration</label>
                        <button 
                          onClick={() => handleRegenerateAudio(scene.id)}
                          disabled={scene.isRegeneratingAudio}
                          className="text-xs flex items-center gap-1 text-blue-400 hover:text-blue-300 disabled:opacity-50"
                        >
                          <RefreshCw size={12} className={scene.isRegeneratingAudio ? "animate-spin" : ""} />
                          Update
                        </button>
                      </div>
                      <textarea
                        value={scene.narration}
                        onChange={(e) => handleUpdateSceneText(scene.id, 'narration', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-slate-200 focus:border-blue-500 focus:outline-none resize-none h-20"
                      />
                    </div>

                    <div>
                       <div className="flex justify-between items-center mb-1">
                        <label className="text-xs font-semibold text-slate-400">Visual Prompt</label>
                        <div className="flex items-center gap-3">
                          {!scene.videoUrl && scene.imageUrl && (
                            <button 
                              onClick={() => handleAnimateScene(scene.id)}
                              disabled={scene.isGeneratingVideo || scene.isRegeneratingImage}
                              className="text-xs flex items-center gap-1 text-purple-400 hover:text-purple-300 disabled:opacity-50 transition-colors"
                            >
                              {scene.isGeneratingVideo ? <Loader2 size={12} className="animate-spin" /> : <Clapperboard size={12} />}
                              <span>Animate</span>
                            </button>
                          )}
                          <button 
                            onClick={() => handleRegenerateImage(scene.id)}
                            disabled={scene.isRegeneratingImage || scene.isGeneratingVideo}
                            className="text-xs flex items-center gap-1 text-blue-400 hover:text-blue-300 disabled:opacity-50"
                          >
                            <RefreshCw size={12} className={scene.isRegeneratingImage ? "animate-spin" : ""} />
                            Update
                          </button>
                        </div>
                      </div>
                      <textarea
                        value={scene.visual_prompt}
                        onChange={(e) => handleUpdateSceneText(scene.id, 'visual_prompt', e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs text-slate-400 focus:text-slate-200 focus:border-blue-500 focus:outline-none resize-none h-20"
                      />
                    </div>

                  </div>
                ))}
                
                <button 
                  onClick={handleReset}
                  className="w-full py-3 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white transition text-sm font-medium"
                >
                  Create New Video
                </button>
              </div>

              {/* Action Footer */}
              <div className="p-4 border-t border-slate-800 bg-slate-900/80 backdrop-blur-md sticky bottom-0 z-10 flex flex-col gap-3">
                
                <button
                  onClick={handleExportFullMovie}
                  disabled={isExportingFull}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl font-bold shadow-lg shadow-blue-900/20 transition disabled:opacity-50 disabled:cursor-wait"
                >
                  {isExportingFull ? <Loader2 size={18} className="animate-spin" /> : <Film size={18} />}
                  <span>{isExportingFull ? "Rendering Full Movie..." : "Export Full Movie"}</span>
                </button>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => handleSocialExport('tiktok')}
                    disabled={isExportingFull}
                    className="flex items-center justify-center gap-2 px-3 py-2 bg-slate-800 hover:bg-[#000000] text-white border border-slate-700 hover:border-slate-600 rounded-lg text-xs font-semibold transition disabled:opacity-50 group"
                    title="Generate, Download and Open TikTok Upload"
                  >
                     <TikTokIcon size={16} className="text-white group-hover:text-[#ff0050]" />
                     <span>Post to TikTok</span>
                  </button>

                  <button
                    onClick={() => handleSocialExport('youtube')}
                    disabled={isExportingFull}
                    className="flex items-center justify-center gap-2 px-3 py-2 bg-slate-800 hover:bg-[#ff0000] hover:text-white text-white border border-slate-700 hover:border-red-600/50 rounded-lg text-xs font-semibold transition disabled:opacity-50 group"
                    title="Generate, Download and Open YouTube Studio"
                  >
                     <Youtube size={16} className="text-red-500 group-hover:text-white" />
                     <span>Post to Shorts</span>
                  </button>
                </div>
              </div>

            </div>
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-6 mt-12 bg-slate-900/30">
        <div className="max-w-6xl mx-auto px-4 text-center text-slate-500 text-sm">
          <p>© {new Date().getFullYear()} StoryReel AI. Powered by Google Gemini 2.5.</p>
        </div>
      </footer>
    </div>
  );
};

export default App;
