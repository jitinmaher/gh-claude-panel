import { PRContext } from "../github/pr-context";

interface Props {
  prCtx: PRContext | null;
  onPick: (prompt: string) => void;
}

const QUICK_PROMPTS = [
  "Review this PR end-to-end. Flag bugs, regressions, and risky changes.",
  "Summarize what this PR does in 3 bullet points.",
  "What test coverage is missing for these changes?",
  "Suggest a clearer commit message and PR title.",
];

export function EmptyState({ prCtx, onPick }: Props) {
  if (!prCtx) {
    return (
      <div className="empty-state">
        <div className="empty-state-heading">Open a GitHub pull request</div>
        <div className="empty-state-sub">
          The panel attaches the PR's diff and metadata to every message you send.
        </div>
      </div>
    );
  }
  return (
    <div className="empty-state">
      <div className="empty-state-heading">
        Ready to review {prCtx.owner}/{prCtx.repo} #{prCtx.number}
      </div>
      <div className="quick-actions">
        {QUICK_PROMPTS.map((p) => (
          <button key={p} onClick={() => onPick(p)}>
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
