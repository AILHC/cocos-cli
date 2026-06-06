export class Pacer {
  public onTick: (() => void) | null = null;
  public targetFrameRate = 60;

  public start(): void {}
  public stop(): void {}
}
