/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, ChangeEvent } from 'react';

// Declare Puter global for TypeScript
declare global {
  interface Window {
    puter: any;
  }
}

type Message = {
  role: 'user' | 'assistant';
  content: string | any[];
  files?: string[];
  isThinking?: boolean;
};

type Toast = {
  id: number;
  msg: string;
  type: 'success' | 'error' | 'info' | 'warning';
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [currentModel, setCurrentModel] = useState('gpt-4o-mini');
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [attachedPaths, setAttachedPaths] = useState<string[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [inputText, setInputText] = useState('');
  const [isPuterReady, setIsPuterReady] = useState(false);

  const chatWindowRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 1. Video Fade Logic
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let fadeStart: number | null = null;
    let fadeOutStart: number | null = null;
    let frameId: number;

    const fadeLoop = (timestamp: number) => {
      if (!video) return;

      const duration = video.duration;
      const currentTime = video.currentTime;

      // Fade In (first 0.5s)
      if (currentTime < 0.5) {
        video.style.opacity = (currentTime / 0.5).toString();
      } 
      // Fade Out (last 0.5s)
      else if (currentTime > duration - 0.5) {
        video.style.opacity = ((duration - currentTime) / 0.5).toString();
      } 
      // Full opacity in between
      else {
        video.style.opacity = '1';
      }

      frameId = requestAnimationFrame(fadeLoop);
    };

    const handleEnded = () => {
      video.style.opacity = '0';
      setTimeout(() => {
        video.currentTime = 0;
        video.play();
      }, 100);
    };

    video.addEventListener('ended', handleEnded);
    video.style.opacity = '0';
    video.play();
    frameId = requestAnimationFrame(fadeLoop);

    return () => {
      video.removeEventListener('ended', handleEnded);
      cancelAnimationFrame(frameId);
    };
  }, []);

  // 2. Puter Init & Model Loading
  useEffect(() => {
    const checkPuter = setInterval(() => {
      if (window.puter) {
        setIsPuterReady(true);
        clearInterval(checkPuter);
        loadModels();
      }
    }, 100);
    return () => clearInterval(checkPuter);
  }, []);

  const loadModels = async () => {
    try {
      const availableModels = await window.puter.ai.listModels();
      const popular = ['gpt-4o-mini', 'gpt-4o', 'claude-sonnet-4-5', 'gemini-2.5-flash-lite', 'claude-opus-4-5'];
      availableModels.sort((a: any, b: any) => {
        const ai = popular.indexOf(a.id), bi = popular.indexOf(b.id);
        if (ai > -1 && bi > -1) return ai - bi;
        if (ai > -1) return -1;
        if (bi > -1) return 1;
        return (a.name || a.id).localeCompare(b.name || b.id);
      });
      setModels(availableModels);
      if (availableModels.length > 0) {
        const defaultModel = availableModels.find((m: any) => m.id === 'gpt-4o-mini') || availableModels[0];
        setCurrentModel(defaultModel.id);
      }
      addToast('✦ Models ready', 'success');
    } catch (e) {
      setModels([{ id: 'gpt-4o-mini', name: 'GPT-4o Mini' }]);
      addToast('Could not fetch model list', 'warning');
    }
  };

  // 3. UI Helpers
  const addToast = (msg: string, type: Toast['type'] = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, msg, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3250);
  };

  const autoResize = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px';
    }
  };

  useEffect(() => {
    if (chatWindowRef.current) {
      chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  // 4. Chat Logic
  const sendMessage = async (textOverride?: string) => {
    const text = (textOverride || inputText).trim();
    if ((!text && attachedPaths.length === 0) || isStreaming) return;

    setInputText('');
    if (textareaRef.current) textareaRef.current.style.height = '24px';
    
    const currentFiles = [...attachedPaths];
    setAttachedPaths([]);

    const newUserMsg: Message = { role: 'user', content: text, files: currentFiles };
    setMessages(prev => [...prev, newUserMsg]);

    let content: any = text;
    if (currentFiles.length > 0) {
      content = [{ type: 'text', text: text || 'Analyse these files.' }];
      currentFiles.forEach(p => content.push({ type: 'file', puter_path: p }));
    }

    setIsStreaming(true);
    const thinkingMsg: Message = { role: 'assistant', content: '', isThinking: true };
    setMessages(prev => [...prev, thinkingMsg]);

    try {
      const history = messages.map(m => ({ 
        role: m.role, 
        content: typeof m.content === 'string' ? m.content : m.content[0].text 
      }));
      history.push({ role: 'user', content: text || 'Analyse these files.' });
      
      const stream = await window.puter.ai.chat(history.slice(-22), { model: currentModel, stream: true });

      // Remove thinking message
      setMessages(prev => prev.filter(m => !m.isThinking));

      let fullText = '';
      const assistantMsg: Message = { role: 'assistant', content: '' };
      setMessages(prev => [...prev, assistantMsg]);

      for await (const chunk of stream) {
        if (chunk?.text) {
          fullText += chunk.text;
          setMessages(prev => {
            const next = [...prev];
            next[next.length - 1] = { ...next[next.length - 1], content: fullText };
            return next;
          });
        }
        // Handle images if any
      }

      if (isVoiceMode && fullText) await speakText(fullText);

    } catch (e: any) {
      setMessages(prev => prev.filter(m => !m.isThinking));
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ **Error:** ' + (e.message || 'Something went wrong.') }]);
      addToast(e.message || 'AI error', 'error');
    } finally {
      setIsStreaming(false);
    }
  };

  // 5. Features (Files, OCR, STT, TTS)
  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    addToast('Uploading...', 'info');
    try {
      const uploaded = await window.puter.fs.upload(files);
      const arr = Array.isArray(uploaded) ? uploaded : [uploaded];
      setAttachedPaths(prev => [...prev, ...arr.map(f => f.path)]);
      addToast(`${arr.length} file(s) attached ✦`, 'success');
    } catch (err: any) {
      addToast('Upload failed: ' + err.message, 'error');
    } finally {
      e.target.value = '';
    }
  };

  const handleOCR = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    addToast('Reading image…', 'info');
    try {
      const result = await window.puter.ai.img2txt(file);
      if (result) {
        setInputText(prev => (prev ? prev + '\n\n' : '') + result);
        setTimeout(autoResize, 0);
        addToast('Text extracted successfully!', 'success');
      } else {
        addToast('No text detected in image', 'warning');
      }
    } catch (err: any) {
      addToast('OCR failed: ' + err.message, 'error');
    } finally {
      e.target.value = '';
    }
  };

  const toggleSTT = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = e => audioChunksRef.current.push(e.data);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        addToast('Transcribing...', 'info');
        try {
          const result = await window.puter.ai.speech2txt(blob);
          const txt = typeof result === 'string' ? result : (result?.text || '');
          if (txt) {
            setInputText(txt);
            addToast('Voice captured!', 'success');
            if (isVoiceMode) sendMessage(txt);
          }
        } catch (err: any) {
          addToast('STT failed: ' + err.message, 'error');
        } finally {
          setIsRecording(false);
          stream.getTracks().forEach(t => t.stop());
        }
      };
      mediaRecorder.start();
      setIsRecording(true);
      addToast('Listening… tap mic again to stop', 'info');
    } catch {
      addToast('Microphone access denied', 'error');
    }
  };

  const speakText = async (text: string) => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    const clean = text.replace(/[#*`>_~\[\]]/g, '').substring(0, 2800);
    try {
      const audio = await window.puter.ai.txt2speech(clean, {
        provider: 'openai', voice: 'nova', model: 'gpt-4o-mini-tts'
      });
      audioRef.current = audio;
      audio.play();
    } catch (e: any) {
      addToast('TTS issue: ' + e.message, 'warning');
    }
  };

  const formatMarkdown = (text: string) => {
    if (!text) return { __html: '' };
    const html = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/^### (.+)$/gm, '<div class="head3">$1</div>')
      .replace(/^## (.+)$/gm, '<div class="head2">$1</div>')
      .replace(/^# (.+)$/gm, '<div class="head1">$1</div>')
      .replace(/^[-•] (.+)$/gm, '<div class="list-item">• $1</div>')
      .replace(/^(\d+)\. (.+)$/gm, '<div class="list-item">$1. $2</div>')
      .replace(/\n/g, '<br>');
    return { __html: html };
  };

  return (
    <>
      <video 
        ref={videoRef}
        className="bg-video" 
        src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_065045_c44942da-53c6-4804-b734-f9e07fc22e08.mp4"
        muted
        playsInline
      />
      <div className="blurred-overlay" />

      <div id="toast-area">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>
        ))}
      </div>

      <div id="app">
        <header>
          <div className="brand">
            <div className="brand-icon">✦</div>
            <div>
              <div className="brand-name">dkap assists</div>
              <div className="brand-sub">Powered by Puter AI</div>
            </div>
          </div>
          <div className="header-right">
            <div className="status-badge">
              <span className="status-dot"></span>
              <span> Online</span>
            </div>
            <div className="model-wrap">
              <select 
                id="model-selector" 
                value={currentModel} 
                onChange={(e) => setCurrentModel(e.target.value)}
              >
                {models.length === 0 ? (
                  <option value="">Loading…</option>
                ) : (
                  models.map(m => (
                    <option key={m.id} value={m.id}>
                      {(m.name || m.id) + (m.provider ? ` · ${m.provider}` : '')}
                    </option>
                  ))
                )}
              </select>
            </div>
            <button 
              id="voice-mode-btn" 
              className={isVoiceMode ? 'active' : ''}
              onClick={() => {
                setIsVoiceMode(!isVoiceMode);
                if (isVoiceMode && audioRef.current) audioRef.current.pause();
                addToast(isVoiceMode ? 'Voice Mode OFF' : 'Voice Mode ON ✦', isVoiceMode ? 'info' : 'success');
              }}
            >
              <span id="voice-icon">{isVoiceMode ? '🔊' : '🎙️'}</span>
              <span id="voice-label">{isVoiceMode ? 'Voice ON' : 'Voice Mode'}</span>
            </button>
          </div>
        </header>

        <div id="chat-window" ref={chatWindowRef}>
          {messages.length === 0 && (
            <div className="welcome-card">
              <div className="welcome-icon">✦</div>
              <h2>Hey, I'm DKAP Assists!</h2>
              <p>Your vibrant AI companion — chat, analyse files, extract text from images, and even talk with me using Voice Mode.</p>
              <div className="chips">
                {[
                  { label: "✨ What can you do?", prompt: "What can you do for me?" },
                  { label: "🌌 Write a poem", prompt: "Write me a short poem about the cosmos." },
                  { label: "💡 Startup ideas", prompt: "Give me 5 creative startup ideas for 2025." },
                  { label: "⚛️ Explain quantum", prompt: "Explain quantum computing in simple terms." },
                  { label: "✉️ Draft an email", prompt: "Help me write a professional email to reschedule a meeting." },
                  { label: "🚀 Productivity tips", prompt: "What are some tips to improve my productivity?" }
                ].map((chip, idx) => (
                  <div 
                    key={idx} 
                    className="chip" 
                    onClick={() => sendMessage(chip.prompt)}
                  >
                    {chip.label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`msg-row ${msg.role === 'user' ? 'user' : 'ai'}`}>
              <div className={`avatar ${msg.role === 'assistant' ? 'ai-av' : 'user-av'}`}>
                {msg.role === 'assistant' ? '✦' : '✿'}
              </div>
              <div className="bubble">
                {msg.isThinking ? (
                  <div className="typing-dots"><span></span><span></span><span></span></div>
                ) : (
                  <>
                    <div className="bubble-content" dangerouslySetInnerHTML={formatMarkdown(msg.content as string)} />
                    {msg.files && msg.files.length > 0 && (
                      <div className="msg-attachments">
                        {msg.files.map((p, idx) => (
                          <span key={idx} className="att-chip">📄 {p.split('/').pop()}</span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <footer>
          <div id="file-previews">
            {attachedPaths.map((path, i) => (
              <div key={i} className="preview-item">
                <span>📄 {path.split('/').pop()}</span>
                <span className="remove" onClick={() => setAttachedPaths(prev => prev.filter((_, idx) => idx !== i))}>×</span>
              </div>
            ))}
          </div>
          <div className="input-shell">
            <input 
              type="file" 
              id="general-file-input" 
              multiple 
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <input 
              type="file" 
              id="image-ocr-input" 
              accept="image/*" 
              onChange={handleOCR}
              style={{ display: 'none' }}
            />
            <textarea 
              ref={textareaRef}
              id="user-input" 
              placeholder="Message DKAP Assists…" 
              rows={1}
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                autoResize();
              }}
              onKeyDown={(e) => {
                const isMobile = window.matchMedia('(max-width: 768px)').matches;
                if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
            />
            <div className="action-strip">
              <button 
                className="act-btn" 
                data-tip="Attach files"
                onClick={() => document.getElementById('general-file-input')?.click()}
              >📎</button>
              <button 
                className="act-btn" 
                data-tip="Image → Text (OCR)"
                onClick={() => document.getElementById('image-ocr-input')?.click()}
              >🖼️</button>
              <button 
                className={`act-btn ${isRecording ? 'active-rec' : ''}`} 
                data-tip="Speak to type"
                onClick={toggleSTT}
              >🎤</button>
              <div className="act-divider"></div>
              <button 
                id="send-btn" 
                data-tip="Send"
                onClick={() => sendMessage()}
                style={{ opacity: isStreaming ? 0.5 : 1 }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
          </div>
        </footer>
      </div>

      <style>{`
        .head3 { font-family: 'General Sans', sans-serif; font-weight: 700; color: var(--cyan-l); margin: 10px 0 4px; font-size: 1em; }
        .head2 { font-family: 'General Sans', sans-serif; font-weight: 700; color: var(--violet-l); margin: 12px 0 5px; font-size: 1.1em; }
        .head1 { font-family: 'General Sans', sans-serif; font-weight: 800; color: var(--pink-l); margin: 12px 0 6px; font-size: 1.2em; }
        .list-item { padding-left: 16px; margin: 2px 0; }
      `}</style>
    </>
  );
}
