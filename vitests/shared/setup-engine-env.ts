import { TextDecoder, TextEncoder } from 'node:util';

Object.assign(globalThis, {
  TextDecoder,
  TextEncoder,
});

export function installNullCanvasContext(): void {
  if (typeof HTMLCanvasElement === 'undefined') {
    return;
  }
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return null;
  } as typeof HTMLCanvasElement.prototype.getContext;
}

installNullCanvasContext();
