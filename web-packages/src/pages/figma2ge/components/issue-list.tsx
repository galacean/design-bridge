interface IssueListProps {
  title: string;
  items: Array<{ type: 'warning' | 'error'; message: string }>;
  onLocate: (message: string) => void;
  tone?: 'warn' | 'success';
}

export default function IssueList(props: IssueListProps) {
  const { title, items, onLocate, tone = 'warn' } = props;
  const base = tone === 'success' ? 'ui-callout-cyan' : 'ui-callout-gold';
  const titleColor = tone === 'success' ? 'text-[var(--cyan)]' : 'text-[var(--gold)]';

  return (
    <div className={`ui-callout px-3.5 py-3 ${base}`}>
      <div className={`ui-kicker mb-2 ${titleColor}`}>{title}</div>
      {items.length === 0 ? (
        <div className="text-[12px] text-[var(--cyan)]">✓ 未发现问题。</div>
      ) : (
        <ul className="space-y-1 max-h-[200px] overflow-auto">
          {items.map((issue, idx) => (
            <li
              key={`${title}-${issue.type}-${idx}`}
              className="flex items-start gap-2 text-[12px] leading-relaxed text-[var(--color-text-primary)]"
            >
              <span className="flex-1">
                [{issue.type}] {issue.message}
              </span>
              <button onClick={() => onLocate(issue.message)} className="ui-btn ui-btn-xs ui-btn-gold">
                定位
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
