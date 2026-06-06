class EmptyInputSource {
  public on(): void {}
  public off(): void {}
  public _on(): void {}
  public _off(): void {}
}

export class TouchInputSource extends EmptyInputSource {}
export class MouseInputSource extends EmptyInputSource {}
export class KeyboardInputSource extends EmptyInputSource {}
export class AccelerometerInputSource extends EmptyInputSource {}

export class GamepadInputDevice extends EmptyInputSource {
  public static _init(): void {}
  public static _on(): void {}
  public static _off(): void {}
}

export class HandleInputDevice extends EmptyInputSource {}
export class HMDInputDevice extends EmptyInputSource {}
export class HandheldInputDevice extends EmptyInputSource {}
