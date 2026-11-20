// Failure modes: someone other than the owner reads what the hub remembers or takes something out of it; a request to
// forget with the wrong fields is taken; asking after a rule that isn't there reads as one with nothing remembered.
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { setup } from "./helpers.ts";

setup("memory-http");
const { serve } = await import("../host/http.ts");
const { addKey } = await import("./hub.ts");
const keys = { owner: addKey("owner", "owner"), app: addKey("source", "app") };
const server = serve(0, "127.0.0.1", { commit: "abc123" });
let base = "";
before(async () => {
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.closeAllConnections();
  server.close();
});
const call = (path: string, key: string, body?: unknown) =>
  fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${key}`, connection: "close", "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

test("only the owner reads and forgets memory", async () => {
  assert.equal((await call("/v1/memory", keys.app)).status, 401);
  assert.equal((await call("/v1/memory/forget", keys.app, { scope: "owner", key: "x" })).status, 401);
  const memory = await (await call("/v1/memory", keys.owner)).json();
  assert.deepEqual(memory.owner, []);
  assert.deepEqual(memory.limits, { owner: { entry: 80, total: 400 }, rule: { entry: 100, total: 800 } });
  assert.ok(memory.rules.some((rule: { name: string }) => rule.name === "意见"));
  const one = await (await call(`/v1/memory?rule=${encodeURIComponent("意见")}`, keys.owner)).json();
  assert.deepEqual(
    one.rules.map((rule: { name: string }) => rule.name),
    ["意见"],
  );
  assert.equal((await call(`/v1/memory?rule=${encodeURIComponent("没有")}`, keys.owner)).status, 404);
});

test("a request to forget says exactly which entry", async () => {
  for (const body of [
    { scope: "team", key: "x" },
    { scope: "rule", key: "x" },
    { scope: "owner", rule: "意见", key: "x" },
    { scope: "owner" },
    { scope: "owner", key: "x", extra: 1 },
  ])
    assert.equal((await call("/v1/memory/forget", keys.owner, body)).status, 400, JSON.stringify(body));
  const forgot = await call("/v1/memory/forget", keys.owner, { scope: "rule", rule: "意见", key: "x" });
  assert.deepEqual(await forgot.json(), { changed: false });
});
