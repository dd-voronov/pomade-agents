// Memory: the projects this agent keeps memory for — one row per project folder under its
// `projects/` that holds a `memory/` with files — and each file, which opens in Pomade's editor.

import { useMemo, type ReactElement } from "react";

import { ROSTER_MEMORY_METHOD, isAgentMemory } from "../../../shared/roster.ts";
import type { AgentContext } from "./agent-context.ts";
import { folderLabels } from "./memory-model.ts";
import { Section } from "./Section.tsx";
import styles from "./page.module.css";
import memory from "./memory-tab.module.css";
import { useAgentRead } from "./useAgentRead.ts";

export function MemoryTab({ context }: { context: AgentContext }): ReactElement {
  const { host, entry, revision, projects, roots, openFile } = context;
  const read = useAgentRead(host, ROSTER_MEMORY_METHOD, entry.id, isAgentMemory, revision);
  const labels = useMemo(() => folderLabels(projects.values(), roots), [projects, roots]);
  return (
    <Section title="Memory" testId="agent-memory">
      <div className={`${styles.block} ${styles.flush}`}>
        {read.status === "loading" && <p className={`${styles.none} ${styles.pad}`}>Reading the memory…</p>}
        {read.status === "refused" && <p className={`${styles.none} ${styles.pad}`}>This agent’s memory cannot be read: {read.reason}</p>}
        {read.status === "ready" && read.value.folders.length === 0 && (
          <p className={`${styles.none} ${styles.pad}`} data-testid="memory-empty">
            No project memory yet.
          </p>
        )}
        {read.status === "ready" &&
          read.value.folders.map((folder) => {
            const label = labels.get(folder.folder);
            return (
              <div key={folder.folder} className={memory.row} data-testid="memory-row">
                <span className={memory.project} title={label === undefined ? `A folder this workspace holds no project for: ${folder.folder}` : folder.folder}>
                  {label === undefined ? <span className={memory.unknown}>{folder.folder}</span> : <span className={memory.name}>{label}</span>}
                </span>
                <span className={memory.files}>
                  {folder.files.map((file) => (
                    <button key={file.path} type="button" className={styles.link} title={file.path} data-testid="memory-file" onClick={() => openFile(file.path)}>
                      {file.name}
                    </button>
                  ))}
                </span>
              </div>
            );
          })}
      </div>
    </Section>
  );
}
