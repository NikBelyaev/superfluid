import { useState } from 'react';
import { Combobox } from '@base-ui/react/combobox';
import { Check, ChevronDown, GitBranch, Layers2 } from 'lucide-react';

function RepositoryBranchGroups({
  groups,
  collapsed,
  onToggle,
}: {
  groups: { label: string; items: string[] }[];
  collapsed: string[];
  onToggle: (label: string) => void;
}) {
  const branches = Combobox.useFilteredItems<string>();
  return groups
    .filter((g) => g.items.length)
    .map((g) => {
      const items = branches.filter((b) => b.startsWith('origin/') === (g.label === 'Remote'));
      const expanded = !collapsed.includes(g.label);
      if (!items.length && expanded) return null;
      return (
        <Combobox.Group items={items} key={g.label}>
          <Combobox.GroupLabel
            render={<button type="button" />}
            className="repository-branch-group-label"
            aria-hidden={false}
            aria-expanded={expanded}
            onFocus={(event) => {
              // Base UI normally redirects list focus back to the combobox input.
              event.stopPropagation();
            }}
            onMouseDown={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
            }}
            onClick={() => onToggle(g.label)}
          >
            <ChevronDown size={12} />
            {g.label}
          </Combobox.GroupLabel>
          <Combobox.Collection>
            {(b) => (
              <Combobox.Item className="repository-branch-option" value={b} key={b} title={b}>
                <GitBranch size={14} />
                <span>{b}</span>
                <Combobox.ItemIndicator>
                  <Check size={14} />
                </Combobox.ItemIndicator>
              </Combobox.Item>
            )}
          </Combobox.Collection>
        </Combobox.Group>
      );
    });
}

export function RepositoryBranchPicker({
  value,
  branches,
  label,
  placeholder,
  prefix,
  onChange,
  onOpen,
}: {
  value: string;
  branches: string[];
  label: string;
  placeholder?: string;
  prefix?: string;
  onChange: (value: string) => void;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const groups = [
    { label: 'Local', items: branches.filter((b) => !b.startsWith('origin/')) },
    { label: 'Remote', items: branches.filter((b) => b.startsWith('origin/')) },
  ];
  return (
    <Combobox.Root
      items={groups.filter((g) => !collapsed.includes(g.label)).flatMap((g) => g.items)}
      value={value || null}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) onOpen?.();
      }}
      onInputValueChange={(_value, details) => {
        if (details.reason === 'input-change' || details.reason === 'input-clear') setCollapsed([]);
      }}
      onValueChange={(v) => {
        if (v) onChange(v);
        setOpen(false);
      }}
    >
      <Combobox.InputGroup className="repository-branch-control" title={value || undefined}>
        {prefix ? (
          <span className="repository-branch-prefix">{prefix}</span>
        ) : (
          <GitBranch size={14} />
        )}
        <Combobox.Input aria-label={label} placeholder={placeholder} />
        <Combobox.Trigger aria-label={`Choose ${label}`}>
          <ChevronDown size={14} />
        </Combobox.Trigger>
      </Combobox.InputGroup>
      <Combobox.Portal>
        <Combobox.Positioner
          side="top"
          align="end"
          sideOffset={4}
          collisionPadding={8}
          className="repository-branch-positioner"
        >
          <Combobox.Popup className="repository-branch-options">
            <Combobox.Empty className="repository-branch-empty">
              {collapsed.length ? null : 'No matching branches.'}
            </Combobox.Empty>
            <Combobox.List>
              <RepositoryBranchGroups
                groups={groups}
                collapsed={collapsed}
                onToggle={(label) =>
                  setCollapsed((value) =>
                    value.includes(label) ? value.filter((g) => g !== label) : [...value, label],
                  )
                }
              />
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

export function RepositoryCreationPicker({
  value,
  onChange,
  worktree,
  onModeChange,
}: {
  value: string;
  onChange: (value: string) => void;
  worktree: boolean;
  onModeChange: (value: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Combobox.Root
      items={['branch', 'worktree']}
      filter={null}
      value={worktree ? 'worktree' : 'branch'}
      inputValue={value}
      open={open}
      onOpenChange={setOpen}
      onInputValueChange={(v, d) => {
        if (d.reason === 'input-change' || d.reason === 'input-clear') onChange(v);
      }}
      onValueChange={(v) => {
        if (v) onModeChange(v === 'worktree');
        setOpen(false);
      }}
    >
      <Combobox.InputGroup className="repository-branch-control" title={value || undefined}>
        {worktree ? <Layers2 size={14} /> : <GitBranch size={14} />}
        <Combobox.Input aria-label="New branch name" placeholder="New branch…" />
        <Combobox.Trigger aria-label="Creation options">
          <ChevronDown size={14} />
        </Combobox.Trigger>
      </Combobox.InputGroup>
      <Combobox.Portal>
        <Combobox.Positioner
          side="top"
          align="end"
          sideOffset={4}
          collisionPadding={8}
          className="repository-branch-positioner"
        >
          <Combobox.Popup className="repository-branch-options">
            <Combobox.List>
              {(v) => {
                const label = `${v === 'worktree' ? 'Create worktree' : 'Create branch'}${value.trim() ? ` ${value.trim()}` : ''}`;
                return (
                  <Combobox.Item
                    className="repository-branch-option"
                    value={v}
                    key={v}
                    title={label}
                  >
                    {v === 'worktree' ? <Layers2 size={14} /> : <GitBranch size={14} />}
                    <span>{label}</span>
                    <Combobox.ItemIndicator>
                      <Check size={14} />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                );
              }}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
