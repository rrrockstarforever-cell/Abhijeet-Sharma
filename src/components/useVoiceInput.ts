// Mic button logic shared by the chat boxes: records from the microphone, then transcribes on this
// machine with Whisper (see lib/speech.ts). Audio never leaves the app.
import { useRef, useState } from 'react';
import { transcribe } from '../lib/speech.ts';

export function useVoiceInput(onText: (text: string) => void) {
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Read at the moment the transcript arrives, so a re-render in between does not drop it.
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const toggle = async () => {
    if (recording) { recorderRef.current?.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setStatus('Voice input needs microphone access, which this window does not have.');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setStatus('Microphone permission was denied, or no microphone was found.');
      return;
    }
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      setRecording(false);
      setStatus('Transcribing…');
      try {
        const text = await transcribe(new Blob(chunksRef.current, { type: recorder.mimeType }), (m) => setStatus(m));
        if (text) onTextRef.current(text);
        setStatus(text ? null : 'Nothing was heard. Try again.');
      } catch (err: any) {
        setStatus(`Voice input failed: ${err?.message || err}`);
      }
    };
    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
    setStatus('Listening… click the mic again to stop.');
  };

  return { recording, status, toggle };
}
