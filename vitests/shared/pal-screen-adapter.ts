import { Orientation } from 'pal/screen-adapter/enum-type';

type SizeLike = { width: number; height: number };
type SafeAreaEdge = { top: number; bottom: number; left: number; right: number };

export const screenAdapter = {
  devicePixelRatio: 1,
  handleResizeEvent: false,
  isFrameRotated: false,
  isFullScreen: false,
  isProportionalToFrame: false,
  orientation: Orientation.PORTRAIT,
  resolution: { width: 0, height: 0 } as SizeLike,
  resolutionScale: 1,
  safeAreaEdge: { top: 0, bottom: 0, left: 0, right: 0 } as SafeAreaEdge,
  supportFullScreen: false,
  windowSize: { width: 0, height: 0 } as SizeLike,
  exitFullScreen: async (): Promise<void> => {},
  init: (_options: unknown, callback?: () => void): void => {
    callback?.();
  },
  off: (): void => {},
  on: (): void => {},
  once: (): void => {},
  requestFullScreen: async (): Promise<void> => {},
};
