import { create } from 'zustand';

/** 新手引导类型：guest = 未登录首次打开（看图谱 + 引导登录/反馈）；user = 登录后（学习路线 + 助手 + 划词注解） */
export type TourType = 'guest' | 'user';

const KEYS: Record<TourType, string> = {
  guest: 'llm_learn_tour_guest',
  user: 'llm_learn_tour_user',
};

/** 是否已完成过某段引导（完成或中途关闭都算看过，不再自动播放） */
export function isTourDone(type: TourType): boolean {
  try { return localStorage.getItem(KEYS[type]) === '1'; } catch { return false; }
}

export function markTourDone(type: TourType) {
  try { localStorage.setItem(KEYS[type], '1'); } catch { /* 忽略隐私模式等写入失败 */ }
}

type TourState = {
  /** 当前播放的引导；null = 未播放 */
  type: TourType | null;
  /** 当前步（受控） */
  step: number;
  start: (type: TourType) => void;
  setStep: (i: number) => void;
  close: () => void;
};

export const useTour = create<TourState>((set) => ({
  type: null,
  step: 0,
  start: (type) => set({ type, step: 0 }),
  setStep: (step) => set({ step }),
  close: () => {
    set((s) => {
      if (s.type) markTourDone(s.type);
      return { type: null, step: 0 };
    });
  },
}));
