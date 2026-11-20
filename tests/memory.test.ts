// Failure modes: a new session of a matter starts without what went through the hub for it (the event, the question, the
// owner's answer, what each round concluded); a matter ends while a card or a review still waits, or never ends when a
// round says it's done; `done` alone is taken to mean done; a matter with nothing waiting and nothing said stays open for
// good, or is set aside without its deadline in the due table; news for an ended or set-aside matter isn't recorded
// against it; one day of a scheduled rule runs into the next day's record; a receipt that isn't a dream's writes memory;
// a dream writes past a rule's limit, takes owner memory without the owner, or deletes it; proposals pile up on several
// cards, outlive their seven days, or an answer takes more than it names or more than the owner's limit; the owner can't
// take an entry out; a session going on in its conversation is handed the memory again, or a new one isn't; standing
// directions written by the owner don't reach a new session; rules let a second dream rule, or one woken by events, in.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decide } from "../kernel/decide.ts";
import { empty, evolve, rows, type View } from "../kernel/evolve.ts";
import { LAST_DREAM, PROPOSALS_OPEN, STALL_AFTER, matterKey } from "../kernel/memory.ts";
import { checkSchema } from "../protocol/schema.ts";
import { parseRules, rulesWarnings, RulesError } from "../protocol/rules.ts";
import { parseResult } from "../protocol/validate.ts";
import type { Job } from "../protocol/job.ts";
import { contextFor, promptFor, readMessage } from "../worker/contract.ts";
import { at } from "./helpers.ts";

const environment = { secret: "memory-secret", publicUrl: "https://hub.test" };
const fixture = JSON.parse(readFileSync(new URL("./rules.fixture.json", import.meta.url), "utf8"));

/** The fixture's rules with only the ones named, so nothing else queues work for the same worker. */
function rulesWith(names: string[], extra: object[] = [], top: object = {}) {
  const shaped = structuredClone(fixture);
  shaped.rules = [...shaped.rules.filter((rule: { name: string }) => names.includes(rule.name)), ...extra];
  return parseRules(JSON.stringify({ ...shaped, ...top }), 0, "UTC");
}
const DREAM = { name: "整理", when: { cron: "17 3 * * *" }, to: "a1", cwd: "~/x", prompt: "整理记忆。", dreams: true };

function hub(rules = rulesWith(["意见"])) {
  let view: View = evolve(empty(), decide(empty(), { type: "rules", args: [rules] }, at(0), environment).facts);
  let now = at(0);
  const act = (type: string, ...args: unknown[]) => {
    const decided = decide(view, { type, args }, now, environment);
    view = evolve(view, decided.facts);
    return decided.value;
  };
  return {
    get view() {
      return view;
    },
    act,
    at: (minutes: number) => (now = at(minutes)),
    claim: (worker = "w1"): Job => act("claimNext", worker, `claim-${now}-${Math.random()}`),
    finish: (job: Job, result: object) => act("finish", job.run, job.token, result),
    matter: (key: string) => view.get("matters", key)!,
    lines: (key: string) => rows(view, "matter_log", { matter: key }).map((line) => [line.kind, line.text]),
  };
}
const feedback = (id: string, subject: string, summary = "") => ({ id, type: "feedback.new", subject, summary });

