import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAIOAuth } from "@openai-oauth/ai-sdk";
import type { LanguageModel } from "ai";
import { runScan, type ScanDependencies } from "../src/scan.ts";

test("scanner replay serializes full stateless tool items and encrypted reasoning", async () => {
  let replayOptions: Record<string, any> | undefined;
  const generate = (async (options: any) => { replayOptions = options.providerOptions; }) as NonNullable<ScanDependencies["generateText"]>;
  const scan = runScan({ name: "Example", careersUrl: null }, {
    model: {} as LanguageModel, generateText: generate, maxSteps: 1,
    searchWeb: async () => [], renderPage: async () => { throw new Error("Unexpected page read"); },
  });
  while (!(await scan.next()).done) { /* consume offline events */ }
  assert.equal(replayOptions?.openai.store, false);

  let payload: any;
  const provider = createOpenAIOAuth({
    kind: "openai-compatible", baseURL: "https://example.invalid/v1",
    request: async () => { throw new Error("Unexpected direct request"); },
    fetch: async (_input: any, init: any) => {
      payload = JSON.parse(init.body);
      return new Response(JSON.stringify({ error: { message: "Mock transport stop", type: "invalid_request_error", code: "mock" } }), { status: 400, headers: { "content-type": "application/json" } });
    },
  });
  await assert.rejects(() => provider("gpt-6-luna").doGenerate({
    providerOptions: replayOptions,
    prompt: [
      { role: "user", content: [{ type: "text", text: "Research the employer" }] },
      { role: "assistant", content: [
        { type: "reasoning", text: "", providerOptions: { openai: { itemId: "rs_old", reasoningEncryptedContent: "encrypted-reasoning-fixture" } } },
        { type: "tool-call", toolCallId: "call_old", toolName: "search_web", input: { query: "Example apprenticeship" }, providerOptions: { openai: { itemId: "fc_old" } } },
      ] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "call_old", toolName: "search_web", output: { type: "json", value: { results: [] } } }] },
      { role: "user", content: [{ type: "text", text: "Continue the research" }] },
    ],
  }), /Mock transport stop/);
  assert.equal(payload.store, false);
  assert.ok(!payload.input.some((item: any) => item.type === "item_reference"));
  const call = payload.input.find((item: any) => item.type === "function_call");
  assert.equal(call.call_id, "call_old");
  assert.match(call.arguments, /Example apprenticeship/);
  assert.ok(payload.input.some((item: any) => item.type === "function_call_output" && item.call_id === "call_old"));
  assert.ok(payload.input.some((item: any) => item.type === "reasoning" && item.encrypted_content === "encrypted-reasoning-fixture"));
});
