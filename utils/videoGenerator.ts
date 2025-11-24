
import { GeneratedScene } from '../types';

const getDimensions = (aspectRatio: string) => {
  switch (aspectRatio) {
    case '16:9': return { width: 1280, height: 720 };
    case '9:16': return { width: 720, height: 1280 };
    case '1:1': default: return { width: 1080, height: 1080 };
  }
};

const loadAudio = async (ctx: AudioContext, url: string): Promise<AudioBuffer> => {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuffer);
};

const loadImage = (url: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
};

const loadVideo = (url: string): Promise<HTMLVideoElement> => {
  return new Promise((resolve, reject) => {
    const vid = document.createElement('video');
    vid.crossOrigin = "anonymous";
    vid.muted = true; // Essential for autoplaying in background
    vid.src = url;
    vid.onloadedmetadata = () => resolve(vid);
    vid.onerror = reject;
  });
};

// Helper to draw image cover style
const drawCover = (ctx: CanvasRenderingContext2D, img: HTMLImageElement | HTMLVideoElement, width: number, height: number) => {
  const imgW = (img as HTMLVideoElement).videoWidth || (img as HTMLImageElement).width;
  const imgH = (img as HTMLVideoElement).videoHeight || (img as HTMLImageElement).height;
  
  const ratio = Math.max(width / imgW, height / imgH);
  const newW = imgW * ratio;
  const newH = imgH * ratio;
  const offX = (width - newW) / 2;
  const offY = (height - newH) / 2;
  
  ctx.drawImage(img, offX, offY, newW, newH);
};

// Helper to draw rounded rectangle
const roundRectPath = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

