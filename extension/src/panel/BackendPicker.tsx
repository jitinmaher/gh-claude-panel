import { BACKENDS, BackendId } from "../transports";

interface Props {
  value: BackendId;
  onChange: (id: BackendId) => void;
}

export function BackendPicker({ value, onChange }: Props) {
  return (
    <select
      className="backend-picker"
      value={value}
      onChange={(e) => onChange(e.target.value as BackendId)}
      title="Choose backend"
    >
      {BACKENDS.map((b) => (
        <option key={b.id} value={b.id}>
          {b.label}
        </option>
      ))}
    </select>
  );
}
