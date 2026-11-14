// 监工判决：大脑只许输出一个 JSON 对象；校验不过一律当无效，调用方降级找人，绝不盲执行。
export type Verdict =
  | { action: "answer"; value: string; reason: string }
  | { action: "notify"; title: string; text: string; reason: string }
  | { action: "wait"; reason: string };

const MAX = { value: 500, title: 120, text: 1000, reason: 500 };

function shape(value: unknown): Verdict | null {
  if (typeof value !== "object" || value === null) return null;
  const said = value as Record<string, unknown>;
  const reason = typeof said.reason === "string" ? said.reason.slice(0, MAX.reason) : "";
  if (said.action === "wait") return reason ? { action: "wait", reason } : null;
  if (said.action === "answer") {
    const answer = typeof said.value === "string" ? said.value.trim() : "";
    if (!answer || answer.length > MAX.value) return null;
    return { action: "answer", value: answer, reason };
  }
  if (said.action === "notify") {
    const title = typeof said.title === "string" ? said.title.trim() : "";
    const text = typeof said.text === "string" ? said.text.trim() : "";
    if (!title || !text || title.length > MAX.title || text.length > MAX.text) return null;
    return { action: "notify", title, text, reason };
  }
  return null;
}

/** 大脑输出整体是 JSON 最好；裹了说明文字或 ```json 围栏也能抓出来，但抓不出合法形状就算无效。 */
export function parseVerdict(said: string): Verdict | null {
  const trimmed = said.trim();
  const candidates = [trimmed];
  const start = trimmed.indexOf("{");
  if (start > 0 || trimmed.includes("\n")) {
    let depth = 0;
    for (let i = Math.max(start, 0); i < trimmed.length; i++) {
      if (trimmed[i] === "{") depth++;
      else if (trimmed[i] === "}") {
        depth--;
        if (depth === 0) {
          candidates.push(trimmed.slice(start, i + 1));
          break;
        }
      }
    }
  }
  for (const candidate of candidates) {
    try {
      const verdict = shape(JSON.parse(candidate));
      if (verdict) return verdict;
    } catch {
      // 换下一个候选
    }
  }
  return null;
}
