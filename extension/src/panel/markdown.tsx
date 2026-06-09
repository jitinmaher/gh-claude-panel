import { ReactNode } from "react";

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

type Block =
  | { kind: "code"; lang: string; body: string }
  | { kind: "finding"; severity: Severity; body: string }
  | { kind: "heading"; level: number; body: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "p"; body: string }
  | { kind: "blank" };

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
        out.push({ kind: "finding", severity, body: body.join("\n") });
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
    case "finding": {
      const labels: Record<Severity, string> = {
        high: "High",
        medium: "Medium",
        low: "Low",
        info: "Info",
      };
      // First line of body may be a "Title — rest" header; treat first
      // line specially so it renders as the card's heading.
      const lines = b.body.split("\n");
      const heading = lines[0] ?? "";
      const rest = lines.slice(1).join("\n").trim();
      return (
        <div key={key} className={`md-finding md-finding-${b.severity}`}>
          <div className="md-finding-head">
            <span className={`md-finding-badge md-finding-badge-${b.severity}`}>
              {labels[b.severity]}
            </span>
            <span className="md-finding-title">{inline(heading)}</span>
          </div>
          {rest && <div className="md-finding-body">{parseBlocks(rest).map(renderBlock)}</div>}
        </div>
      );
    }
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
