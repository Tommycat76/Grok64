import { toast } from "sonner";
import { glog } from "./debug";

export function mountErrorStack(err: unknown, maxLines = 40): string | undefined {
  if (!(err instanceof Error) || !err.stack) return undefined;
  return err.stack.split("\n").slice(0, maxLines).join("\n");
}

export class MountStageTimeoutError extends Error {
  readonly stage: string;
  constructor(stage: string, timeoutMs: number) {
    super(`Mount stalled at “${stage}” (${timeoutMs}ms)`);
    this.name = "MountStageTimeoutError";
    this.stage = stage;
  }
}

export async function runMountStage<T>(
  stage: string,
  fn: () => Promise<T>,
  timeoutMs = 45_000,
): Promise<T> {
  glog("mount-stage", { stage, phase: "start" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const out = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new MountStageTimeoutError(stage, timeoutMs)), timeoutMs);
      }),
    ]);
    glog("mount-stage", { stage, phase: "ok" });
    return out;
  } catch (err) {
    glog("mount-stage", {
      stage,
      phase: "fail",
      err: String(err instanceof Error ? err.message : err),
      stack: mountErrorStack(err),
    });
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function reportMountFailure(stage: string, err: unknown, detail?: Record<string, unknown>) {
  const msg =
    err instanceof MountStageTimeoutError
      ? err.message
      : `Mount failed at “${stage}”: ${err instanceof Error ? err.message : String(err)}`;
  glog("mount-fail", {
    stage,
    ...detail,
    err: String(err instanceof Error ? err.message : err),
    stack: mountErrorStack(err),
  });
  toast.error(msg, { duration: 12_000 });
}
