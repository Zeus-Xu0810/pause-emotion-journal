import type { PetActivity, PetEvent, PetInput, PetResponse, PetTargets } from './pet-care';
import type { MoodScore } from '../types';
import type { MascotReply } from '../mascot-content';

/** 舞台坐标统一为[-1,1]，x向右、y向下；模型局部坐标的y向上。 */
export interface MascotPoint { x: number; y: number }
export type MascotRegion = 'head' | 'cheek-left' | 'cheek-right' | 'belly' | 'hand-left' | 'hand-right' | 'body';
export type MascotGesture = 'poke' | 'pinch' | 'drag' | 'pat' | 'tickle' | 'wave' | 'bounce' | 'shake';
export type MascotMode = 'auto' | 'poke' | 'pinch' | 'drag' | 'pat' | 'tickle';
export interface MascotHit { region: MascotRegion; local: { x: number; y: number; z: number } }
/** dx/dy为按下位置到当前位置的舞台坐标差，pinchScale为双指间距比。 */
export interface MascotManipulation { kind: MascotGesture; hit: MascotHit; dx: number; dy: number; strength: number; pinchScale?: number }
export interface MascotBounds { left: number; top: number; width: number; height: number }
/** 渲染层只消费交互意图，不访问日记状态或保存接口。 */
export interface MascotSceneController {
  setMood: (mood: MoodScore | null) => void;
  play: (reply: MascotReply) => void;
  look: (x: number, y: number) => void;
  hitTest: (x: number, y: number) => MascotHit | null;
  manipulate: (value: MascotManipulation | null) => void;
  react: (kind: MascotGesture, hit?: MascotHit) => void;
  setPetActivity: (activity: PetActivity | null) => void;
  petInput: (input: PetInput) => void;
  petRespond: (response: PetResponse | null) => void;
  dispose: () => void;
}
export interface MascotSceneOptions {
  mood: MoodScore | null;
  onReady: (ready: boolean) => void;
  onPetEvent?: (event: PetEvent) => void;
  onPetTargets?: (targets: PetTargets) => void;
  /** 包围框用host内CSS像素，允许HTML触控区跟随模型；不逐帧触发React重渲染。 */
  onBounds: (bounds: MascotBounds) => void;
}
