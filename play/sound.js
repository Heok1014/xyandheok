let enabled = false, context;

export function soundEnabled() { return enabled; }
export function toggleSound() {
  enabled = !enabled;
  if (enabled) playSound('touch');
}

// Short synthesized notes require a user gesture; no audio files or autoplay.
export function playSound(kind = 'touch') {
  if (!enabled) return;
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    context ||= new Audio();
    if (context.state === 'suspended') context.resume().catch(() => {});
    const tones = kind === 'reward' ? [523, 659, 784] : kind === 'miss' ? [220] : [659, 880];
    tones.forEach((frequency, index) => {
      const start = context.currentTime + index * .075;
      const oscillator = context.createOscillator(), volume = context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      volume.gain.setValueAtTime(0, start); volume.gain.linearRampToValueAtTime(.045, start + .015);
      volume.gain.exponentialRampToValueAtTime(.001, start + .16);
      oscillator.connect(volume); volume.connect(context.destination);
      oscillator.start(start); oscillator.stop(start + .18);
    });
  } catch { /* Audio is optional when a browser or device blocks it. */ }
}
