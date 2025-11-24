
import React, { useState, useEffect, useRef } from 'react';
import { GeneratedScene, TransitionEffect } from '../types';
import { Play, Pause, SkipBack, SkipForward, Download, Loader2, AlertCircle, Video, Share2, Film } from 'lucide-react';
import { generateVideo, downloadBlob } from '../utils/videoGenerator';

interface VideoPlayerProps {
  scenes: GeneratedScene[];
  aspectRatio: string;
  backgroundMusicUrl?: string;
  transitionEffect?: TransitionEffect;
  currentSceneIndex: number;
  onIndexChange: (index: number) => void;
  isPlaying: boolean;
  onPlayChange: (isPlaying: boolean) => void;
  onExportFull?: () => void;
  isExportingFull?: boolean;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ 
  scenes, 
  aspectRatio, 
  backgroundMusicUrl,
  transitionEffect = 'fade',
  currentSceneIndex,
  onIndexChange,
  isPlaying,
  onPlayChange,
  onExportFull,
  isExportingFull = false
}) => {
  const [progress, setProgress] = useState(0); // 0 to 100 for current scene
  const [isExporting, setIsExporting] = useState(false);
  
  // Share State for 2-step process
  const [shareState, setShareState] = useState<'idle' | 'generating' | 'ready'>('idle');
  const [shareFile, setShareFile] = useState<File | null>(null);
  
  // Persistent audio element ref to avoid creating new Audio() constantly
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bgAudioRef = useRef<HTMLAudioElement | null>(null);
  
  // Ref for the currently active video element (for play/pause sync)
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);
  
  const fallbackStartTimeRef = useRef<number | null>(null);
  const fallbackRafRef = useRef<number | null>(null);

  const FALLBACK_DURATION = 5000; // Duration for scenes without audio (5 seconds)

  // Initialize Audio Elements Once
  useEffect(() => {
    audioRef.current = new Audio();
    audioRef.current.preload = 'auto';

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
    };
  }, []);

  // Reset share state when scene changes
  useEffect(() => {
    setShareState('idle');
    setShareFile(null);
  }, [currentSceneIndex]);

  // Helper to determine container dimensions based on aspect ratio
  const getContainerStyle = () => {
    switch (aspectRatio) {
      case '9:16': return 'max-w-[300px] aspect-[9/16]';
      case '1:1': return 'max-w-[500px] aspect-square';
      case '16:9': default: return 'max-w-[700px] aspect-[16/9]';
    }
  };

  const currentScene = scenes[currentSceneIndex];
  // Ensure we only try to play if we have a valid URL and are not regenerating
  const hasAudio = !!currentScene?.audioUrl && !currentScene?.isRegeneratingAudio;

  const handleSceneEnd = () => {
    if (currentSceneIndex < scenes.length - 1) {
      // Move to next scene
      onIndexChange(currentSceneIndex + 1);
      setProgress(0);
      fallbackStartTimeRef.current = null; 
    } else {
      // End of video
      onPlayChange(false);
      onIndexChange(0);
      setProgress(0);
      fallbackStartTimeRef.current = null;
      
      // Reset background music
      if (bgAudioRef.current) {
        bgAudioRef.current.pause();
        bgAudioRef.current.currentTime = 0;
      }
    }
  };

  // Initialize & Manage Background Music
  useEffect(() => {
    if (bgAudioRef.current) {
      bgAudioRef.current.pause();
    }

    if (backgroundMusicUrl) {
      const bgAudio = new Audio(backgroundMusicUrl);
      bgAudio.loop = true;
      bgAudio.volume = 0.15; 
      bgAudioRef.current = bgAudio;

      if (isPlaying) {
        bgAudio.play().catch(e => {
           console.warn("Background music autoplay blocked", e);
        });
      }
    } else {
      bgAudioRef.current = null;
    }

    return () => {
      if (bgAudioRef.current) {
        bgAudioRef.current.pause();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundMusicUrl]);

  // Sync Background Music & Video Loop Play/Pause
  useEffect(() => {
    const bgAudio = bgAudioRef.current;
    if (bgAudio) {
      if (isPlaying) {
        bgAudio.play().catch(e => console.warn("BG Music Play failed", e));
      } else {
        bgAudio.pause();
      }
    }
    
    // Sync current video element if exists
    if (activeVideoRef.current) {
      if (isPlaying) activeVideoRef.current.play().catch(e => console.warn("Video Play failed", e));
      else activeVideoRef.current.pause();
    }
  }, [isPlaying]);

  // Main Playback Logic
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Cleanup fallback if it was running
    if (fallbackRafRef.current) {
      cancelAnimationFrame(fallbackRafRef.current);
      fallbackRafRef.current = null;
    }

    // Reset video refs when scene changes
    if (activeVideoRef.current) {
        activeVideoRef.current.currentTime = 0;
        if(isPlaying) activeVideoRef.current.play().catch(() => {});
    }

    // Also reset progress when index changes
    setProgress(0);

    // === 1. Audio Playback Path ===
    if (hasAudio && currentScene.audioUrl) {
      fallbackStartTimeRef.current = null;

      // Update Source if changed
      if (audio.src !== currentScene.audioUrl) {
        audio.src = currentScene.audioUrl;
        audio.load();
      }

      const onTimeUpdate = () => {
        if (audio.duration && !isNaN(audio.duration)) {
           setProgress((audio.currentTime / audio.duration) * 100);
        }
      };

      const onEnded = () => {
        handleSceneEnd();
      };
      
      const onError = (e: Event) => {
        console.error("Audio playback error:", audio.error);
        onPlayChange(false);
      };

      audio.addEventListener('timeupdate', onTimeUpdate);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);

      if (isPlaying) {
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch(error => {
            console.warn("Playback prevented:", error);
            if (error.name === 'NotAllowedError' || error.name === 'NotSupportedError') {
               onPlayChange(false);
            }
          });
        }
      } else {
        audio.pause();
      }

      return () => {
        audio.removeEventListener('timeupdate', onTimeUpdate);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
      };
    } 
    
    // === 2. Fallback Playback Path (No Audio) ===
    else {
      audio.pause();
      
      if (isPlaying) {
        const animate = () => {
          if (!fallbackStartTimeRef.current) {
            fallbackStartTimeRef.current = Date.now() - (progress / 100 * FALLBACK_DURATION);
          }
          
          const elapsed = Date.now() - fallbackStartTimeRef.current;
          const newProgress = Math.min((elapsed / FALLBACK_DURATION) * 100, 100);
          
          setProgress(newProgress);

          if (newProgress >= 100) {
            handleSceneEnd();
            fallbackStartTimeRef.current = null;
          } else {
            fallbackRafRef.current = requestAnimationFrame(animate);
          }
        };
        fallbackRafRef.current = requestAnimationFrame(animate);
      } else {
        fallbackStartTimeRef.current = null;
      }
    }

    return () => {
      if (fallbackRafRef.current) cancelAnimationFrame(fallbackRafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSceneIndex, hasAudio, isPlaying, currentScene?.audioUrl]);


  const togglePlay = () => {
    if (!scenes.length) return;
    onPlayChange(!isPlaying);
  };

  const skip = (direction: 'next' | 'prev') => {
    let newIndex = direction === 'next' ? currentSceneIndex + 1 : currentSceneIndex - 1;
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= scenes.length) newIndex = scenes.length - 1;
    
    onPlayChange(false);
    onIndexChange(newIndex);
    setProgress(0);
    fallbackStartTimeRef.current = null;
  };

  const handleDownload = async () => {
    const scene = scenes[currentSceneIndex];
    if (!scene) return;
    
    setIsExporting(true);
    
    // Pause playback during export to prevent resource contention
    const wasPlaying = isPlaying;
    if (wasPlaying) onPlayChange(false);

    try {
      // Generate single scene video (Audio + Visual)
      const blob = await generateVideo([scene], aspectRatio);
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      downloadBlob(blob, `storyreel-scene-${currentSceneIndex + 1}.${ext}`);
    } catch (e) {
      console.error("Export failed", e);
      alert("Failed to export video. See console for details.");
    } finally {
      setIsExporting(false);
      if (wasPlaying) onPlayChange(true);
    }
  };

  const handleShareClick = async () => {
    const scene = scenes[currentSceneIndex];
    if (!scene) return;

    // STEP 2: Actual Share (User Gesture Required Here)
    if (shareState === 'ready' && shareFile) {
      try {
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [shareFile] })) {
          await navigator.share({
            title: `StoryReel Scene ${currentSceneIndex + 1}`,
            text: scene.narration,
            files: [shareFile]
          });
        } else {
          // Fallback for browsers that don't support file sharing
          downloadBlob(shareFile, shareFile.name);
          alert('Sharing files is not supported on this device. Video downloaded instead.');
        }
      } catch (error: any) {
         if (error.name !== 'AbortError') {
           console.error('Error sharing:', error);
           downloadBlob(shareFile, shareFile.name);
           alert('Sharing failed. Video downloaded instead.');
         }
      } finally {
        setShareState('idle');
        setShareFile(null);
      }
      return;
    }

    // STEP 1: Preparation (Async Generation)
    if (shareState === 'idle') {
      const wasPlaying = isPlaying;
      if (wasPlaying) onPlayChange(false);

      setShareState('generating');
      setIsExporting(true);

      try {
        // Generate the video blob
        const blob = await generateVideo([scene], aspectRatio);
        const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
        const file = new File([blob], `storyreel-scene-${currentSceneIndex+1}.${ext}`, { type: blob.type });

        setShareFile(file);
        setShareState('ready');
      } catch (error) {
         console.error('Error preparing share:', error);
         alert('Failed to prepare video for sharing.');
         setShareState('idle');
      } finally {
        setIsExporting(false);
      }
    }
  };

  const getTransitionClass = (index: number) => {
    const isActive = index === currentSceneIndex;
    const isPrev = index < currentSceneIndex;

    const baseClasses = "absolute inset-0 w-full h-full object-cover";

    switch (transitionEffect) {
      case 'none':
        return `${baseClasses} ${isActive ? 'z-10' : 'z-0 hidden'}`;
      case 'fade':
        return `${baseClasses} transition-opacity duration-700 ease-in-out ${isActive ? 'opacity-100 z-10' : 'opacity-0 z-0'}`;
      case 'zoom':
        return `${baseClasses} transition-all duration-1000 ease-in-out ${isActive ? 'opacity-100 scale-100 z-10' : 'opacity-0 scale-110 z-0'}`;
      case 'slide':
        let translateClass = 'translate-x-full';
        if (isActive) translateClass = 'translate-x-0';
        else if (isPrev) translateClass = '-translate-x-full';
        return `${baseClasses} transition-transform duration-500 ease-in-out transform ${translateClass} ${isActive ? 'z-10' : 'z-0'}`;
      default:
        return `${baseClasses} ${isActive ? 'block' : 'hidden'}`;
    }
  };

  if (!scenes.length) {
    return <div className="text-gray-500">No scenes to play.</div>;
  }

  const showLoading = !currentScene?.imageUrl && currentScene.status === 'loading';
  const showError = !currentScene?.imageUrl && currentScene.status === 'error';
  const showImage = !!currentScene?.imageUrl;

  return (
    <div className="flex flex-col items-center justify-center w-full">
      {/* Video Viewport */}
      <div className={`relative w-full ${getContainerStyle()} bg-black rounded-lg overflow-hidden shadow-2xl border border-gray-800`}>
        
        {/* Render Scenes (Images or Videos) */}
        {scenes.map((scene, index) => {
           const isActive = index === currentSceneIndex;
           
           if (scene.videoUrl) {
             return (
               <video 
                 key={scene.id}
                 src={scene.videoUrl}
                 className={`${getTransitionClass(index)} ${scene.isGeneratingVideo ? 'opacity-50 grayscale' : ''}`}
                 muted
                 loop
                 playsInline
                 ref={el => {
                   if (isActive && el) {
                     activeVideoRef.current = el;
                     if(isPlaying) el.play().catch(() => {});
                   }
                 }}
               />
             );
           }
           
           if (scene.imageUrl) {
             return (
              <img 
                key={scene.id}
                src={scene.imageUrl} 
                alt={`Scene ${index + 1}`}
                className={`${getTransitionClass(index)} ${scene.isRegeneratingImage || scene.isGeneratingVideo ? 'opacity-50 grayscale' : ''}`}
              />
             );
           }
           return null;
        })}

        {/* Current Scene Loading Placeholder */}
        {(!currentScene?.imageUrl && !currentScene?.videoUrl && !showError) && (
           <div className="absolute inset-0 z-0 bg-gray-900"></div>
        )}
        
        {/* Loading State Overlay */}
        {(showLoading || (!showImage && !showError)) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 bg-gray-900/80 z-20 gap-2">
            <Loader2 className="animate-spin text-blue-500" size={32} />
            <span className="text-sm font-medium">Generating Visual...</span>
          </div>
        )}

        {/* Error State Overlay */}
        {showError && (
           <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400 bg-gray-900 z-20 gap-2 p-4 text-center">
             <AlertCircle className="text-red-500" size={32} />
             <span className="text-sm font-medium">Visual Generation Failed</span>
             <span className="text-xs">Try regenerating this scene.</span>
           </div>
        )}

        {/* Video Generation Spinner Overlay */}
        {currentScene?.isGeneratingVideo && (
           <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm z-30 gap-2">
              <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
              <span className="text-xs font-semibold text-white tracking-wide shadow-sm">ANIMATING SCENE...</span>
           </div>
        )}

        {/* Subtitles Overlay */}
        <div className="absolute bottom-12 left-0 right-0 px-6 text-center z-40 pointer-events-none">
          <span className="inline-block bg-black/60 backdrop-blur-sm text-white px-3 py-1.5 rounded-lg text-lg font-medium leading-relaxed shadow-lg transition-all duration-300">
            {currentScene?.narration}
          </span>
        </div>

        {/* Progress Bar (Per Scene) */}
        <div className="absolute bottom-0 left-0 w-full h-1.5 bg-gray-800 z-50">
          <div 
            className="h-full bg-blue-500 transition-all duration-100 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>
        
        {/* Scene Indicator */}
        <div className="absolute top-4 right-4 bg-black/40 px-2 py-1 rounded text-xs text-white/80 font-mono z-50">
          SCENE {currentSceneIndex + 1}/{scenes.length}
        </div>
        
        {/* Export Overlay (Blocks Viewport) */}
        {(isExporting || isExportingFull) && (
           <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md z-[60] gap-4">
              <Loader2 className="w-10 h-10 text-green-500 animate-spin" />
              <div className="text-center">
                <span className="text-lg font-bold text-white block">Rendering Video...</span>
                <span className="text-sm text-gray-400">
                  {isExportingFull ? "Stitching all scenes together..." : "Processing scene..."}
                </span>
              </div>
           </div>
        )}
      </div>

      {/* Controls */}
      <div className="mt-6 flex flex-col md:flex-row items-center justify-between w-full max-w-[700px] px-4 gap-4">
        {/* Left Actions: Download Options */}
        <div className="flex items-center gap-2 order-2 md:order-1">
          {/* Current Scene Download */}
          <button
            onClick={handleDownload}
            disabled={isExporting || isExportingFull || shareState === 'generating'}
            className="group flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition disabled:opacity-50 border border-slate-700"
            title="Download Current Scene Only"
          >
            <Download size={16} />
            <span className="text-xs font-semibold hidden sm:inline group-hover:text-blue-300">Scene</span>
          </button>
          
          {/* Download Full Movie Button - Primary Action */}
          {onExportFull && (
             <button
              onClick={onExportFull}
              disabled={isExporting || isExportingFull || scenes.length === 0 || shareState === 'generating'}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/30 transition disabled:opacity-50 border border-indigo-500/50"
              title="Download Full Movie (All Scenes Stitched)"
             >
               <Film size={16} />
               <span className="text-xs font-semibold">Full Movie</span>
             </button>
          )}
        </div>

        {/* Playback Controls */}
        <div className="flex items-center gap-6 order-1 md:order-2">
          <button 
            onClick={() => skip('prev')}
            disabled={currentSceneIndex === 0 || isExporting || isExportingFull}
            className="p-3 rounded-full hover:bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 transition"
          >
            <SkipBack size={24} />
          </button>

          <button 
            onClick={togglePlay}
            disabled={isExporting || isExportingFull}
            className="p-4 rounded-full bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20 transition transform active:scale-95 flex items-center justify-center disabled:bg-blue-800 disabled:opacity-50"
          >
            {currentScene?.isRegeneratingAudio ? (
              <Loader2 size={28} className="animate-spin text-white/70" />
            ) : (
              isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" className="ml-1" />
            )}
          </button>

          <button 
            onClick={() => skip('next')}
            disabled={currentSceneIndex === scenes.length - 1 || isExporting || isExportingFull}
            className="p-3 rounded-full hover:bg-gray-800 text-gray-400 hover:text-white disabled:opacity-30 transition"
          >
            <SkipForward size={24} />
          </button>
        </div>

        {/* Right Actions */}
        <div className="flex items-center justify-end order-3">
          <button
            onClick={handleShareClick}
            disabled={(isExporting && shareState !== 'generating') || isExportingFull || (shareState === 'generating')}
            className={`p-3 rounded-full transition disabled:opacity-50 flex items-center gap-2 
              ${shareState === 'ready' 
                ? 'bg-green-600 text-white hover:bg-green-500 shadow-lg shadow-green-900/30 animate-pulse px-4' 
                : 'hover:bg-gray-800 text-gray-400 hover:text-green-400'
              }`}
            title={shareState === 'ready' ? "Tap to Share Now" : "Share Scene"}
          >
            {shareState === 'generating' ? (
              <Loader2 size={20} className="animate-spin text-green-400" />
            ) : shareState === 'ready' ? (
              <>
                <Share2 size={18} />
                <span className="text-sm font-bold">Share Now</span>
              </>
            ) : (
              <Share2 size={20} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
