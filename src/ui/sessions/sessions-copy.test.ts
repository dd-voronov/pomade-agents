import { describe, expect, it } from "vitest";

import type { SessionsAnswer } from "../../shared/sessions.ts";
import { testSession } from "../../shared/test-sessions.ts";
import { applyAnswer, countByStatus, isBehind } from "./sessions-copy.ts";

const answer = (a: Partial<SessionsAnswer>): SessionsAnswer => ({
  epoch: "e1",
  revision: 1,
  full: true,
  sessions: [],
  removed: [],
  indexing: false,
  recordsOff: null,
  ...a,
});

describe("the UI's copy of the sessions", () => {
  it("is replaced by a full answer and updated by a delta", () => {
    const first = applyAnswer(null, answer({ revision: 3, sessions: [testSession({ id: "a" }), testSession({ id: "b" })], indexing: true }));
    expect([...first.byId.keys()]).toEqual(["a", "b"]);
    expect(first).toMatchObject({ since: { epoch: "e1", revision: 3 }, indexing: true, recordsOff: null });

    const onHold = testSession({ id: "b", record: { id: "b", provider: "claude-code", agent: "claude", status: "on-hold" } });
    const delta = applyAnswer(first, answer({ revision: 5, full: false, sessions: [onHold, testSession({ id: "c" })], removed: ["a"], recordsOff: "off" }));
    expect([...delta.byId.keys()]).toEqual(["b", "c"]);
    expect(delta.byId.get("b")?.record?.status).toBe("on-hold");
    expect(delta.recordsOff).toBe("off");
    expect(first.byId.size).toBe(2);

    const restarted = applyAnswer(delta, answer({ epoch: "e2", revision: 1, sessions: [testSession({ id: "z" })] }));
    expect([...restarted.byId.keys()]).toEqual(["z"]);
  });

  it("is behind a notice of a later revision or another run", () => {
    const copy = applyAnswer(null, answer({ revision: 4 }));
    expect(isBehind(null, { epoch: "e1", revision: 0 })).toBe(true);
    expect(isBehind(copy, { epoch: "e1", revision: 4 })).toBe(false);
    expect(isBehind(copy, { epoch: "e1", revision: 5 })).toBe(true);
    expect(isBehind(copy, { epoch: "e2", revision: 1 })).toBe(true);
  });

  it("counts the sessions by status, leaving out those without a record", () => {
    const withStatus = (id: string, status: "active" | "done") => testSession({ id, record: { id, provider: "codex", agent: "codex", status } });
    expect(countByStatus([withStatus("a", "done"), withStatus("b", "done"), withStatus("c", "active"), testSession({ id: "d", record: null })])).toEqual({
      active: 1,
      "on-hold": 0,
      done: 2,
      "done-skip": 0,
    });
  });
});