// Helper to draw subtitles
const drawSubtitles = (
  ctx: CanvasRenderingContext2D, 
  text: string, 
  width: number, 
  height: number
) => {
  if (!text) return;

  // Configuration - Simple & Unobtrusive
  // Significantly smaller font (2.5% of width) to avoid blocking characters
  const fontSize = Math.max(14, Math.floor(width * 0.025)); 
  const lineHeight = fontSize * 1.4;
  const paddingX = fontSize * 0.8;
  const paddingY = fontSize * 0.4;
  
  // Position very close to bottom (3% margin)
  const bottomMargin = Math.max(20, height * 0.03); 
  
  // Wider max width (90%) to keep text lines fewer and box shorter
  const maxWidth = width * 0.9;

  ctx.font = `600 ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Word Wrap
  const words = text.split(' ');
  let line = '';
  const lines: string[] = [];

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;
    
    if (testWidth > maxWidth && n > 0) {
      lines.push(line);
      line = words[n] + ' ';
    } else {
      line = testLine;
    }
  }
  lines.push(line);

  // Calculate Box Dimensions
  const totalTextHeight = lines.length * lineHeight;
  const boxHeight = totalTextHeight + (paddingY * 2); 
  
  // Find widest line
  let maxLineWidth = 0;
  lines.forEach(l => {
    const w = ctx.measureText(l).width;
    if (w > maxLineWidth) maxLineWidth = w;
  });
  const boxWidth = maxLineWidth + (paddingX * 2);

  const boxX = (width - boxWidth) / 2;
  const boxY = height - bottomMargin - boxHeight;

  // Draw Background - More transparent black for visibility behind
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'; 
  roundRectPath(ctx, boxX, boxY, boxWidth, boxHeight, 6);
  ctx.fill();

  // Draw Text
  ctx.fillStyle = '#ffffff';
  // Subtle shadow
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;
  
  // Calculate starting Y position
  const textStartY = boxY + paddingY + (lineHeight / 2);

  for (let i = 0; i < lines.length; i++) {
    const yPos = textStartY + (i * lineHeight) - (lineHeight * 0.1); // Slight optical adjustment
    ctx.fillText(lines[i].trim(), width / 2, yPos);
  }
  
  ctx.restore();
};

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export async function generateVideo(
  scenes: GeneratedScene[], 
  aspectRatio: string,
  onProgress?: (msg: string) => void
): Promise<Blob> {
  const { width, height } = getDimensions(aspectRatio);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) throw new Error("Could not get canvas context");

  // Initialize canvas with black background to ensure video track is active
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  // Setup Audio
  const Actx = (window.AudioContext || (window as any).webkitAudioContext);
  const actx = new Actx();
  const dest = actx.createMediaStreamDestination();

  // Fix: Ensure AudioContext is running (it often starts suspended)
  if (actx.state === 'suspended') {
    await actx.resume();
  }
  
  // Setup Stream
  const canvasStream = canvas.captureStream(30); 
  // Ensure we get the audio track from the destination
  const audioTracks = dest.stream.getAudioTracks();
  
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioTracks
  ]);

  // Determine best supported mime type
  // Prioritize WebM for Chrome/FF as MP4 recording can be unstable/silent in some versions.
  // Safari will fall back to MP4 automatically as it supports it but not WebM.
  const mimeTypes = [
    'video/webm;codecs=vp9,opus',
    'video/webm',
    'video/mp4'
  ];
  
  let selectedMimeType = 'video/webm';
  for (const type of mimeTypes) {
    if (MediaRecorder.isTypeSupported(type)) {
      selectedMimeType = type;
      break;
    }
  }

  const recorder = new MediaRecorder(combinedStream, { 
    mimeType: selectedMimeType, 
    videoBitsPerSecond: 5000000,
    audioBitsPerSecond: 128000 // Explicitly request audio bandwidth
  });
  
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const recordingPromise = new Promise<Blob>((resolve) => {
    recorder.onstop = async () => {
      // Clean up audio context only after recording stops to prevent corrupt files
      try {
        if (actx.state !== 'closed') {
           await actx.close();
        }
      } catch (e) { console.warn("Error closing audio context", e); }
      
      const blob = new Blob(chunks, { type: selectedMimeType });
      resolve(blob);
    };
  });

  recorder.start();

  // Playback Loop
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (onProgress) onProgress(`Rendering scene ${i + 1}/${scenes.length}...`);

    let visual: HTMLImageElement | HTMLVideoElement | null = null;
    let audioBuffer: AudioBuffer | null = null;

    try {
      if (scene.videoUrl) {
        visual = await loadVideo(scene.videoUrl);
      } else if (scene.imageUrl) {
        visual = await loadImage(scene.imageUrl);
      }

      if (scene.audioUrl) {
        audioBuffer = await loadAudio(actx, scene.audioUrl);
      }
    } catch (e) {
      console.error(`Error loading assets for scene ${i}`, e);
      continue; // Skip broken scenes
    }

    if (!visual) continue;

    const duration = (audioBuffer?.duration || 5) + 0.5; // +0.5s padding
    
    let sourceNode: AudioBufferSourceNode | null = null;
    if (audioBuffer) {
      sourceNode = actx.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.connect(dest);
      // Use current time to schedule immediate playback relative to loop
      sourceNode.start(actx.currentTime);
    }

    if (visual instanceof HTMLVideoElement) {
        visual.currentTime = 0;
        visual.loop = true;
        await visual.play();
    }

    const startTime = performance.now();
    
    // Render Frame Loop for this Scene
    await new Promise<void>(resolve => {
      const render = () => {
        const now = performance.now();
        const elapsed = (now - startTime) / 1000;

        if (elapsed >= duration) {
          resolve();
          return;
        }

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);

        if (visual) {
           drawCover(ctx, visual, width, height);
        }
        
        // Draw Subtitles Overlay
        if (scene.narration) {
          drawSubtitles(ctx, scene.narration, width, height);
        }
        
        requestAnimationFrame(render);
      };
      render();
    });

    if (sourceNode) {
        try { sourceNode.stop(); } catch {}
    }
    if (visual instanceof HTMLVideoElement) {
        visual.pause();
    }
  }

  if (recorder.state === 'recording') {
    recorder.stop();
  }

  return recordingPromise;
}
