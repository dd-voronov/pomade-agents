// The zsh pieces against a throwaway HOME / ZDOTDIR: every shell here runs with an environment the
// test builds, never the process's own, so the user's real rc file is out of reach by construction.

import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { aliasLine, appendOnce, parseZshAnswer, rcFileOf, zshOf } from "./shell.ts";

describe("the rc file", () => {
  it("is $ZDOTDIR/.zshrc, else $HOME/.zshrc, as zsh reads it", () => {
    expect(rcFileOf({ HOME: "/h", ZDOTDIR: "/z" })).toBe("/z/.zshrc");
    expect(rcFileOf({ HOME: "/h" })).toBe("/h/.zshrc");
    expect(rcFileOf({ HOME: "/h", ZDOTDIR: "" })).toBe("/h/.zshrc");
    expect(rcFileOf({ HOME: "relative" })).toBeNull();
    expect(rcFileOf({})).toBeNull();
  });
});

describe("the alias line", () => {
  it("runs Claude Code with the agent's folder as its config", () => {
    expect(aliasLine("claude-tax", "/w/Agents/claude-tax")).toBe(`alias claude-tax='CLAUDE_CONFIG_DIR="/w/Agents/claude-tax" claude'`);
    expect(aliasLine("x", "/My Work/Agents/x")).toBe(`alias x='CLAUDE_CONFIG_DIR="/My Work/Agents/x" claude'`);
  });

  it("is refused for a folder its quotes cannot carry", () => {
    for (const folder of ["/w/it's", '/w/"x"', "/w/$HOME", "/w/`x`", "/w/a\\b", "/w/a\nb"]) expect(aliasLine("x", folder), folder).toBeNull();
  });
});

describe("the marked answer", () => {
  it("is found among whatever the rc files print", () => {
    expect(parseZshAnswer(`hello\n\u0001pomade-agents:1\u0002A=1 b\u00020\u0002x is an alias for A=1 b\u0003\nbye`)).toEqual({
      alias: "A=1 b",
      resolves: true,
      description: "x is an alias for A=1 b",
    });
    expect(parseZshAnswer(`\u0001pomade-agents:0\u0002\u00021\u0002x not found\u0003`)).toEqual({ alias: null, resolves: false, description: "" });
    expect(parseZshAnswer("no markers")).toBeNull();
    expect(parseZshAnswer("\u0001pomade-agents:0\u0002")).toBeNull();
  });
});

describe("in a throwaway home", () => {
  let dir: string;
  let home: string;
  const env = (extra: Record<string, string> = {}): Record<string, string> => ({ HOME: home, PATH: "/usr/bin:/bin", SHELL: "/bin/zsh", ...extra });

  beforeEach(async () => {
    dir = await mkdtemp(join(await realpath(tmpdir()), "pa-shell-"));
    home = join(dir, "home");
    await mkdir(home);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("appends the line once, on a line of its own, creating the file when there is none", async () => {
    const rc = join(home, ".zshrc");
    const line = aliasLine("a", "/w/Agents/a") ?? "";
    expect(await appendOnce(rc, line)).toBe("appended");
    expect(await readFile(rc, "utf8")).toBe(`${line}\n`);
    expect(await appendOnce(rc, line)).toBe("present");
    await writeFile(rc, "export X=1");
    expect(await appendOnce(rc, line)).toBe("appended");
    expect(await appendOnce(rc, line)).toBe("present");
    expect(await readFile(rc, "utf8")).toBe(`export X=1\n${line}\n`);
  });

  it("writes through a symlinked rc file to the file it names", async () => {
    const real = join(dir, "dotfiles-zshrc");
    await writeFile(real, "# dotfiles\n");
    await symlink(real, join(home, ".zshrc"));
    await appendOnce(join(home, ".zshrc"), "alias q='x'");
    expect(await readFile(real, "utf8")).toBe("# dotfiles\nalias q='x'\n");
  });

  it("asks a fresh interactive zsh, which reads the rc file of the environment it is given", async () => {
    await writeFile(join(home, ".zshrc"), `echo "rc noise"\nalias claude-x='CLAUDE_CONFIG_DIR="/w/Agents/claude-x" claude'\n`);
    const zsh = zshOf(env());
    expect(await zsh.ask("claude-x")).toEqual({ alias: 'CLAUDE_CONFIG_DIR="/w/Agents/claude-x" claude', resolves: true, description: 'claude-x is an alias for CLAUDE_CONFIG_DIR="/w/Agents/claude-x" claude' });
    expect(await zsh.ask("ls")).toEqual({ alias: null, resolves: true, description: "ls is /bin/ls" });
    expect((await zsh.ask("cd")).description).toBe("cd is a shell builtin");
    expect(await zsh.ask("nothing-by-this-name")).toEqual({ alias: null, resolves: false, description: "" });
  });

  it("reads $ZDOTDIR/.zshrc when ZDOTDIR is set", async () => {
    const zdot = join(dir, "zdot");
    await mkdir(zdot);
    await writeFile(join(zdot, ".zshrc"), "alias only-in-zdot='true'\n");
    await writeFile(join(home, ".zshrc"), "alias only-in-home='true'\n");
    const zsh = zshOf(env({ ZDOTDIR: zdot }));
    expect((await zsh.ask("only-in-zdot")).resolves).toBe(true);
    expect((await zsh.ask("only-in-home")).resolves).toBe(false);
  });

  it("gives up on a shell that does not answer in time", async () => {
    await writeFile(join(home, ".zshrc"), "sleep 5\n");
    await expect(zshOf(env(), 300).ask("x")).rejects.toThrow("zsh did not answer in 0.3 s");
  });
});
