const error = new Error('meshopt ASM artifact boundary is not wired for this probe. Add a real engine artifact mapping before loading meshopt assets.');

export default {
  ready: Promise.reject(error),
  supported: false,
  useWorkers: false,
};
