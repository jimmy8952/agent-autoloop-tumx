# 做梦：每天整理中台的记忆

## 解决什么
中台记着每件事经过它的往来：来了什么事件、Agent 问了什么、你怎么答的、每一轮的结论。事情做完以后，这些往来不再交给新会话。做梦每天凌晨看一遍最近做完或搁置的事，从里面提炼两样东西：

- **每条规则的经验**：以后同类事再来时用得上的结论，直接记住。每条规则最多 800 字（约 1000 token）。
- **关于你的了解**：角色、偏好、你纠正过的事。只是提议，发一张卡片请你确认，确认了才记住；最多 400 字（约 500 token）。没有提议的日子不发卡片，7 天不回答就作废。

记住的东西只在开新会话时交给 Agent 一次；接着原会话跑的，不重复给。

## 怎么启用
把本目录的 `SKILL.md` 复制到 `~/.claude/skills/dream-memory/`；Codex 用 `~/.codex/skills/dream-memory/`。
把 `rules.json` 的 `agents`、`rules` 并进 `~/.agent-autoloop/rules.json`，然后检查：
```bash
agent-autoloop check
```
想马上试一次：`agent-autoloop run 做梦`。看记住了什么：`agent-autoloop memory`；忘掉一条：`agent-autoloop forget <规则> <名字>`，关于你的用 `agent-autoloop forget --owner <名字>`。

## 要改哪几处
- `cwd` 是一个空目录，先建好：`mkdir ~/dream`。做梦不需要读任何文件；不要指向 `~/.agent-autoloop`，那里有中台的密钥。
- `worker` 换成 `agent-autoloop status` 显示的接单电脑；`use` 选 `claude` 或 `codex`，可以写一个便宜的 `model`。
- `cron` 是当地时间，默认每天 3:17。一套规则里只能有一条写了 `dreams: true` 的规则。
- 权限：`read`。它只读中台交给它的资料，写记忆靠回执，不需要改任何文件。
- 你自己对 Agent 的长期要求，写在 `rules.json` 的 `instructions`（全局）或某条规则的 `instructions` 里，不靠做梦。
