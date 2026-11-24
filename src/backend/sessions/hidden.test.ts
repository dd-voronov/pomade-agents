import { describe, expect, it } from "vitest";

import { testSummary } from "../../shared/test-sessions.ts";
import { hiddenReason } from "./hidden.ts";

const text = { text: "Fix the build", at: "2026-11-17T10:01:00.000Z" };

describe("why a session is hidden", () => {
  it("hides one with no message of the user's and no answer as empty", () => {
    expect(hiddenReason(testSummary({ firstMessage: null, lastMessage: null, lastAnswer: null }))).toBe("empty");
  });

  it("shows one with a message or an answer", () => {
    expect(hiddenReason(testSummary({ firstMessage: text, lastMessage: text }))).toBeNull();
    expect(hiddenReason(testSummary({ lastAnswer: text }))).toBeNull();
  });
});
