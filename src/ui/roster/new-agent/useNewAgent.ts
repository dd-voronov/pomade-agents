// The New agent page's conversations with the backend and Pomade: the name checked as it is typed
// (`roster.checkName`, debounced; an answer about a name no longer typed is dropped), the projects
// a new agent can be connected to (`project.list`, `project.getAgents`), the Create with its
// steps ticking (`roster.create`, `roster.creating`) and Check again (`roster.checkAlias`), and the
// new agent's tab: the backend opens it at the end of the Create; when the alias needed fixing,
// the page opens it once Check again passes (`agentTabs.launch`); Go to its tab focuses it
// (`agentTabs.focus`), or opens another when it was closed.

import { useCallback, useEffect, useRef, useState } from "react";
import { HostError, type HostClient } from "pomade-kit/sdk";

import {
  CREATE_STEP_IDS,
  ROSTER_CHECK_ALIAS_METHOD,
  ROSTER_CHECK_NAME_METHOD,
  ROSTER_CREATE_METHOD,
  ROSTER_CREATING_EVENT,
  isAliasCheck,
  isCreateAgentResult,
  isNameVerdictAnswer,
  isRosterCreating,
  type CreateAgentParams,
  type CreateAgentResult,
  type CreateStep,
  type NameVerdict,
} from "../../../shared/roster.ts";
import { NAME_CHECK_DELAY_MS, aliasChecked, answeredName, phaseOf, settledPhase, typedName, withOpen, type NameState, type Phase } from "./new-agent-model.ts";

/** A zsh that reads heavy rc files may take seconds; the backend gives it 15 s. */
const CHECK_TIMEOUT_MS = 20_000;
/** The broker's longest wait: a Create runs two fresh shells. */
const CREATE_TIMEOUT_MS = 60_000;

const reasonOf = (err: unknown): string => (err instanceof HostError ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err));

/** The name's state as typed: its rules at once, then — after a pause in typing — the backend's
 *  verdict on the folder and the shell. `refuse` sets the verdict a Create came back with. */
