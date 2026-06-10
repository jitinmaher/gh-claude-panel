import { ReactNode } from "react";
import { findingId, usePanel } from "./PanelContext";

/** Repo URL for the "Drafted via" footer link. Single source of truth. */
const REPO_URL = "https://github.com/jitinmaher/pat-before-i-merge";

/**
 * Minimal markdown renderer tailored to assistant chat output.
 *
 * Supports: code fences (```), inline code (`x`), bold (**x**), italics (*x*),
 * bulleted lists (- or *), numbered lists, headings (# ##), paragraphs.
 *
 * Deliberately small — we don't need GFM tables, footnotes, etc.
 * Code is rendered as <pre><code> with a `data-lang` attribute so styling
 * can pick it up; we do not syntax-highlight.
 */
export function Markdown({ text }: { text: string }): JSX.Element {
  const blocks = parseBlocks(text);
  return <>{blocks.map((b, i) => renderBlock(b, i))}</>;
}

type Severity = "high" | "medium" | "low" | "info";

export interface FindingMeta {
  file?: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
  title: string;
  /** The pre-rendered body text (markdown). */
  body: string;
  severity: Severity;
}

type Block =
  | { kind: "code"; lang: string; body: string }
  | { kind: "finding"; finding: FindingMeta }
  | { kind: "heading"; level: number; body: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "p"; body: string }
  | { kind: "blank" };

/**
 * Pulls leading `key: value` lines off a finding block's body. Returns
 * the metadata and the remaining body. Stops at the first non-key line
 * or blank line.
 */
function parseFindingMeta(raw: string, severity: Severity): FindingMeta {
  const lines = raw.split("\n");
  let title: string | undefined;
  let file: string | undefined;
  let line: number | undefined;
  let side: "LEFT" | "RIGHT" | undefined;
  let i = 0;

  // Consume leading "key: value" lines. Stop at the first non-key line.
  while (i < lines.length) {
    const m = lines[i].match(/^(file|line|side|title)\s*:\s*(.+)$/i);
    if (!m) break;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "file") file = value;
    else if (key === "line") {
      const n = parseInt(value, 10);
      if (Number.isFinite(n)) line = n;
    } else if (key === "side") {
      const s = value.toUpperCase();
      if (s === "LEFT" || s === "RIGHT") side = s;
    } else if (key === "title") title = value;
    i++;
  }
  // Skip a blank separator line if present.
  if (i < lines.length && lines[i].trim() === "") i++;

  let body = lines.slice(i).join("\n").trim();

  // If no explicit title field, treat the first remaining line as the title.
  if (!title) {
    const split = body.split("\n");
    title = split[0] ?? "Finding";
    body = split.slice(1).join("\n").trim();
  }

  return {
    severity,
    file,
    line,
    side: side ?? (file && line ? "RIGHT" : undefined),
    title,
    body,
  };
}

const SEVERITY_ALIASES: Record<string, Severity> = {
  high: "high",
  critical: "high",
  bug: "high",
  error: "high",
  medium: "medium",
  warn: "medium",
  warning: "medium",
  risk: "medium",
  low: "low",
  nit: "low",
  suggestion: "low",
  info: "info",
  note: "info",
};

function parseBlocks(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Code fence (incl. finding:* shorthand for severity cards)
    const fence = line.match(/^```([\w:-]*)\s*$/);
    if (fence) {
      const lang = fence[1] ?? "";
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // skip closing fence (if present)
      const findingMatch = lang.match(/^finding:?(.+)?$/);
      if (findingMatch) {
        const key = (findingMatch[1] ?? "info").toLowerCase();
        const severity = SEVERITY_ALIASES[key] ?? "info";
        const finding = parseFindingMeta(body.join("\n"), severity);
        out.push({ kind: "finding", finding });
      } else {
        out.push({ kind: "code", lang, body: body.join("\n") });
      }
      continue;
    }

    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      out.push({ kind: "heading", level: h[1].length, body: h[2] });
      i++;
      continue;
    }

    // Unordered list (collect contiguous lines)
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      out.push({ kind: "ul", items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      out.push({ kind: "ol", items });
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      out.push({ kind: "blank" });
      i++;
      continue;
    }

    // Paragraph — collect until blank line or block starter
    const body: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^```/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i])
    ) {
      body.push(lines[i]);
      i++;
    }
    out.push({ kind: "p", body: body.join(" ") });
  }
  return out;
}

