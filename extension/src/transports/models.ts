/**
 * Catalog of Claude model IDs we expose in pickers.
 *
 * Grouped by family; within each family newest first. Sourced from the
 * claude-api skill on 2026-06-09. If Anthropic ships a new model, add
 * it here and both the panel header dropdown and the options-page
 * dropdown pick it up.
 *
 * The "Custom…" path on the options page lets users enter an ID we
 * don't ship in the catalog (older snapshots, retired aliases, proxy
 * IDs); the panel header dropdown is constrained to the catalog plus
 * whatever custom value the options page saved.
 */
export const MODEL_CATALOG: {
  group: string;
  models: { id: string; label: string }[];
}[] = [
  {
    group: "Opus (most capable)",
    models: [
      { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
      { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
      { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
      { id: "claude-opus-4-5", label: "Claude Opus 4.5" },
      { id: "claude-opus-4-1", label: "Claude Opus 4.1" },
    ],
  },
  {
    group: "Sonnet (balanced)",
    models: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    ],
  },
  {
    group: "Haiku (fastest)",
    models: [{ id: "claude-haiku-4-5", label: "Claude Haiku 4.5" }],
  },
];

export const CUSTOM_MODEL_SENTINEL = "__custom__";

export function isCatalogModel(id: string | undefined): boolean {
  if (!id) return true;
  return MODEL_CATALOG.some((g) => g.models.some((m) => m.id === id));
}
