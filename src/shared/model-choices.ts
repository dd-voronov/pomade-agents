// The default models and effort levels the agent's page offers for a Claude Code agent — kept here
// alone, so the list changes in one place. The models are Claude Code's aliases (`settings.json`
// `model`), each always the latest of its family; a model the file names that is not here is still
// shown and kept. The effort levels are the values Claude Code's `effortLevel` takes.

export const CLAUDE_MODEL_CHOICES = ["opus", "sonnet", "haiku"] as const;

export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export function isEffortLevel(value: unknown): value is EffortLevel {
  return (EFFORT_LEVELS as readonly unknown[]).includes(value);
}