function renderBlock(b: Block, key: number): ReactNode {
  switch (b.kind) {
    case "code":
      return (
        <pre key={key} className="md-pre" data-lang={b.lang}>
          <code>{b.body}</code>
        </pre>
      );
    case "finding":
      return <FindingCard key={key} finding={b.finding} />;
    case "heading": {
      const sizes = ["", "md-h1", "md-h2", "md-h3", "md-h4", "md-h5", "md-h6"];
      const className = sizes[b.level] ?? "md-h6";
      const Tag = `h${Math.min(b.level, 6)}` as keyof JSX.IntrinsicElements;
      return (
        <Tag key={key} className={className}>
          {inline(b.body)}
        </Tag>
      );
    }
    case "ul":
      return (
        <ul key={key} className="md-ul">
          {b.items.map((it, idx) => (
            <li key={idx}>{inline(it)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={key} className="md-ol">
          {b.items.map((it, idx) => (
            <li key={idx}>{inline(it)}</li>
          ))}
        </ol>
      );
    case "p":
      return (
        <p key={key} className="md-p">
          {inline(b.body)}
        </p>
      );
    case "blank":
      return null;
  }
}

const SEVERITY_LABELS: Record<Severity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

function FindingCard({ finding }: { finding: FindingMeta }) {
  const { appendDraftedBy, insertedFindings } = usePanel();
  const canInsert = Boolean(finding.file && finding.line);
  const id = findingId(finding);
  const isInserted = insertedFindings.has(id);

  // The text we paste into GitHub's review comment box. Plain-text-ish
  // markdown — GitHub renders markdown in review comments. Prepend the
  // severity tag so the comment reader knows the level. The "Drafted
  // via" footer links back to the repo and is opt-out via the
  // appendDraftedBy setting.
  //
  // Footer uses a raw HTML anchor with target=_blank + rel=noopener so
  // the link opens in a new tab when clicked. NOTE: GitHub's markdown
  // sanitizer strips the `target` attribute from <a> tags in user-
  // submitted content in some surfaces (issues, READMEs); PR review
  // comments may behave differently. If GitHub strips it, the link
  // still works — just opens in the same tab — and reviewers can
  // Cmd/Ctrl-click for a new tab. The italics around it come from
  // wrapping the anchor in <em>, since asterisks-italic doesn't apply
  // across raw HTML in GitHub's markdown.
  const footer = appendDraftedBy
    ? `<em>Drafted via <a href="${REPO_URL}" target="_blank" rel="noopener noreferrer">Pat Before I Merge</a>.</em>`
    : "";
  const commentText = [
    `**[${SEVERITY_LABELS[finding.severity]}] ${finding.title}**`,
    finding.body,
    footer,
  ]
    .filter(Boolean)
    .join("\n\n");

  const onInsert = () => {
    window.parent.postMessage(
      {
        type: "gh-claude-insert-finding",
        findingId: id,
        file: finding.file,
        line: finding.line,
        side: finding.side ?? "RIGHT",
        text: commentText,
      },
      "*",
    );
  };

  const onPreview = () => {
    window.parent.postMessage(
      {
        type: "gh-claude-preview-finding",
        file: finding.file,
        line: finding.line,
        side: finding.side ?? "RIGHT",
      },
      "*",
    );
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(commentText);
      window.parent.postMessage(
        { type: "gh-claude-toast", text: "Copied to clipboard" },
        "*",
      );
    } catch {
      /* clipboard write blocked — ignore */
    }
  };

  return (
    <div className={`md-finding md-finding-${finding.severity}`}>
      <div className="md-finding-head">
        <span className={`md-finding-badge md-finding-badge-${finding.severity}`}>
          {SEVERITY_LABELS[finding.severity]}
        </span>
        <span className="md-finding-title">{inline(finding.title)}</span>
      </div>
      {finding.file && (
        <div className="md-finding-location">
          {canInsert ? (
            <button
              type="button"
              className="md-finding-location-btn"
              onClick={onPreview}
              title="Scroll to and highlight this line in the diff"
            >
              <code>
                {finding.file}
                {finding.line ? `:${finding.line}` : ""}
                {finding.side === "LEFT" ? " (removed line)" : ""}
              </code>
            </button>
          ) : (
            <code>
              {finding.file}
              {finding.line ? `:${finding.line}` : ""}
              {finding.side === "LEFT" ? " (removed line)" : ""}
            </code>
          )}
        </div>
      )}
      {finding.body && (
        <div className="md-finding-body">
          {parseBlocks(finding.body).map((blk, i) => renderBlock(blk, i))}
        </div>
      )}
      <div className="md-finding-actions">
        {canInsert && isInserted && (
          <span
            className="md-finding-inserted"
            title="This finding was staged as a draft review comment. Submit the review in GitHub when you're ready."
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              aria-hidden="true"
              focusable="false"
            >
              <path
                fill="currentColor"
                d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"
              />
            </svg>
            Inserted on line {finding.line}
          </span>
        )}
        {canInsert && !isInserted && (
          <button
            type="button"
            className="md-finding-btn md-finding-btn-primary"
            onClick={onInsert}
            title="Open GitHub's inline comment box on this line and stage as a review comment"
          >
            Insert on line {finding.line}
          </button>
        )}
        {canInsert && (
          <button
            type="button"
            className="md-finding-btn"
            onClick={onPreview}
            title="Scroll to and highlight this line in the diff"
          >
            Show in diff
          </button>
        )}
        {canInsert && isInserted && (
          <button
            type="button"
            className="md-finding-btn"
            onClick={onInsert}
            title="Re-insert this comment (e.g. if you deleted the previous draft)"
          >
            Re-insert
          </button>
        )}
        <button
          type="button"
          className="md-finding-btn"
          onClick={onCopy}
          title="Copy the comment text"
        >
          Copy
        </button>
      </div>
    </div>
  );
}

/** Inline tokens: `code`, **bold**, *italic*. Returned as a ReactNode array. */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  // Use a single regex that captures one of {code, bold, italic} at a time.
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(<strong key={i++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      parts.push(
        <code key={i++} className="md-code">
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      parts.push(<em key={i++}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
