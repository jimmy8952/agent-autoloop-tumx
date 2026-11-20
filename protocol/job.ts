import type { Rule } from "../kernel/rules.ts";

/** One line of a matter's record, as the hub kept it. */
export type MatterLine = { at: string; kind: string; text: string };
export type MatterMemory = {
  key: string;
  rule: string;
  lane: string;
  /** 进行中, 等你回答, 等复查, 已完成 or 搁置. */
  state: string;
  card?: number;
  at?: string;
  latest: string;
  openedAt: string;
  endedAt: string | null;
  history: MatterLine[];
  /** Lines before these, left out: `agent-autoloop why` has them. */
  earlier: number;
};
export type MemoryEntry = { key: string; text: string; at: string };
/** What a new session is handed of what the hub remembers. A session going on in its conversation has it already. */
export type Memory = {
  matter: MatterMemory | null;
  rule: MemoryEntry[];
  owner: { instructions: string; notes: MemoryEntry[] };
  /** Only for the rule that dreams: what to curate. */
  dream?: {
    since: string | null;
    matters: MatterMemory[];
    more: number;
    rules: Record<string, MemoryEntry[]>;
    owner: MemoryEntry[];
    proposed: { key: string; text: string }[];
    rejected: { key: string; reason: string }[];
    limits: { owner: { entry: number; total: number }; rule: { entry: number; total: number } };
  };
};

export type Job = {
  run: number;
  token: string;
  attempt: number;
  rule: Pick<Rule, "name" | "cwd" | "skill" | "prompt" | "title" | "emits" | "dreams">;
  agent: {
    id: string;
    name: string;
    use: string;
    model?: string;
    effort?: string;
    tier?: string;
    access: string;
    command?: string[];
    program?: string;
    timeout?: number;
  };
  session: string | null;
  askFirst: string[];
  context: {
    events: {
      id: string;
      source: string;
      sourceName: string;
      type: string;
      subject: string;
      summary: string;
      detail: string;
      link: string;
      receivedAt: string;
      hops?: number;
    }[];
    answers: {
      card: number;
      title: string;
      options: string[];
      choice: number | null;
      chosen: string | null;
      text: string | null;
      about: string;
      by: string | null;
      at: string;
    }[];
    timers: { key: string; about: string; at: string }[];
    waiting: { key: string; about: string; at: string }[];
    open: { card: number; title: string; text: string; at: string }[];
    decided: { card: number; title: string; choice: string | null; at: string }[];
  };
  /** Left out by hubs from before memory: a worker then gives a new session nothing more than it always did. */
  memory?: Memory;
};
