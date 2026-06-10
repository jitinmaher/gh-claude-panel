import { createContext, useContext } from "react";

/**
 * Cross-cutting state the FindingCard (and other deep components) needs
 * from App.tsx, without prop-drilling through ChatStream → Markdown →
 * FindingCard.
 *
 * Kept deliberately small: just the settings flags that affect rendering
 * and a per-finding "have we inserted this?" map. Anything bigger (the
 * full TransportSettings, the active backend) stays in App's local state.
 */
export interface PanelContextValue {
  /**
   * Whether to append the "Drafted via Pat Before I Merge" footer to
   * the comment text. Controlled by the appendDraftedBy setting.
   */
  appendDraftedBy: boolean;
  /**
   * Stable IDs of findings the user has clicked Insert on AND the
   * content script reported success for. Used to render an "Inserted"
   * badge instead of the Insert button on those cards.
   *
   * In-memory only — clears when the panel iframe reloads (which happens
   * when the user navigates between PRs anyway).
   */
  insertedFindings: Set<string>;
}

export const PanelContext = createContext<PanelContextValue>({
  appendDraftedBy: true,
  insertedFindings: new Set(),
});

export function usePanel(): PanelContextValue {
  return useContext(PanelContext);
}

/**
 * Stable identifier for a finding so we can record "we inserted this one"
 * across re-renders. Uses the fields that uniquely position the comment
 * (file + line + side + title) — the body might vary across streamed
 * chunks while the heading stays fixed.
 */
export function findingId(input: {
  file?: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
  title: string;
}): string {
  return `${input.file ?? "(no-file)"}:${input.line ?? 0}:${input.side ?? "RIGHT"}:${input.title}`;
}
