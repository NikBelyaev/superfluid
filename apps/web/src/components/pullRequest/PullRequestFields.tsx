import { useId } from 'react';

export interface PullRequestFieldsValue {
  title: string;
  body: string;
  baseRefName: string;
  draft: boolean;
}
export function PullRequestFields({
  value,
  onChange,
  term = 'Request',
}: {
  value: PullRequestFieldsValue;
  onChange: (value: PullRequestFieldsValue) => void;
  term?: string;
}) {
  const id = useId();
  return (
    <>
      <div className="form-columns">
        <label>
          {term} title
          <input
            required
            maxLength={200}
            value={value.title}
            onChange={(e) => onChange({ ...value, title: e.target.value })}
          />
        </label>
        <label>
          Base branch
          <input
            required
            value={value.baseRefName}
            onChange={(e) => onChange({ ...value, baseRefName: e.target.value })}
          />
        </label>
      </div>
      <label htmlFor={`${id}-description`}>Description</label>
      <textarea
        id={`${id}-description`}
        maxLength={65536}
        value={value.body}
        onChange={(e) => onChange({ ...value, body: e.target.value })}
        rows={5}
      />
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={value.draft}
          onChange={(e) => onChange({ ...value, draft: e.target.checked })}
        />
        Draft
      </label>
    </>
  );
}
