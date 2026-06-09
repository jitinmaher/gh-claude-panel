import { PRContext } from "../github/pr-context";

interface Props {
  prCtx: PRContext | null;
}

export function ContextChips({ prCtx }: Props) {
  if (!prCtx) {
    return (
      <div className="context-chips">
        <span className="chip">no PR detected — open a PR to attach context</span>
      </div>
    );
  }
  const kb = Math.round(prCtx.totalDiffChars / 1024);
  return (
    <div className="context-chips">
      <span className="chip chip-primary">
        {prCtx.owner}/{prCtx.repo} #{prCtx.number}
      </span>
      <span className="chip">{prCtx.files.length} files</span>
      <span className="chip">{kb} KB diff</span>
    </div>
  );
}