export function useNameCheck(host: HostClient, name: string): { state: NameState; refuse: (verdict: NameVerdict) => void } {
  const [verdict, setVerdict] = useState<NameVerdict | null>(null);
  const typed = typedName(name);
  const checking = typed.status === "checking";

  useEffect(() => {
    if (!checking) return;
    let current = true;
    const timer = setTimeout(() => {
      host.apps.call(host.welcome.appId, ROSTER_CHECK_NAME_METHOD, { name }, { timeoutMs: CHECK_TIMEOUT_MS }).then(
        (answer) => {
          if (current) setVerdict(isNameVerdictAnswer(answer) && answer.name === name ? answer : { name, problem: "shell-error", detail: "the app gave a malformed answer" });
        },
        (err: unknown) => {
          if (current) setVerdict({ name, problem: "shell-error", detail: reasonOf(err) });
        },
      );
    }, NAME_CHECK_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [host, name, checking]);

  const state = verdict === null ? typed : answeredName(typed, verdict);
  return { state, refuse: setVerdict };
}

/** A project the new agent can be connected to: one whose "+" menu lists its agents. */
export interface ConnectableProject {
  id: string;
  name: string;
  root: string;
  /** Its sidebar group's path, "Building tools / Tools"; "" when ungrouped. */
  group: string;
  /** The agents its "+" menu lists (`project.getAgents`' `visibleAgents`). */
  agents: string[];
}

export interface Connectable {
  projects: ConnectableProject[];
  /** Names of the projects that offer every agent already, in sidebar order. */
  offerEvery: string[];
}

/** The projects, in sidebar order, split into those to choose from and those offering every agent;
 *  `null` until Pomade answers. */
export function useConnectable(host: HostClient): Connectable | null {
  const [answer, setAnswer] = useState<Connectable | null>(null);
  useEffect(() => {
    let cancelled = false;
    let asked = 0;
    const ask = async (): Promise<void> => {
      const mine = ++asked;
      try {
        const { projects } = await host.project.list();
        const visible = await Promise.all(projects.map((p) => host.project.getAgents({ projectId: p.id }).then((a) => a.visibleAgents, (): string[] => [])));
        if (cancelled || mine !== asked) return;
        const next: Connectable = { projects: [], offerEvery: [] };
        projects.forEach((p, i) => {
          if (visible[i]?.includes("*") === true) next.offerEvery.push(p.name);
          else next.projects.push({ id: p.id, name: p.name, root: p.root, group: p.groupPath.join(" / "), agents: visible[i] ?? [] });
        });
        setAnswer(next);
      } catch {
        if (!cancelled && mine === asked) setAnswer({ projects: [], offerEvery: [] });
      }
    };
    const subscriptions = (["project.created", "project.renamed", "project.removed"] as const).map((event) => host.events.subscribe(event, () => void ask()));
    void ask();
    return () => {
      cancelled = true;
      for (const subscription of subscriptions) void subscription.then((s) => s.close()).catch(() => undefined);
    };
  }, [host]);
  return answer;
}

export interface CreateState {
  phase: Phase;
  steps: CreateStep[];
  result: CreateAgentResult | null;
  /** Why the Create's answer never came; `null` when it did. */
  lost: string | null;
  /** Check again is asking zsh. */
  checking: boolean;
  /** What the last Check again found, when the alias still does not resolve. */
  checkDetail: string | null;
  /** The new agent's tab; `null` until one is open. */
  tabId: string | null;
  /** Why Go to its tab found no tab to go to; `null` when it did. */
  tabProblem: string | null;
}

const NOT_STARTED: CreateStep[] = CREATE_STEP_IDS.map((id) => ({ id, state: "todo", detail: null }));
const INITIAL: CreateState = { phase: "edit", steps: NOT_STARTED, result: null, lost: null, checking: false, checkDetail: null, tabId: null, tabProblem: null };

export interface CreateAgent {
  state: CreateState;
  /** Run a Create; resolves with its answer, or `null` when none came. */
  create(params: Omit<CreateAgentParams, "createId">): Promise<CreateAgentResult | null>;
  checkAgain(): Promise<void>;
  /** Bring the new agent's tab to the front; open another when it is gone. */
  goToTab(): Promise<void>;
  /** Back to the form, its values kept. */
  edit(): void;
}

export function useCreateAgent(host: HostClient): CreateAgent {
  const [state, setState] = useState<CreateState>(INITIAL);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const update = useCallback((change: (s: CreateState) => CreateState) => {
    if (mounted.current) setState(change);
  }, []);

  const create = useCallback(
    async (params: Omit<CreateAgentParams, "createId">): Promise<CreateAgentResult | null> => {
      const createId = crypto.randomUUID();
      update(() => ({ ...INITIAL, phase: "creating" }));
      const subscription = await host.events
        .subscribe(`${host.welcome.appId}:${ROSTER_CREATING_EVENT}`, (payload) => {
          if (isRosterCreating(payload) && payload.createId === createId) update((s) => (s.phase === "creating" ? { ...s, steps: payload.steps } : s));
        })
        .catch(() => null);
      try {
        const answer = await host.apps.call(host.welcome.appId, ROSTER_CREATE_METHOD, { ...params, createId }, { timeoutMs: CREATE_TIMEOUT_MS });
        if (!isCreateAgentResult(answer)) throw new Error("the app gave a malformed answer");
        update((s) => ({ ...s, phase: phaseOf(answer), steps: answer.steps, result: answer, tabId: answer.tabId }));
        return answer;
      } catch (err) {
        update((s) => ({ ...s, phase: "failed", lost: reasonOf(err) }));
        return null;
      } finally {
        void subscription?.close().catch(() => undefined);
      }
    },
    [host, update],
  );

  const name = state.result?.name;
  const openIn = state.result?.openIn;

  /** Open the agent's tab in the project the Create chose; its id. */
  const launch = useCallback(async (): Promise<string> => {
    if (name === undefined || openIn === undefined) throw new Error("no agent was created");
    return (await host.agentTabs.launch({ agentId: name, projectId: openIn })).tabId;
  }, [host, name, openIn]);

  const checkAgain = useCallback(async (): Promise<void> => {
    if (name === undefined) return;
    update((s) => ({ ...s, checking: true }));
    let resolves = false;
    try {
      const answer = await host.apps.call(host.welcome.appId, ROSTER_CHECK_ALIAS_METHOD, { agent: name }, { timeoutMs: CHECK_TIMEOUT_MS });
      if (!isAliasCheck(answer)) throw new Error("the app gave a malformed answer");
      resolves = answer.ok;
      update((s) => (answer.ok ? { ...s, checking: false, checkDetail: null, steps: withOpen(aliasChecked(s.steps), "run") } : { ...s, checking: false, checkDetail: answer.detail }));
    } catch (err) {
      update((s) => ({ ...s, checking: false, checkDetail: reasonOf(err) }));
    }
    if (!resolves) return;
    // The alias resolves now: the tab the Create held back opens.
    try {
      const tabId = await launch();
      update((s) => {
        const steps = withOpen(s.steps, "done", "Opened");
        return { ...s, steps, tabId, phase: settledPhase(steps) };
      });
    } catch (err) {
      update((s) => {
        const steps = withOpen(s.steps, "fail", `The tab did not open: ${reasonOf(err)}`);
        return { ...s, steps, phase: settledPhase(steps) };
      });
    }
  }, [host, name, launch, update]);

  const goToTab = useCallback(async (): Promise<void> => {
    update((s) => ({ ...s, tabProblem: null }));
    const tabId = state.tabId;
    try {
      if (tabId !== null) {
        try {
          await host.agentTabs.focus(tabId);
          return;
        } catch (err) {
          // Closed since: open another.
          if (!(err instanceof HostError && err.code === "not-found")) throw err;
        }
      }
      const opened = await launch();
      update((s) => ({ ...s, tabId: opened }));
    } catch (err) {
      update((s) => ({ ...s, tabProblem: reasonOf(err) }));
    }
  }, [host, state.tabId, launch, update]);

  const edit = useCallback(() => update(() => INITIAL), [update]);

  return { state, create, checkAgain, goToTab, edit };
}
