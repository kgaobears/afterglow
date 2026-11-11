// One WebGPU engine is shared by normal extraction, manual regression tests,
// and remotely queued regression tests in this browser tab. Never run them
// simultaneously: model switching can terminate the other task's worker.
type Activity = "gathering" | "manual-regression" | "remote-regression";
let active: Activity | null = null;

export function acquireLocalModel(owner: Activity): boolean {
  if (active !== null) return false;
  active = owner;
  return true;
}
export function releaseLocalModel(owner: Activity) {
  if (active === owner) active = null;
}
export function currentLocalModelActivity() { return active; }
