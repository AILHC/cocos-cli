export default function meshoptWasmFactory(): Record<string, unknown> {
  const error = new Error('meshopt WASM artifact boundary is not wired for this probe. Add a real engine artifact mapping before loading meshopt assets.');
  return {
    ready: () => Promise.reject(error),
    supported: false,
    useWorkers: false,
  };
}
