// What the hub remembers of its own, read from the view: each matter's dealings through the hub (what came in, what was
// asked and told, what the owner answered, what each round concluded), a rule's experience and what it knows of the owner.
// An Agent's own memory is its own business. This is only what went through the hub, for a new session to pick up from.
import { rows, type Row, type View } from "./evolve.ts";
import type { Rule, Rules } from "./rules.ts";

/** How long a matter can sit with nothing to wait for, and not said to be done, before it's set aside. */
export const STALL_AFTER = 20 * 60_000;
/** How long the owner has to answer a card of proposals about them before they lapse. */
export const PROPOSALS_LAST = 7 * 86400_000;
/** Characters, as the hub has no tokenizer: about 500 and 1000 tokens of Chinese, counted on the safe side. */
export const LIMITS = { owner: { entry: 80, total: 400 }, rule: { entry: 100, total: 800 } } as const;
/** One line of a matter's record: titles and conclusions, never whole texts, which `why` still has. */
export const LOG_TEXT = 200;
/** The latest lines of a matter a new session gets; the count of the rest says there's more to look up. */
export const HISTORY_SHOWN = 60;
/** Matters a dream reads at most, newest first, and lines of each. */
export const DREAM_MATTERS = 30;
export const DREAM_HISTORY = 40;
export const PROPOSALS_CARD = "memory:proposals:";
/** Rows of the memory table that aren't memory: when the last dream was, and the open card of proposals. */
export const LAST_DREAM = "dream:last";
export const PROPOSALS_OPEN = "proposals:card";

export const matterKey = (rule: string, lane: string, occasion: string | null = null) =>
  JSON.stringify([rule, lane, occasion]);
export const ruleMemoryKey = (rule: string, name: string) => JSON.stringify(["rule", rule, name]);
export const ownerMemoryKey = (name: string) => JSON.stringify(["owner", name]);

export const chars = (text: string) => [...text].length;
export function clip(text: string, limit = LOG_TEXT) {
  const flat = text.replace(/\s+/g, " ").trim();
  const all = [...flat];
  return all.length > limit ? `${all.slice(0, limit - 1).join("")}…` : flat;
}

/** Nothing the hub is still waiting on for it: no card open, no review to come, no round queued or going. */
export function idle(view: View, key: string) {
  if (rows(view, "cards", { matter: key, state: "open" }, 1).length) return false;
  if (rows(view, "timers", { matter: key, event_id: null }, 1).length) return false;
  return !rows(view, "runs", { matter: key, state: ["queued", "claimed", "unknown"] }, 1).length;
}

/** Where a matter stands, in words: what the record opens with. */
export function standing(view: View, matter: Row): { state: string; card?: number; at?: string } {
  if (matter.state === "ended") return { state: "已完成", at: matter.ended_at };
  if (matter.state === "stalled") return { state: "搁置", at: matter.ended_at };
  const [question] = rows(view, "cards", { matter: matter.key, state: "open" }).filter((card) => card.kind === "ask");
  if (question) return { state: "等你回答", card: question.id };
  const reviews = rows(view, "timers", { matter: matter.key, event_id: null }).sort((a, b) => a.at.localeCompare(b.at));
  if (reviews.length) return { state: "等复查", at: reviews[0].at };
  return { state: "进行中" };
}

export function historyOf(view: View, matter: Row, shown = HISTORY_SHOWN) {
  const latest = rows(view, "matter_log", { matter: matter.key }, shown, true).reverse();
  return {
    history: latest.map(({ at, kind, text }) => ({ at, kind, text })),
    earlier: Math.max(0, (matter.entries ?? 0) - latest.length),
  };
}

export function matterView(view: View, matter: Row, shown = HISTORY_SHOWN) {
  return {
    key: matter.key,
    rule: matter.rule,
    lane: matter.lane,
    ...standing(view, matter),
    latest: matter.latest ?? "",
    openedAt: matter.opened_at,
    endedAt: matter.ended_at ?? null,
    ...historyOf(view, matter, shown),
  };
}

const entryView = ({ name, text, at }: Row) => ({ key: name as string, text: text as string, at: at as string });
export const ruleMemory = (view: View, rule: string) => rows(view, "memory", { scope: "rule", rule }).map(entryView);
export const ownerMemory = (view: View) => rows(view, "memory", { scope: "owner" }).map(entryView);
export const proposals = (view: View) => rows(view, "memory", { scope: "proposal" });

/** The owner's standing directions for one rule's work: the hub's own, then the rule's. They are rules, not memory. */
export function instructionsFor(rules: Rules, rule: Pick<Rule, "instructions"> | undefined) {
  return [rules.instructions, rule?.instructions].filter((text) => text?.trim()).join("\n\n");
}

/** What a new session of a run is handed: its matter's record, its rule's experience, the owner's layer. */
export function memoryOf(view: View, run: Row, rules: Rules, rule: Rule | undefined) {
  const matter = run.matter ? view.get("matters", run.matter) : undefined;
  return {
    matter: matter ? matterView(view, matter) : null,
    rule: ruleMemory(view, run.rule),
    owner: { instructions: instructionsFor(rules, rule), notes: ownerMemory(view) },
    ...(rule?.dreams && { dream: dreamOf(view, rules) }),
  };
}

/** What a dream works from: the matters that ended or were set aside since the last one, and the memory as it stands. */
export function dreamOf(view: View, rules: Rules) {
  const last = view.get("memory", LAST_DREAM);
  const since: string | null = last?.at ?? null;
  const dreamer = new Set(rules.rules.filter((rule) => rule.dreams).map((rule) => rule.name));
  const ended = rows(view, "matters", { state: ["ended", "stalled"] })
    .filter((matter) => !dreamer.has(matter.rule) && (since === null || matter.ended_at > since))
    .sort((a, b) => b.ended_at.localeCompare(a.ended_at));
  return {
    since,
    matters: ended.slice(0, DREAM_MATTERS).map((matter) => matterView(view, matter, DREAM_HISTORY)),
    more: Math.max(0, ended.length - DREAM_MATTERS),
    rules: Object.fromEntries(
      rules.rules.filter((rule) => !rule.dreams).map((rule) => [rule.name, ruleMemory(view, rule.name)]),
    ),
    owner: ownerMemory(view),
    proposed: proposals(view).map(({ name, text }) => ({ key: name, text })),
    rejected: (last?.rejected ?? []) as { key: string; reason: string }[],
    limits: LIMITS,
  };
}

/** Everything remembered, for the owner to look at. */
export function memoryView(view: View, rules: Rules, rule?: string) {
  const names = rule === undefined ? rules.rules.map((one) => one.name) : [rule];
  const open = rows(view, "matters", { state: "open" });
  const stalled = rows(view, "matters", { state: "stalled" });
  const pick = (matters: Row[]) =>
    matters
      .filter((matter) => rule === undefined || matter.rule === rule)
      .map((matter) => matterView(view, matter, 10))
      .sort((a, b) => String(b.openedAt).localeCompare(String(a.openedAt)));
  return {
    instructions: rules.instructions ?? "",
    owner: ownerMemory(view),
    proposed: proposals(view).map(({ name, text, card_id }) => ({ key: name, text, card: card_id ?? null })),
    rules: names.map((name) => ({
      name,
      instructions: rules.rules.find((one) => one.name === name)?.instructions ?? "",
      memory: ruleMemory(view, name),
      used: ruleMemory(view, name).reduce((total, entry) => total + chars(entry.text), 0),
    })),
    open: pick(open),
    stalled: pick(stalled),
    lastDream: view.get("memory", LAST_DREAM)?.at ?? null,
    limits: LIMITS,
  };
}
