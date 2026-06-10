import { MODEL_CATALOG, isCatalogModel } from "../transports";

interface Props {
  value: string;
  onChange: (id: string) => void;
}

/**
 * Compact model picker for the panel header. Mirrors the options-page
 * picker but constrained to the catalog (no "Custom…" entry). If the
 * user has set a custom model via the options page, it surfaces as a
 * pinned "Custom: <id>" option at the top so they can see what's active
 * without leaving the panel.
 *
 * Applies to all three backends. The transports forward this value:
 *   - AnthropicCloud: passed as the `model` field in the Messages API call.
 *   - ClaudeLocal / CursorLocal: passed through the bridge protocol;
 *     the bridge invokes the CLI with --model.
 */
export function ModelPicker({ value, onChange }: Props) {
  const showCustom = !isCatalogModel(value);
  return (
    <select
      className="backend-picker model-picker"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title="Model"
    >
      {showCustom && <option value={value}>Custom: {value}</option>}
      {MODEL_CATALOG.map((group) => (
        <optgroup key={group.group} label={group.group}>
          {group.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
