import { useEffect, useState } from 'react';
import { caseTags, saveCaseTag, type SVGCase } from '../../../features/svg-test-inputs/case-api';

export default function CaseTagEditor({ item, onSaved }: { item: SVGCase; onSaved: (item: SVGCase) => void }) {
  const [tag, setTag] = useState(item.tag);
  const [note, setNote] = useState(item.note);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setTag(item.tag); setNote(item.note); }, [item.tag, item.note]);

  async function save() {
    if (saving) { return; }
    const saved = { ...item, tag, note: tag === '' ? '' : note };

    setSaving(true);
    try {
      await saveCaseTag(saved.name, saved.tag, saved.note);
      setNote(saved.note);
      onSaved(saved);
      setMessage('分类已保存。');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ui-callout space-y-2">
      <label className="text-xs flex items-center gap-2">
        案例分类
        <select aria-label="案例分类" className="ui-input" disabled={saving} value={tag} onChange={event => setTag(event.target.value)}>
          {caseTags.map(entry => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
        </select>
      </label>
      <input
        className="ui-input w-full" aria-label="案例备注" value={note} maxLength={500} disabled={saving}
        onChange={event => setNote(event.target.value)} placeholder="分类原因或定位备注"
      />
      <button className="ui-btn ui-btn-secondary" disabled={saving} onClick={() => { void save(); }}>保存分类</button>
      {message !== '' && <p role="status" className="text-xs">{message}</p>}
    </div>
  );
}
