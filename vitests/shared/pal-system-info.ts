import { BrowserType, Feature, Language, NetworkType, OS, Platform } from 'pal/system-info/enum-type';

export const systemInfo = {
  networkType: NetworkType.LAN,
  isNative: false,
  isBrowser: true,
  isMobile: false,
  isLittleEndian: true,
  platform: Platform.DESKTOP_BROWSER,
  language: Language.ENGLISH,
  nativeLanguage: 'en',
  os: OS.WINDOWS,
  osVersion: '',
  osMainVersion: 0,
  browserType: BrowserType.CHROME,
  browserVersion: '',
  isXR: false,
  hasFeature: (feature: Feature): boolean => {
    return feature === Feature.EVENT_MOUSE || feature === Feature.EVENT_KEYBOARD;
  },
  getBatteryLevel: (): number => 1,
  triggerGC: (): void => {},
  openURL: (): void => {},
  now: (): number => Date.now(),
  restartJSVM: (): void => {},
  close: (): void => {},
  exit: (): void => {},
  init: async (): Promise<void> => {},
  on: (): void => {},
  off: (): void => {},
};