test("a matter's dealings through the hub are recorded, and a new session of it gets them with where it stands", () => {
  const h = hub();
  h.act("ingest", "app", feedback("f1", "#1", "按钮点不动"));
  const first = h.claim();
  const key = matterKey("意见", "#1");
  assert.deepEqual(first.memory?.matter?.key, key);
  assert.equal(first.memory?.matter?.state, "进行中");
  const ask = { title: "要不要回滚", text: "回滚能马上好", options: ["回滚", "不回滚"] };
  h.finish(first, { outcome: "done", summary: "查到是上一版的问题", ask: [ask] });
  const card = rows(h.view, "cards", { matter: key, state: "open" })[0];
  assert.ok(card, "the question belongs to the matter");
  h.act("answer", card.id, { choice: 0, by: "本人" });
  const second = h.claim();
  const memory = second.memory!.matter!;
  assert.deepEqual(
    memory.history.map((line) => line.kind),
    ["event", "result", "ask", "answer"],
  );
  assert.match(memory.history[0].text, /feedback\.new #1：按钮点不动/);
  assert.match(memory.history[1].text, /查到是上一版的问题/);
  assert.match(memory.history[2].text, /要不要回滚.*回滚 \/ 不回滚/);
  assert.match(memory.history[3].text, /你选了：回滚/);
  assert.equal(memory.latest, "查到是上一版的问题");
  h.finish(second, { outcome: "done", summary: "回滚了", finished: true });
  assert.equal(h.matter(key).state, "ended");
  assert.deepEqual(h.lines(key).at(-1), ["ended", "做完了，这件事结束"]);
});

test("done is only the round: a matter ends when a round says so and nothing is left waiting", () => {
  const h = hub();
  const key = matterKey("意见", "#2");
  h.act("ingest", "app", feedback("f2", "#2"));
  h.finish(h.claim(), {
    outcome: "done",
    summary: "问了一下",
    ask: [{ title: "选哪个", text: "x", options: ["甲", "乙"] }],
  });
  assert.equal(h.matter(key).state, "open", "done with a question is not done");
  h.act("answer", rows(h.view, "cards", { matter: key, state: "open" })[0].id, { choice: 1 });
  const notice = { title: "请看一眼", text: "改好了，你确认一下" };
  h.finish(h.claim(), { outcome: "done", summary: "改好了", notice: [notice], finished: true });
  assert.equal(h.matter(key).state, "open", "said to be done, with a notice still open, it waits");
  assert.equal(rows(h.view, "due").filter((due) => due.kind === "stall").length, 0);
  h.act("answer", rows(h.view, "cards", { matter: key, state: "open" })[0].id, { text: "看过了" });
  assert.equal(h.matter(key).state, "ended", "the last thing waiting dealt with, it ends");
});

test("with nothing waiting and nothing said, a matter is set aside 20 minutes on, and news reopens it", () => {
  const h = hub();
  const key = matterKey("意见", "#3");
  h.act("ingest", "app", feedback("f3", "#3"));
  h.finish(h.claim(), { outcome: "done", summary: "改好了，等发布" });
  const stall = rows(h.view, "due").find((due) => due.kind === "stall");
  assert.equal(stall?.key, key);
  assert.equal(stall?.at, at(0) + STALL_AFTER);
  h.at(19);
  h.act("tick");
  assert.equal(h.matter(key).state, "open");
  h.at(21);
  h.act("tick");
  assert.equal(h.matter(key).state, "stalled");
  assert.equal(rows(h.view, "due").filter((due) => due.kind === "stall").length, 0);
  h.act("ingest", "app", feedback("f3b", "#3", "又坏了"));
  assert.equal(h.matter(key).state, "open");
  assert.deepEqual(
    h
      .lines(key)
      .slice(-3)
      .map(([kind]) => kind),
    ["stalled", "reopened", "event"],
  );
  const again = h.claim();
  assert.equal(again.memory!.matter!.history.length, 5, "it goes on with the same record");
});

test("a review to come keeps a matter open, and comes back to the same record", () => {
  const h = hub();
  const key = matterKey("意见", "#4");
  h.act("ingest", "app", feedback("f4", "#4"));
  const later = { key: "看发布", at: new Date(at(60)).toISOString(), about: "看发布成没成" };
  h.finish(h.claim(), { outcome: "done", summary: "提交了，等发布", later: [later] });
  assert.equal(h.matter(key).stall_at, null);
  assert.equal(h.matter(key).state, "open");
  h.at(61);
  h.act("tick");
  const back = h.claim();
  assert.equal(back.memory!.matter!.key, key);
  assert.match(back.memory!.matter!.history.at(-1)!.text, /约好的复查到了：看发布成没成/);
});

test("each moment of a scheduled rule is a matter of its own", () => {
  const h = hub(rulesWith(["早报"]));
  h.act("tick");
  h.at(23 * 60); // 9:00 the next morning in Asia/Shanghai
  h.act("tick");
  const day1 = h.claim();
  const first = day1.memory!.matter!.key;
  h.finish(day1, { outcome: "done", summary: "写好了", finished: true });
  h.at(47 * 60);
  h.act("tick");
  const day2 = h.claim();
  assert.notEqual(day2.memory!.matter!.key, first);
  assert.deepEqual(
    day2.memory!.matter!.history.map((line) => line.kind),
    ["schedule"],
    "a new day starts afresh",
  );
  assert.equal(h.matter(first).state, "ended");
});

test("only a dream writes memory: a rule's experience at once and within limits, the owner's only by proposal", () => {
  const rules = rulesWith(["意见"], [DREAM], { instructions: "回复都用中文。" });
  const h = hub(rules);
  h.act("ingest", "app", feedback("f5", "#5"));
  const plain = h.finish(h.claim(), {
    outcome: "done",
    summary: "做完了",
    finished: true,
    memory: [{ scope: "rule", rule: "意见", key: "x", text: "不该记住" }],
  });
  assert.match(JSON.stringify(plain.rejected), /只有做梦规则/);
  assert.equal(rows(h.view, "memory", { scope: "rule" }).length, 0);
  h.act("runRule", "整理", "本人", {});
  const dreaming = h.claim();
  assert.equal(dreaming.rule.dreams, true);
  assert.equal(dreaming.memory!.dream!.matters.length, 1, "it reads what ended since it last dreamt");
  assert.equal(dreaming.memory!.dream!.since, null);
  const dreamMatter = dreaming.memory!.matter!.key;
  const done = h.finish(dreaming, {
    outcome: "done",
    summary: "整理了",
    memory: [
      { scope: "rule", rule: "意见", key: "回滚", text: "上一版出问题先回滚再查" },
      { scope: "rule", rule: "意见", key: "太长", text: "长".repeat(101) },
      { scope: "rule", rule: "没有", key: "别处", text: "不存在的规则" },
      { scope: "owner", key: "简短", text: "喜欢简短的回复" },
      { scope: "owner", key: "旧的", forget: true },
    ],
  });
  assert.equal(done.rejected.filter((one: { what?: string }) => one.what === "memory").length, 3);
  assert.equal(h.matter(dreamMatter).state, "ended", "a dream's round over, its matter is too");
  assert.equal(rows(h.view, "memory", { scope: "rule" }).length, 1);
  assert.equal(rows(h.view, "memory", { scope: "owner" }).length, 0, "the owner says what's remembered of them");
  const card = rows(h.view, "cards", { state: "open" }).find((one) => one.title === "要不要记住这些关于你的事？")!;
  assert.deepEqual(JSON.parse(card.options), ["全部采纳", "都不要"]);
  assert.match(card.text, /1\. 喜欢简短的回复/);
  assert.equal(h.view.get("memory", LAST_DREAM)!.rejected.length, 3, "the next dream sees what was refused");
  assert.deepEqual(h.act("answer", card.id, { text: "采纳 1", by: "本人" }), {
    changed: true,
    state: "done",
    result: "记住了 1 条",
  });
  assert.deepEqual(
    rows(h.view, "memory", { scope: "owner" }).map((row) => row.text),
    ["喜欢简短的回复"],
  );
  assert.equal(h.view.get("cards", card.id)!.state, "done");
  assert.equal(h.view.get("memory", PROPOSALS_OPEN), undefined);
  assert.equal(rows(h.view, "runs", { rule: "整理", state: "queued" }).length, 0, "answering it starts no round");
  h.act("ingest", "app", feedback("f6", "#6"));
  const fresh = h.claim();
  assert.deepEqual(
    fresh.memory!.rule.map((entry) => entry.text),
    ["上一版出问题先回滚再查"],
  );
  assert.deepEqual(
    fresh.memory!.owner.notes.map((entry) => entry.text),
    ["喜欢简短的回复"],
  );
  assert.equal(fresh.memory!.owner.instructions, "回复都用中文。");
});

test("a rule keeps at most its limit, and forgetting in the same receipt makes room", () => {
  const h = hub(rulesWith(["意见"], [DREAM]));
  const dream = (memory: object[]) => {
    h.act("runRule", "整理", "本人", {});
    return h.finish(h.claim(), { outcome: "done", summary: "整理", memory });
  };
  const full = Array.from({ length: 8 }, (_, n) => ({
    scope: "rule",
    rule: "意见",
    key: `k${n}`,
    text: "字".repeat(100),
  }));
  assert.equal(dream(full).rejected.length, 0);
  const over = dream([{ scope: "rule", rule: "意见", key: "k9", text: "多" }]);
  assert.match(over.rejected[0].reason, /最多 800 字/);
  const swapped = dream([
    { scope: "rule", rule: "意见", key: "k9", text: "新的一条" },
    { scope: "rule", rule: "意见", key: "k0", forget: true },
  ]);
  assert.equal(swapped.rejected.length, 0);
  assert.equal(rows(h.view, "memory", { scope: "rule" }).length, 8);
});

test("one card of proposals at a time, gone after seven days, and an answer takes what it names within the limit", () => {
  const h = hub(rulesWith(["意见"], [DREAM]));
  const dream = (memory: object[]) => {
    h.act("runRule", "整理", "本人", {});
    return h.finish(h.claim(), { outcome: "done", summary: "整理", memory });
  };
  const proposalCards = () => rows(h.view, "cards").filter((card) => card.title === "要不要记住这些关于你的事？");
  dream([{ scope: "owner", key: "p1", text: "一" }]);
  dream([{ scope: "owner", key: "p2", text: "二" }]);
  assert.equal(proposalCards().length, 1, "what comes while one is open waits");
  h.at(7 * 24 * 60 + 1);
  h.act("tick");
  assert.equal(proposalCards()[0].state, "closed");
  assert.deepEqual(
    rows(h.view, "memory", { scope: "proposal" }).map((row) => row.name),
    ["p2"],
    "the lapsed card's proposals go with it",
  );
  const six = Array.from({ length: 6 }, (_, n) => ({ scope: "owner", key: `o${n}`, text: "了".repeat(80) }));
  dream(six);
  const card = proposalCards().find((one) => one.state === "open")!;
  assert.match(card.text, /7\. /, "the waiting one and the six new ones");
  h.act("answer", card.id, { choice: 0 });
  assert.equal(
    rows(h.view, "memory", { scope: "owner" }).length,
    5,
    "400 characters hold the short one and four of 80",
  );
  assert.match(h.view.get("cards", card.id)!.result, /超过 400 字的上限/);
});

test("the owner takes an entry out of memory", () => {
  const h = hub(rulesWith(["意见"], [DREAM]));
  h.act("runRule", "整理", "本人", {});
  h.finish(h.claim(), {
    outcome: "done",
    summary: "整理",
    memory: [
      { scope: "rule", rule: "意见", key: "a", text: "甲" },
      { scope: "owner", key: "b", text: "乙" },
    ],
  });
  h.act("answer", rows(h.view, "cards", { state: "open" })[0].id, { choice: 0 });
  assert.deepEqual(h.act("forgetMemory", "rule", "意见", "a"), { changed: true });
  assert.deepEqual(h.act("forgetMemory", "owner", null, "b"), { changed: true });
  assert.deepEqual(h.act("forgetMemory", "owner", null, "b"), { changed: false });
  assert.equal(rows(h.view, "memory", { scope: ["rule", "owner"] }).length, 0);
});

test("a new session is handed the memory once; one going on in its conversation isn't, and a dream always is", () => {
  const h = hub(rulesWith(["意见"], [DREAM], { instructions: "先核实再动手。" }));
  h.act("ingest", "app", feedback("f7", "#7", "页面白屏"));
  const job = h.claim();
  const file = "/tmp/context.json";
  const fresh = promptFor(job, file);
  assert.match(fresh, /这是新会话/);
  assert.match(fresh, /先核实再动手。/);
  assert.ok("memory" in contextFor(job));
  const going = { ...job, session: "s-1" };
  assert.doesNotMatch(promptFor(going, file), /这是新会话|先核实再动手/);
  assert.ok(!("memory" in contextFor(going)));
  assert.match(promptFor(going, file, true), /这是新会话/, "a session that couldn't go on is new after all");
  h.finish(job, { outcome: "done", summary: "好了", finished: true });
  h.act("runRule", "整理", "本人", {});
  const dreaming = { ...h.claim(), session: "s-2" };
  assert.ok((contextFor(dreaming) as { memory?: { dream?: unknown } }).memory?.dream);
  assert.match(promptFor(dreaming, file), /memory\.dream/);
});

test("a receipt may say finished, and a dream's memory, in the shape the schema publishes", () => {
  const said = 'done\n\n```agent-autoloop\n{"finished":true,"memory":[{"scope":"owner","key":"k","text":"t"}]}\n```';
  assert.deepEqual(readMessage(said).receipt, { finished: true, memory: [{ scope: "owner", key: "k", text: "t" }] });
  const good = [
    { outcome: "done", finished: true },
    { outcome: "done", memory: [{ scope: "rule", rule: "意见", key: "k", text: "t" }] },
    { outcome: "done", memory: [{ scope: "rule", rule: "意见", key: "k", forget: true }] },
    { outcome: "done", memory: [{ scope: "owner", key: "k", forget: true }] },
  ];
  for (const result of good) {
    assert.deepEqual(parseResult(result), result);
    assert.deepEqual(checkSchema("result", result), []);
  }
  const bad = [
    { outcome: "done", finished: "yes" },
    { outcome: "done", memory: [{ scope: "rule", key: "k", text: "t" }] },
    { outcome: "done", memory: [{ scope: "owner", rule: "意见", key: "k", text: "t" }] },
    { outcome: "done", memory: [{ scope: "rule", rule: "意见", key: "k", text: "t", forget: true }] },
    { outcome: "done", memory: [{ scope: "team", key: "k", text: "t" }] },
    { outcome: "done", memory: [{ scope: "owner", key: " ", text: "t" }] },
  ];
  for (const result of bad) {
    assert.throws(() => parseResult(result), /finished|memory/);
    assert.ok(checkSchema("result", result).length, JSON.stringify(result));
  }
});

test("rules take one dream rule, on a schedule, and say when standing directions get long", () => {
  const byEvent = { ...DREAM, when: { source: "app", types: ["feedback.*"] } };
  assert.throws(
    () => rulesWith(["意见"], [byEvent]),
    (error: RulesError) => /要用 cron/.test(error.message),
  );
  const two = [DREAM, { ...DREAM, name: "再整理" }];
  assert.throws(
    () => rulesWith(["意见"], two),
    (error: RulesError) => /只能有一条做梦规则/.test(error.message),
  );
  assert.throws(() => rulesWith(["意见"], [], { instructions: "长".repeat(4001) }), RulesError);
  assert.deepEqual(rulesWarnings(rulesWith(["意见"], [], { instructions: "短" })), []);
  assert.match(rulesWarnings(rulesWith(["意见"], [], { instructions: "长".repeat(1001) }))[0], /超过 1000 字/);
});
