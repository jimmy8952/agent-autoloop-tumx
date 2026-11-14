// 桌面通知：P1 只在 macOS，别的平台静默跳过（代码路径不因通知失败而断）。
import { spawnSync } from "node:child_process";

export function notify(title: string, body: string) {
  if (process.platform !== "darwin") return;
  const safe = (text: string) => text.replace(/[\\"]/g, "'").replace(/\n/g, " ");
  spawnSync("osascript", ["-e", `display notification "${safe(body)}" with title "${safe(title)}"`], { timeout: 10_000 });
}
