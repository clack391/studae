import * as Speech from 'expo-speech';

type Cbs = {
  onDone?: () => void;
  onStopped?: () => void;
  onError?: (e: unknown) => void;
};

export function speakLesson(text: string, cbs: Cbs = {}) {
  Speech.speak(text, {
    onDone: cbs.onDone,
    onStopped: cbs.onStopped,
    onError: cbs.onError,
  });
}

export function stopSpeaking() {
  Speech.stop();
}
