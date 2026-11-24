// The "Connected to" field: the total, then as many of the top projects as fit in brackets —
// `8 (■ pomade-agents, ■ Pomade, …)`. A name is cut with "…" right after its last letter (`cutName`);
// the total and the brackets never are. How many names fit, and how each is cut, is measured here
// from the field's own widths (`fitCount`), and again when the column resizes. The whole field is a
// button: it opens the agent's Projects tab.

import { useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { ProjectSwatch } from "../ProjectSwatch.tsx";
import { NAME_MAX_WIDTH, connectedTitle, connectedTotal, cutName, fitCount, type ConnectedProject } from "./connected-model.ts";
import styles from "./ConnectedTo.module.css";

export interface ConnectedToProps {
  agent: string;
  /** The agent's name in the tooltip. */
  agentName: string;
  /** Every connected project, ranked. */
  ranked: readonly ConnectedProject[];
  /** How many projects the workspace has: `All N` when every one offers the agent. */
  projects: number;
  /** At most this many names. */
  max: number;
  onOpen: () => void;
}

export function ConnectedTo({ agent, agentName, ranked, projects, max, onOpen }: ConnectedToProps): ReactElement {
  const button = useRef<HTMLButtonElement>(null);
  const candidates = useMemo(() => ranked.slice(0, max), [ranked, max]);
  const [fit, setFit] = useState<{ named: number; labels: readonly string[] }>({ named: candidates.length, labels: [] });
  const { named, labels } = fit;
  const shown = Math.min(named, candidates.length);

  useLayoutEffect(() => {
    const field = button.current;
    const column = field?.parentElement;
    if (!field || !column) return;
    const measure = (): void => {
      const items = [...field.querySelectorAll<HTMLElement>("[data-item]")];
      const more = field.querySelector<HTMLElement>("[data-more]");
      const total = field.querySelector<HTMLElement>("[data-sum]");
      const nameEl = items[0]?.querySelector<HTMLElement>("[data-name]");
      const text = document.createElement("canvas").getContext("2d");
      if (more === null || total === null || !nameEl || text === null) return;
      text.font = getComputedStyle(nameEl).font;
      const measureText = (value: string): number => text.measureText(value).width;
      // Everything at its natural width, then back: nothing paints in between.
      const hidden = [...items, more].map((el) => el.hidden);
      field.dataset.measure = "";
      for (const el of [...items, more]) el.hidden = false;
      const width = (el: HTMLElement): number => el.getBoundingClientRect().width;
      // What an item adds to its name: the swatch and the ", " before it.
      const extras = items.map((item) => width(item) - width(item.querySelector<HTMLElement>("[data-name]") ?? item));
      const cut = candidates.map((p) => cutName(p.name, NAME_MAX_WIDTH, measureText));
      const fixed = width(total) + [...field.querySelectorAll<HTMLElement>("[data-bracket]")].reduce((sum, el) => sum + width(el), 0);
      const moreWidth = width(more);
      // A pixel under the column's width: the canvas and the layout round text alike only to within it.
      const available = column.getBoundingClientRect().width - 1;
      const count = fitCount({ fixed, items: cut.map((label, i) => (extras[i] ?? 0) + measureText(label)), more: moreWidth, available, total: ranked.length });
      // One name that still does not fit is cut to the room there is.
      if (count === 1) {
        const room = available - fixed - (ranked.length > 1 ? moreWidth : 0) - (extras[0] ?? 0);
        cut[0] = cutName(candidates[0]?.name ?? "", Math.min(NAME_MAX_WIDTH, room), measureText);
      }
      [...items, more].forEach((el, i) => (el.hidden = hidden[i] ?? false));
      delete field.dataset.measure;
      setFit((prev) => (prev.named === count && prev.labels.length === cut.length && prev.labels.every((label, i) => label === cut[i]) ? prev : { named: count, labels: cut }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    return () => observer.disconnect();
  }, [candidates, ranked.length]);

  const title = connectedTitle(ranked, agentName);
  if (ranked.length === 0) {
    return (
      <button type="button" className={`${styles.field} ${styles.none}`} title={title} data-testid={`connected-${agent}`} data-total="0" onClick={onOpen} ref={button}>
        No projects
      </button>
    );
  }
  return (
    <button type="button" className={styles.field} title={title} data-testid={`connected-${agent}`} data-total={ranked.length} data-named={shown} onClick={onOpen} ref={button}>
      <span className={styles.total} data-sum>
        {connectedTotal(ranked.length, projects)}
      </span>
      <span className={styles.bracket} data-bracket>
        &nbsp;(
      </span>
      {candidates.map((project, i) => (
        <span key={project.id} className={styles.item} data-item hidden={i >= shown}>
          {i > 0 && <span className={styles.punct}>, </span>}
          <ProjectSwatch id={project.id} className={styles.swatch} />
          <span className={styles.name} data-name>
            {labels[i] ?? project.name}
          </span>
        </span>
      ))}
      <span className={styles.more} data-more hidden={ranked.length <= shown}>
        <span className={styles.punct}>, </span>…
      </span>
      <span className={styles.bracket} data-bracket>
        )
      </span>
    </button>
  );
}
