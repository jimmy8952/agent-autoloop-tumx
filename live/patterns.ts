// 屏幕模式库：纯函数，特征提炼自真实抓屏（tests/fixtures/live/）。分不清的画面靠指纹稳定度兜底，别硬加正则。
const QUESTION_FOOTER = "Enter to select · ↑/↓ to navigate · Esc to cancel";

export function matchTrust(capture: string): boolean {
  return confirmKeys(capture) !== null;
}

/** “Enter to confirm”类确认框——信任弹窗、bypass 首次接受框，光标都默认停在否定项上：
 *  导航到含 Yes 的选项再 Enter。盲按数字或盲 Enter 会选成 "No, exit" 直接退出。 */
export function confirmKeys(capture: string): string[] | null {
  if (!capture.includes("Enter to confirm")) return null;
  const lines = capture.split("\n");
  const cursor = lines.find((line) => line.includes("❯"));
  if (cursor && /\bYes\b/.test(cursor)) return ["Enter"];
  return lines.some((line) => /\bYes\b/.test(line)) ? ["Down"] : null;
}

/** 首次运行的引导画面只认这两种长相；未知画面一律等，绝不盲敲 Enter。 */
export function onboardingKeys(capture: string): string[] | null {
  if (capture.includes("Press Enter to continue")) return ["Enter"];
  if (capture.includes("Syntax theme:")) return ["Enter"];
  return null;
}

export type Question = { question: string; options: string[] };

/** AskUserQuestion 的选项行：`❯ 1. 甲` 或 `  2. 乙`；❯ 是光标不是内容。 */
const OPTION_LINE = /^\s*[❯>]?\s*(\d+)\.\s+(.+?)\s*$/;

export function matchQuestion(capture: string): Question | null {
  const lines = capture.split("\n");
  const footer = lines.findIndex((line) => line.includes(QUESTION_FOOTER));
  if (footer < 0) return null;
  const top = lines.findIndex((line) => line.includes("☐"));
  const body = lines.slice(top + 1, footer);
  const options: string[] = [];
  let question = "";
  for (const line of body) {
    const hit = line.match(OPTION_LINE);
    if (hit) {
      options.push(hit[2].trim());
      continue;
    }
    const text = line.trim();
    if (text && !question && !text.startsWith("─") && !text.startsWith("❯")) question = text;
  }
  return { question, options };
}

/** 输入框空着：独立成行的裸 ❯。提问/信任画面里没有这个形状。 */
export function bareInputBox(capture: string): boolean {
  return capture.split("\n").some((line) => /^❯\s*$/.test(line));
}

/** 屏幕指纹：稳定度判断用。任何 spinner 转动、行数变化都会改变它。 */
export function fingerprint(capture: string, digest: (text: string) => string): string {
  return digest(capture);
}
