import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { launchSpec, shellLine, shellWord, type LaunchAgent } from "./launch-spec.ts";

const CLAUDE: LaunchAgent = { command: "claude-libra", provider: "claude", modes: ["normal", "full-autonomy"] };
const CODEX: LaunchAgent = { command: "codex", provider: "codex", modes: ["normal", "full-autonomy"] };
const ID = "0b9c5d4e-1f2a-4b3c-8d4e-5f6a7b8c9d0e";

const argsOf = (agent: LaunchAgent, params: Omit<Parameters<typeof launchSpec>[1], "agent">): string[] => {
  const built = launchSpec(agent, { agent: "a", ...params });
  if (!built.ok) throw new Error(built.problem);
  return built.spec.args;
};

describe("a launch spec", () => {
  it("follows each provider's forms: mode arguments, then a session id or the resume form, then the prompt", () => {
    expect(argsOf(CLAUDE, { mode: "normal" })).toEqual([]);
    expect(argsOf(CLAUDE, { mode: "full-autonomy" })).toEqual(["--dangerously-skip-permissions"]);
    expect(argsOf(CLAUDE, { mode: "normal", sessionId: ID, prompt: "Hi" })).toEqual(["--session-id", ID, "Hi"]);
    expect(argsOf(CLAUDE, { mode: "full-autonomy", resume: "s1", prompt: "Go on" })).toEqual(["--dangerously-skip-permissions", "--resume", "s1", "Go on"]);
    expect(argsOf(CODEX, { mode: "full-autonomy" })).toEqual(["--dangerously-bypass-approvals-and-sandbox"]);
    expect(argsOf(CODEX, { mode: "normal", resume: "s1", prompt: "Go on" })).toEqual(["resume", "s1", "Go on"]);
    expect(argsOf(CODEX, { mode: "full-autonomy", resume: "s1" })).toEqual(["--dangerously-bypass-approvals-and-sandbox", "resume", "s1"]);
  });

  it("puts a prompt that starts with a dash after --", () => {
    expect(argsOf(CLAUDE, { mode: "normal", prompt: "-h means help" })).toEqual(["--", "-h means help"]);
    expect(argsOf(CODEX, { mode: "normal", resume: "s1", prompt: "--version?" })).toEqual(["resume", "s1", "--", "--version?"]);
  });

  it("answers the session id the launch will have: the caller's, the resumed one, none for Codex", () => {
    const idOf = (agent: LaunchAgent, params: Omit<Parameters<typeof launchSpec>[1], "agent">): unknown => {
      const built = launchSpec(agent, { agent: "a", ...params });
      return built.ok ? built.spec.sessionId : built.problem;
    };
    expect(idOf(CLAUDE, { mode: "normal" })).toBeNull();
    expect(idOf(CLAUDE, { mode: "normal", sessionId: ID })).toBe(ID);
    expect(idOf(CLAUDE, { mode: "normal", resume: "s1" })).toBe("s1");
    expect(idOf(CODEX, { mode: "normal", sessionId: ID })).toBeNull();
    expect(idOf(CODEX, { mode: "normal", resume: "s1" })).toBe("s1");
  });

  it("carries the agent's command and the provider's exit, and refuses an unknown or disabled mode", () => {
    expect(launchSpec(CLAUDE, { agent: "a", mode: "normal" })).toEqual({ ok: true, spec: { command: "claude-libra", args: [], line: "claude-libra", sessionId: null, exit: "/exit" } });
    expect(launchSpec(CODEX, { agent: "a", mode: "normal" })).toMatchObject({ ok: true, spec: { exit: "/exit" } });
    expect(launchSpec(CLAUDE, { agent: "a", mode: "plan" })).toEqual({ ok: false, problem: '"mode" "plan" is not a mode of the agent' });
    expect(launchSpec({ ...CLAUDE, modes: ["normal"] }, { agent: "a", mode: "full-autonomy" })).toEqual({ ok: false, problem: "the agent's Full autonomy mode is not enabled" });
  });
});

describe("shell quoting", () => {
  it("leaves plain words, single-quotes the rest, and keeps control characters on one printable line", () => {
    expect(shellWord("--resume")).toBe("--resume");
    expect(shellWord("")).toBe("''");
    expect(shellWord("it's $HOME `x` \"q\" !")).toBe(`'it'\\''s $HOME \`x\` "q" !'`);
    expect(shellWord("a\nb\t'c'\\!")).toBe("$'a\\nb\\t\\'c\\'\\\\\\x21'");
    expect(shellWord("\x1b[0m")).toBe("$'\\x1b[0m'");
    expect(shellLine("claude", ["--resume", "s 1"])).toBe("claude --resume 's 1'");
  });

  // Random prompts from the characters a shell treats specially, plus text, line breaks, tabs,
  // other control characters and non-ASCII.
  const ALPHABET = [..."ab Z09-_./=:,@%+", ..."'\"`$\\!*?[]{}()<>|&;#~^", "\n", "\t", "\r", "\x01", "\x1b", "\x7f", "é", "日", "🙂", " "];
  const random = (seed: number): (() => number) => {
    let x = seed;
    return () => {
      x = (x * 1103515245 + 12345) % 2 ** 31;
      return x / 2 ** 31;
    };
  };
  const prompts = (count: number, seed: number): string[] => {
    const next = random(seed);
    return Array.from({ length: count }, () => {
      const length = 1 + Math.floor(next() * 40);
      return Array.from({ length }, () => ALPHABET[Math.floor(next() * ALPHABET.length)] ?? "a").join("");
    });
  };

  it("quotes every word into one line without line breaks or other control characters", () => {
    for (const prompt of prompts(2000, 7)) {
      expect(shellWord(prompt), JSON.stringify(prompt)).not.toMatch(/[\x00-\x1f\x7f]/);
    }
  });

  describe("read back by a real shell", () => {
    let dir: string;
    let printArgs: string;

    beforeAll(async () => {
      dir = await realpath(await mkdtemp(join(tmpdir(), "pa-launch-")));
      printArgs = join(dir, "print-args");
      await writeFile(printArgs, "#!/bin/sh\nfor arg in \"$@\"; do printf '%s\\0' \"$arg\"; done\n");
      await chmod(printArgs, 0o755);
    });

    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    /** The arguments `line` passes to its command when `shell` runs it. */
    const run = (shell: string[], line: string): string[] => {
      const result = spawnSync(shell[0] ?? "/bin/sh", [...shell.slice(1), line], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: dir } });
      if (result.status !== 0) throw new Error(`${shell.join(" ")} failed (${result.status}): ${result.stderr}`);
      return result.stdout === "" ? [] : result.stdout.slice(0, -1).split("\0");
    };

    it.each([
      ["/bin/sh -c", ["/bin/sh", "-c"]],
      ["zsh -f -c", ["/bin/zsh", "-f", "-c"]],
    ])("gets exactly the spec's args back from line through %s", (_, shell) => {
      for (const [i, prompt] of prompts(80, 11).entries()) {
        const agent = { ...CLAUDE, command: printArgs };
        const built = launchSpec(agent, { agent: "a", mode: i % 2 === 0 ? "normal" : "full-autonomy", ...(i % 3 === 0 ? { resume: "s-1" } : {}), prompt });
        if (!built.ok) throw new Error(built.problem);
        expect(run(shell, built.spec.line), JSON.stringify(prompt)).toEqual(built.spec.args);
      }
    });
  });
});
