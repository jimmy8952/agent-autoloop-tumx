// 桥接终态文本：readMessage 的首行语义就是全部协议（没跑成=自动重派），所以每张嘴都要过单测。
export type FinalKind = "done" | "done-no-receipt" | "launch-failed" | "dead" | "timeout" | "stopped";

export type FinalDetail = {
  /** agent 写的 receipt.md 全文（只有 done 用）。 */
  receipt?: string;
  /** 失败/中断的原因句。 */
  reason?: string;
  runDir: string;
  session: string;
  at?: string;
};

const notice = (first: string, title: string, text: string) =>
  `${first}\n\n\`\`\`agent-autoloop\n${JSON.stringify({ notice: [{ title, text }] }, null, 1)}\n\`\`\`\n`;

/** 桥接进程终态一次性打印的全部 stdout。改这里 = 改协议，tests/live-bridge.test.ts 是合同。 */
export function finalText(kind: FinalKind, detail: FinalDetail): string {
  const at = detail.at ?? new Date().toISOString();
  switch (kind) {
    case "done":
      // agent 的最后一条消息原样交接：首行结论、末尾回执块，都由它自己写。
      return `${(detail.receipt ?? "").trim()}\n`;
    case "done-no-receipt":
      // agent 打了 DONE 却没留下 receipt：轻异常，重跑合理。
      return `没跑成：live 会话写了 DONE 但 receipt.md 缺失或为空（${detail.runDir}/mailbox）\n`;
    case "launch-failed":
      // 任务尚未注入，重开零风险：这是唯一允许自动重派的注入后之外情形。
      return `没跑成：live 启动失败：${detail.reason ?? "原因不明"}（任务尚未注入，tmux 会话已清）\n`;
    case "dead":
      return notice(
        `live 会话异常中断（${at}）`,
        "live 会话异常中断",
        `tmux 会话消失了，活可能只干了一半。黑匣子在 ${detail.runDir}/live.log，哨兵状态在 ${detail.runDir}/state.json；确认后再决定是否重派。`,
      );
    case "timeout":
      return notice(
        `live 会话被中断（${at}，收到超时或取消信号）`,
        "live 会话超时中断",
        `这轮超过时限被哨兵中断，tmux 会话未杀：tmux attach -t ${detail.session} 可进去看进度、接着指挥；黑匣子在 ${detail.runDir}/live.log。`,
      );
    case "stopped":
      return `live 会话被人工停止（STOP）：${detail.runDir}\n`;
  }
}
