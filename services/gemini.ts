
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { ScriptScene } from "../types";

// Helper to get client (avoids instantiating before env is ready in some envs)
const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key not found");
  return new GoogleGenAI({ apiKey });
};

// --- WAV Header Construction Helper ---
// Gemini TTS returns raw PCM (16-bit, 24kHz, Mono). We must add a WAV header for browsers to play it.
const createWavUrlFromPcm = (base64Pcm: string): string => {
  const binaryString = atob(base64Pcm);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // WAV Header parameters for Gemini Flash TTS
  const numChannels = 1;
  const sampleRate = 24000;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = bytes.length;
  const headerSize = 44;

  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true); // File size - 8
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Write PCM data
  const pcmData = new Uint8Array(buffer, headerSize);
  pcmData.set(bytes);

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
};

const writeString = (view: DataView, offset: number, string: string) => {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
};

const cleanJson = (text: string) => {
  return text.replace(/```json/g, '').replace(/```/g, '').trim();
};

export const generateScript = async (text: string, characterDesc?: string): Promise<ScriptScene[]> => {
  const ai = getAiClient();
  
  let prompt = `
    You are an expert video director. 
    Split the following text into 3 to 6 distinct video scenes.
    For each scene, provide:
    1. 'narration': The exact text the voiceover should read. Keep it natural.
    2. 'visual_prompt': A detailed image generation prompt describing the ACTION and ENVIRONMENT of the scene.
  `;

  if (characterDesc) {
    prompt += `
    CRITICAL INSTRUCTION: 
    The user has defined a specific character/style: "${characterDesc}".
    In your 'visual_prompt' outputs, DO NOT redefine the character's physical appearance (like hair color, clothes) unless it changes. 
    Focus the 'visual_prompt' on the pose, action, camera angle, and background elements. 
    Assume the image generator will append the character description automatically.
    `;
  } else {
     prompt += `
     - Ensure the visual description is safe for work and suitable for general audiences.
     - Include lighting, style (e.g., photorealistic, 4k), and subject details.
     `;
  }

  prompt += `
    Input Text: "${text}"
  `;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            narration: { type: Type.STRING },
            visual_prompt: { type: Type.STRING }
          },
          required: ["narration", "visual_prompt"]
        }
      }
    }
  });

  const rawText = response.text;
  if (!rawText) throw new Error("No script generated");
  
  try {
    return JSON.parse(cleanJson(rawText)) as ScriptScene[];
  } catch (e) {
    console.error("Failed to parse script JSON:", rawText);
    throw new Error("Failed to parse script from AI response");
  }
};

export const generateImageForScene = async (prompt: string, aspectRatio: '9:16' | '16:9' | '1:1', characterDesc?: string): Promise<string> => {
  const ai = getAiClient();
  
  const finalPrompt = characterDesc 
    ? `Character/Style Reference: ${characterDesc}. \nScene Action: ${prompt}` 
    : prompt;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: finalPrompt }]
      },
      config: {
        imageConfig: {
          aspectRatio: aspectRatio,
        }
      }
    });

    const candidate = response.candidates?.[0];
    
    if (candidate?.finishReason === 'SAFETY') {
      throw new Error("Image generation blocked by safety filters.");
    }

    const parts = candidate?.content?.parts;
    
    if (!parts || parts.length === 0) {
      console.warn("Gemini Image Response Empty:", JSON.stringify(response, null, 2));
      throw new Error(`No image content returned. Reason: ${candidate?.finishReason || 'Unknown'}`);
    }

    let textRefusal = '';

    for (const part of parts) {
      if (part.inlineData && part.inlineData.data) {
        return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
      }
      if (part.text) {
        textRefusal += part.text;
      }
    }
    
    if (textRefusal) {
      throw new Error(`Model returned text instead of image: "${textRefusal.substring(0, 100)}..."`);
    }

    throw new Error("Image generation successful but no inline data found.");

  } catch (error: any) {
    throw new Error(`Image Gen Error: ${error.message}`);
  }
};

export const generateSpeechForScene = async (text: string, voiceName: string = 'Kore'): Promise<string> => {
  const ai = getAiClient();

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName }
          }
        }
      }
    });

    const parts = response.candidates?.[0]?.content?.parts;
    if (!parts) throw new Error("No audio content returned");

    const audioPart = parts[0];
    if (audioPart.inlineData && audioPart.inlineData.data) {
      // The API returns raw PCM data (no header). We must wrap it in WAV to play in browser.
      return createWavUrlFromPcm(audioPart.inlineData.data);
    }

    throw new Error("Speech generation failed.");
  } catch (error: any) {
    throw new Error(`Speech Gen Error: ${error.message}`);
  }
};

export const generateVideoFromImage = async (
  imageBase64: string, 
  prompt: string,
  aspectRatio: '9:16' | '16:9' | '1:1'
): Promise<string> => {
  // 1. Check if user has selected an API key (Veo Requirement)
  const hasKey = await window.aistudio.hasSelectedApiKey();
  if (!hasKey) {
    throw new Error("API_KEY_REQUIRED");
  }

  // 2. Instantiate new client to ensure it picks up the selected key
  const ai = getAiClient();

  // Strip data:image/png;base64, prefix for the API
  const base64Data = imageBase64.split(',')[1];
  const mimeType = imageBase64.substring(imageBase64.indexOf(':') + 1, imageBase64.indexOf(';'));

  try {
    let operation = await ai.models.generateVideos({
      model: 'veo-3.1-fast-generate-preview',
      prompt: prompt,
      image: {
        imageBytes: base64Data,
        mimeType: mimeType,
      },
      config: {
        numberOfVideos: 1,
        // Veo fast only supports 16:9 or 9:16. 1:1 needs to map to one of them or default
        aspectRatio: aspectRatio === '1:1' ? '16:9' : aspectRatio,
        resolution: '720p'
      }
    });

    // 3. Poll for completion
    while (!operation.done) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Poll every 1s (reduced from 5s for speed)
      operation = await ai.operations.getVideosOperation({ operation: operation });
    }

    const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!videoUri) {
      throw new Error("Video generation completed but no URI returned.");
    }

    // 4. Fetch the video bytes using the API Key
    const response = await fetch(`${videoUri}&key=${process.env.API_KEY}`);
    if (!response.ok) {
      throw new Error(`Failed to download generated video. Status: ${response.status}`);
    }
    
    const blob = await response.blob();
    return URL.createObjectURL(blob);

  } catch (error: any) {
    throw new Error(`Video Gen Error: ${error.message}`);
  }
};
