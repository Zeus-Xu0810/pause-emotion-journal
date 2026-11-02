import { AUDIO_SETTINGS } from '../care-content';

export type CareSound = 'chords' | 'rain' | 'waves';

/** 控制器只在用户点击后创建；关闭上下文会同时释放全部音源与调制节点。 */
export interface CareAudioController {
  play: () => Promise<void>;
  pause: () => void;
  setVolume: (volume: number) => void;
  dispose: () => void;
}

/** 本地生成原创和弦、雨声与海浪，无网络请求或自动播放。 */
export function createCareAudio(sound: CareSound, initialVolume: number): CareAudioController {
  if (!window.AudioContext) throw new Error('当前浏览器暂不支持声音播放，请换用新版浏览器。');
  const context = new AudioContext();
  const master = context.createGain();
  const nodes: AudioNode[] = [master];
  let disposed = false;
  master.gain.value = Math.max(0, Math.min(1, initialVolume)) * AUDIO_SETTINGS.masterLevel;
  master.connect(context.destination);

  // 原创和弦采用四个持续音及轻微呼吸式音量变化，不引用现成歌曲。
  if (sound === 'chords') {
    AUDIO_SETTINGS.chordFrequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const voice = context.createGain();
      const drift = context.createOscillator();
      const depth = context.createGain();
      oscillator.type = index === 2 ? 'triangle' : 'sine';
      oscillator.frequency.value = frequency;
      oscillator.detune.value = index % 2 === 0 ? -3 : 3;
      voice.gain.value = AUDIO_SETTINGS.chordVoiceLevel;
      drift.frequency.value = 0.065 + index * 0.013;
      depth.gain.value = 0.025;
      drift.connect(depth);
      depth.connect(voice.gain);
      oscillator.connect(voice);
      voice.connect(master);
      oscillator.start();
      drift.start();
      nodes.push(oscillator, voice, drift, depth);
    });
  } else {
    // 噪声缓冲只生成一次并循环；海浪以低通滤波与低频调制模拟潮起潮落。
    const buffer = context.createBuffer(1, context.sampleRate * AUDIO_SETTINGS.bufferSeconds, context.sampleRate);
    const channel = buffer.getChannelData(0);
    let brown = 0;
    for (let index = 0; index < channel.length; index += 1) {
      const white = Math.random() * 2 - 1;
      brown = (brown + 0.035 * white) / 1.035;
      channel[index] = sound === 'rain' ? white * 0.7 : brown * 4;
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const level = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    filter.type = 'lowpass';
    filter.frequency.value = sound === 'rain' ? AUDIO_SETTINGS.rainLowpassHz : AUDIO_SETTINGS.waveLowpassHz;
    level.gain.value = sound === 'rain' ? 0.6 : 0.55;
    source.connect(filter);
    filter.connect(level);
    level.connect(master);
    source.start();
    nodes.push(source, filter, level);
    if (sound === 'waves') {
      const swell = context.createOscillator();
      const depth = context.createGain();
      swell.frequency.value = 0.095;
      depth.gain.value = 0.4;
      swell.connect(depth);
      depth.connect(level.gain);
      swell.start();
      nodes.push(swell, depth);
    }
  }

  // suspend 保持音频播放位置；dispose 幂等，支持路由卸载与严格模式清理。
  return {
    async play() {
      if (disposed) throw new Error('声音已结束，请重新开始。');
      await context.resume();
    },
    pause() {
      if (!disposed && context.state === 'running') void context.suspend().catch(() => undefined);
    },
    setVolume(volume) {
      if (!disposed) master.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)) * AUDIO_SETTINGS.masterLevel, context.currentTime, 0.06);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      nodes.forEach((node) => node.disconnect());
      void context.close().catch(() => undefined);
    },
  };
}
