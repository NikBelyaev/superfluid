import { desktop } from '~/rpc/desktop';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  asyncDataLoaderFeature,
  dragAndDropFeature,
  hotkeysCoreFeature,
  renamingFeature,
  selectionFeature,
} from '@headless-tree/core';
import { useTree } from '@headless-tree/react';
import { Menu } from '@base-ui/react/menu';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileText,
  FilePlusCorner,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
  MoreHorizontal,
} from 'lucide-react';
import type { FileEntry, Session } from '@superfluid/contracts';
import { useApp, showSurface } from '~/state/workspaceStore';
import { TREE_ROW_HEIGHT, stickyTree } from './stickyTree';
import { activeFile } from '~/state/workspaceView';
import { moveFiles, renameFile } from '~/commands/files';
import { treeGit } from './treeGit';
import { TreeMenu } from './TreeMenu';
import { fileLabelClassName } from '~/components/vcs/fileLabels';

const collapsedItems: string[] = [];

export default function ProjectTree({ session }: { session: Session }) {
  const changes = useApp((a) => a.views[session.id].changes);
  return <ProjectFiles key={`${session.id}:${changes}`} session={session} changes={changes} />;
}

function ProjectFiles({ session, changes }: { session: Session; changes: boolean }) {
  const view = useApp((a) => a.views[session.id]);
  const status = useApp((a) => a.git[session.id]);
  const [error, setError] = useState('');
  const [fileMenu] = useState(() => Menu.createHandle<FileEntry>());
  const menuId = useId();
  const loaded = useRef(new Set<string>());
  const mounted = useRef(true);
  const draft = useRef<(FileEntry & { parent: string }) | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const saving = useRef(false);
  const mode = changes ? 'changes' : 'project';
  const initialOffset = useRef(view.fileTreeScroll?.[mode] ?? 0);
  const restoredScroll = useRef(false);
  const selected =
    changes && view.surface?.kind === 'diff'
      ? (view.surface.path ?? status?.files[0]?.path)
      : activeFile(view);
  const open = (path: string) => {
    if (changes) showSurface({ kind: 'diff', path });
    else void useApp.getState().openFile(path);
  };
  const tree = useTree<FileEntry>({
    rootItemId: '',
    state: { expandedItems: changes ? collapsedItems : view.expanded },
    setExpandedItems: (updater) => {
      const expanded = typeof updater === 'function' ? updater(view.expanded) : updater;
      const collapsed = view.expanded.find((path) => !expanded.includes(path));
      if (collapsed) {
        const item = tree.getItemInstance(collapsed);
        if (item.getItemMeta().index * TREE_ROW_HEIGHT < (virtualizer.scrollOffset ?? 0))
          virtualizer.scrollToIndex(item.getItemMeta().index, { align: 'start' });
      }
      useApp.getState().setView({ expanded }, session.id);
    },
    getItemName: (item) => (changes ? item.getId() : item.getItemData().name),
    isItemFolder: (item) => item.getItemData().directory,
    dataLoader: {
      getItem: (path) => ({
        name: path.split('/').at(-1) ?? '',
        path,
        directory: path === '',
        symlink: false,
      }),
      getChildrenWithData: async (path) => {
        try {
          const entries: FileEntry[] = changes
            ? (status?.files ?? []).map((file) => ({
                name: file.path,
                path: file.path,
                directory: false,
                symlink: false,
              }))
            : await desktop.call('files.list', { sessionId: session.id, path });
          loaded.current.add(path);
          if (draft.current?.parent === path) entries.unshift(draft.current);
          return entries.map((data) => ({ id: data.path, data }));
        } catch (error) {
          if (mounted.current) setError(error instanceof Error ? error.message : String(error));
          return [];
        }
      },
    },
    scrollToItem: (item) => {
      const index = item.getItemMeta()?.index;
      if (index !== undefined) virtualizer.scrollToIndex(index, { align: 'auto' });
    },
    canReorder: false,
    indent: 14,
    canDrag: (items): boolean =>
      !changes && !saving.current && !tree.isRenamingItem() && items.length > 0,
    canDrop: (items, target): boolean =>
      !changes &&
      !saving.current &&
      !tree.isRenamingItem() &&
      target.item.isFolder() &&
      items.some((item) => {
        const path = item.getId();
        return path.slice(0, Math.max(0, path.lastIndexOf('/'))) !== target.item.getId();
      }),
    onDrop: async (items, target) => {
      saving.current = true;
      setSubmitting(true);
      try {
        const moved = await moveFiles(
          session.id,
          items.map((item) => item.getId()),
          target.item.getId(),
        );
        if (!mounted.current) return;
        if (target.item.getId() && !target.item.isExpanded()) target.item.expand();
        await refresh();
        tree.setSelectedItems(moved);
      } catch (error) {
        useApp.getState().fail(error);
      } finally {
        saving.current = false;
        if (mounted.current) setSubmitting(false);
      }
    },
    hotkeys: {
      // Native scrolling can unmount a virtual row after the tree focuses it.
      focusFirstItem: { hotkey: 'Home', preventDefault: true },
      focusLastItem: { hotkey: 'End', preventDefault: true },
      customActivate: {
        hotkey: 'Enter',
        preventDefault: true,
        handler: (_event, tree) => {
          const item = tree.getFocusedItem();
          if (!item) return;
          if (item.isFolder()) {
            if (item.isExpanded()) item.collapse();
            else item.expand();
          } else open(item.getId());
        },
      },
      renameItem: {
        hotkey: 'F2',
        handler: (_event, tree) => {
          const path = tree.getFocusedItem()?.getId();
          if (path) startRename(path);
        },
      },
      selectAll: { hotkey: 'MetaOrControl+KeyA' },
      toggleSelectedItem: { hotkey: 'MetaOrControl+Space' },
    },
    canRename: () => !saving.current,
    features: [
      asyncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      dragAndDropFeature,
      renamingFeature,
      {
        key: 'file-name-editing',
        treeInstance: {
          abortRenaming: () => {
            if (saving.current) return;
            const entry = draft.current;
            const item = tree.getRenamingItem();
            if (!entry && !item) return;
            const inputFocused = item?.getElement()?.contains(document.activeElement);
            draft.current = null;
            // Headless Tree defers DOM focus; a pending return can cancel the next edit.
            tree.applySubStateUpdate('renamingItem', null);
            setError('');
            if (entry)
              tree
                .getItemInstance(entry.parent)
                .updateCachedChildrenIds(
                  tree.retrieveChildrenIds(entry.parent).filter((id) => id !== entry.path),
                );
            const focused = entry
              ? entry.parent
                ? tree.getItemInstance(entry.parent)
                : tree.getItems()[0]
              : item;
            tree.applySubStateUpdate('focusedItem', focused?.getId() ?? null);
            tree.setSelectedItems(focused ? [focused.getId()] : []);
            if (inputFocused) (focused?.getElement() ?? tree.getElement())?.focus();
          },
          completeRenaming: () => void completeEditing().catch(useApp.getState().fail),
        },
      },
      {
        key: 'file-tree-focus',
        treeInstance: {
          updateDomFocus: ({ prev, tree }) => {
            // An async drop must not take focus back from a menu or dialog opened meanwhile.
            const element = tree.getElement();
            if (!element?.contains(element.ownerDocument.activeElement)) return;
            if (!tree.getFocusedItem()?.getItemMeta())
              (
                tree.getSelectedItems().find((item) => item.getItemMeta()) ?? tree.getItems()[0]
              )?.setFocused();
            prev?.();
          },
        },
      },
    ],
  });
  const renameInput = useCallback(
    (input: HTMLInputElement | null) => {
      if (!input) return;
      input.focus();
      const dot = input.value.lastIndexOf('.');
      input.setSelectionRange(
        0,
        !tree.getRenamingItem()?.isFolder() && dot > 0 ? dot : input.value.length,
      );
    },
    [tree],
  );
  const startRename = (path: string) => {
    if (saving.current) return;
    tree.abortRenaming();
    const item = tree.getItemInstance(path);
    item.setFocused();
    item.startRenaming();
    tree.applySubStateUpdate('renamingValue', path.replace(/\/$/, '').split('/').at(-1) ?? '');
    virtualizer.scrollToIndex(item.getItemMeta().index, { align: 'auto' });
  };
  const items = tree.getItems();
  const layout = useMemo(() => stickyTree(items), [items]);
  const getItemKey = useCallback((index: number) => items[index].getId(), [items]);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => tree.getElement() as HTMLDivElement | null,
    estimateSize: () => TREE_ROW_HEIGHT,
    getItemKey,
    overscan: 10,
    initialOffset: initialOffset.current,
    scrollPaddingStart: (tree.getFocusedItem()?.getItemMeta()?.level ?? 0) * TREE_ROW_HEIGHT,
    rangeExtractor: layout.rangeExtractor,
  });
  const refresh = useCallback(async () => {
    setError('');
    for (const path of new Set(['', ...loaded.current].sort())) {
      const parent = path.slice(0, Math.max(0, path.lastIndexOf('/')));
      if (
        path &&
        (!loaded.current.has(parent) ||
          !tree
            .getItemInstance(parent)
            .getChildren()
            .some((item) => item.getId() === path))
      ) {
        loaded.current.delete(path);
        continue;
      }
      await tree.getItemInstance(path).invalidateChildrenIds(true);
    }
  }, [tree]);
  const create = async (parent: string, directory: boolean) => {
    if (saving.current) return;
    tree.abortRenaming();
    setError('');
    const entry = {
      path: `\0new-${crypto.randomUUID()}`,
      name: '',
      directory,
      symlink: false,
      parent,
    };
    draft.current = entry;
    const folder = tree.getItemInstance(parent);
    if (parent && !folder.isExpanded()) folder.expand();
    await tree.waitForItemChildrenLoaded(parent);
    if (!mounted.current || draft.current !== entry) return;
    const item = tree.getItemInstance(entry.path);
    item.updateCachedData(entry, true);
    if (directory) item.updateCachedChildrenIds([], true);
    folder.updateCachedChildrenIds([
      entry.path,
      ...tree.retrieveChildrenIds(parent).filter((id) => id !== entry.path),
    ]);
    tree.setSelectedItems([entry.path]);
    item.setFocused();
    item.startRenaming();
    virtualizer.scrollToIndex(item.getItemMeta().index, { align: 'auto' });
  };
  const completeEditing = async () => {
    const created = !!draft.current;
    const entry = draft.current ?? tree.getRenamingItem()?.getItemData();
    if (!entry || saving.current) return;
    const name = tree.getRenamingValue();
    if (!name.trim() || name === '.' || name === '..' || /[/\\\0]/.test(name)) {
      setError('Enter a file or folder name without path separators.');
      return;
    }
    const source = entry.path.replace(/\/$/, '');
    const parent = draft.current?.parent ?? source.slice(0, Math.max(0, source.lastIndexOf('/')));
    const path = [parent, name].filter(Boolean).join('/');
    if (!created && path === source) {
      tree.abortRenaming();
      return;
    }
    saving.current = true;
    setSubmitting(true);
    try {
      if (created)
        await desktop.call('files.create', {
          sessionId: session.id,
          path,
          directory: entry.directory,
        });
      else await renameFile(session.id, source, path);
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : String(error));
      saving.current = false;
      if (mounted.current) setSubmitting(false);
      return;
    }
    saving.current = false;
    if (!mounted.current) return;
    tree.abortRenaming();
    saving.current = true;
    try {
      await refresh();
      if (!mounted.current) return;
      tree.setSelectedItems([path]);
      tree.getItemInstance(path).setFocused();
      if (created) {
        useApp.setState((state) => ({ revision: state.revision + 1 }));
        await useApp.getState().refreshGit(session.id);
      }
      if (
        created &&
        !entry.directory &&
        mounted.current &&
        useApp.getState().sessionId === session.id
      )
        await useApp.getState().openFile(path);
    } finally {
      saving.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };
  const startCreate = (parent: string, directory: boolean) => {
    void create(parent, directory).catch(useApp.getState().fail);
  };
  const saveScroll = useCallback(() => {
    if (!restoredScroll.current) return;
    const current = useApp.getState();
    const view = current.views[session.id];
    if (view)
      current.setView(
        { fileTreeScroll: { ...view.fileTreeScroll, [mode]: virtualizer.scrollOffset ?? 0 } },
        session.id,
      );
  }, [session.id, mode, virtualizer]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      saveScroll();
    };
  }, [saveScroll]);
  useEffect(
    () =>
      desktop.onEvent((event) => {
        if (event.type === 'files.changed' && event.sessionId === session.id && !changes)
          void refresh();
      }),
    [tree, session.id, changes, refresh],
  );
  useEffect(() => {
    if (changes) void refresh();
  }, [changes, status?.files, refresh]);
  useEffect(() => {
    tree.setSelectedItems(selected ? [selected] : []);
  }, [tree, selected]);
  const focused = tree.getState().focusedItem;
  useEffect(() => {
    if (focused && !items.some((item) => item.getId() === focused))
      (tree.getSelectedItems().find((item) => items.includes(item)) ?? items[0])?.setFocused();
  }, [tree, items, focused]);
  useLayoutEffect(() => {
    if (
      restoredScroll.current ||
      !loaded.current.has('') ||
      items.some((item) => item.isExpanded() && !loaded.current.has(item.getId()))
    )
      return;
    virtualizer.scrollToOffset(initialOffset.current);
    restoredScroll.current = true;
  }, [items, virtualizer]);
  const git = useMemo(() => treeGit(status?.files), [status?.files]);
  const containerProps = tree.getContainerProps(changes ? 'Changed files' : 'Project files');
  const loading =
    (!loaded.current.has('') && !error) || tree.getState().loadingItemChildrens.length > 0;
  return (
    <section className="project-tree">
      <div className="sidebar-title">
        <button
          className="text-button"
          onClick={() => useApp.getState().setView({ changes: !changes }, session.id)}
        >
          {changes ? 'Changes' : 'Project'}
          <ChevronDown size={12} />
        </button>
        <div className="spacer" />
        <button
          className="icon-button"
          title="New file"
          disabled={changes || submitting}
          onClick={() => startCreate('', false)}
        >
          <FilePlusCorner size={15} />
        </button>
        <button
          className="icon-button"
          title="New folder"
          disabled={changes || submitting}
          onClick={() => startCreate('', true)}
        >
          <FolderPlus size={14} />
        </button>
        <button className="icon-button" title="Refresh project tree" onClick={() => void refresh()}>
          <RefreshCw size={13} />
        </button>
      </div>
      <div
        className="tree-root"
        data-drop-target={tree.getDragTarget()?.item.getId() === '' || undefined}
        onDragOver={containerProps.onDragOver}
        onDrop={containerProps.onDrop}
      >
        <ChevronDown size={13} />
        <FolderOpen size={15} />
        <span>{session.path.split('/').at(-1)}</span>
        {git.directories.has('') && (
          <span className="tree-git-dot" role="img" aria-label="Contains Git changes" />
        )}
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div
        {...containerProps}
        className="tree-scroll"
        tabIndex={items.length ? -1 : 0}
        aria-busy={loading || submitting}
        onScrollEnd={saveScroll}
        onKeyDownCapture={(event) => {
          // Headless Tree's navigation hotkeys require at least one item.
          if (
            !items.length &&
            ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', ' '].includes(
              event.key,
            )
          ) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <div
          style={{ height: virtualizer.getTotalSize(), position: 'relative', isolation: 'isolate' }}
        >
          {virtualizer.getVirtualItems().map(({ index, start, size }) => {
            const item = items[index];
            const entry = item.getItemData();
            const depth = item.getItemMeta().level;
            const end = layout.ends[index];
            const sticky =
              end > index + 1 && (virtualizer.scrollOffset ?? 0) + depth * size > start;
            const props = item.getProps();
            const change = git.getStatus(entry.path);
            const triggerId = `${menuId}:${entry.path}`;
            const row = (
              <div
                {...props}
                key={item.getKey()}
                data-path={entry.path}
                data-git-status={change}
                data-drop-target={item.isUnorderedDragTarget() || undefined}
                className={`tree-row ${sticky ? 'sticky' : ''} ${item.isSelected() ? 'selected' : ''}`}
                style={{
                  top: entry.directory ? depth * size : start,
                  paddingLeft: 12 + depth * 14 + (sticky ? 6 : 0),
                }}
                onFocus={() => item.setFocused()}
                onClick={(event) => {
                  if (item.isRenaming()) return;
                  if (sticky && entry.directory) {
                    virtualizer.scrollToIndex(index, { align: 'start' });
                    item.setFocused();
                    return;
                  }
                  props.onClick(event);
                  if (!entry.directory && !event.shiftKey && !event.metaKey && !event.ctrlKey)
                    open(entry.path);
                }}
                onContextMenu={(event) => {
                  if (item.isRenaming()) return;
                  event.preventDefault();
                  item.setFocused();
                  fileMenu.open(triggerId);
                }}
              >
                {entry.directory && !item.isRenaming() ? (
                  <button
                    className="tree-twist"
                    tabIndex={-1}
                    aria-label={`${item.isExpanded() ? 'Collapse' : 'Expand'} ${entry.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      item.setFocused();
                      if (item.isExpanded()) item.collapse();
                      else item.expand();
                    }}
                  >
                    {item.isExpanded() ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                ) : (
                  <span className="tree-indent" />
                )}
                {entry.directory ? (
                  <Folder size={14} />
                ) : entry.name.endsWith('.py') ? (
                  <FileCode2 size={14} className="python-icon" />
                ) : (
                  <FileText size={13} />
                )}
                {item.isRenaming() ? (
                  <input
                    {...item.getRenameInputProps()}
                    ref={renameInput}
                    className="tree-name-input"
                    aria-label={
                      draft.current?.path === entry.path
                        ? entry.directory
                          ? 'New folder name'
                          : 'New file name'
                        : entry.directory
                          ? 'Folder name'
                          : 'File name'
                    }
                    placeholder={entry.directory ? 'Folder name' : 'File name'}
                    readOnly={submitting}
                    onClick={(event) => event.stopPropagation()}
                  />
                ) : (
                  <span className={`file-label ${fileLabelClassName(change)}`}>
                    {changes ? entry.path : entry.name}
                  </span>
                )}
                {!item.isRenaming() && (
                  <div className="tree-row-end">
                    {change && change !== 'ignored' && !entry.directory && (
                      <span className={`git-letter ${fileLabelClassName(change)}`} title={change}>
                        {change === 'added'
                          ? 'A'
                          : change === 'conflict'
                            ? '!'
                            : change[0].toUpperCase()}
                      </span>
                    )}
                    {entry.directory &&
                      (git.directories.has(entry.path) || change === 'untracked') && (
                        <span
                          className="tree-git-dot bg-git-modified"
                          role="img"
                          aria-label="Contains Git changes"
                        />
                      )}
                    <div
                      className="tree-actions"
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                      onDragStart={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                    >
                      {entry.directory && (
                        <>
                          <button
                            className="tree-action-button tree-inline-action"
                            tabIndex={item.isFocused() ? 0 : -1}
                            aria-label={`New file in ${entry.path}`}
                            title="New file"
                            disabled={submitting}
                            onKeyDownCapture={(event) => event.stopPropagation()}
                            onClick={() => startCreate(entry.path, false)}
                          >
                            <FilePlusCorner size={14} />
                          </button>
                          <button
                            className="tree-action-button tree-inline-action"
                            tabIndex={item.isFocused() ? 0 : -1}
                            aria-label={`New folder in ${entry.path}`}
                            title="New folder"
                            disabled={submitting}
                            onKeyDownCapture={(event) => event.stopPropagation()}
                            onClick={() => startCreate(entry.path, true)}
                          >
                            <FolderPlus size={14} />
                          </button>
                        </>
                      )}
                      {!entry.directory && (
                        <button
                          className="tree-action-button tree-inline-action"
                          tabIndex={item.isFocused() ? 0 : -1}
                          aria-label={`Rename ${entry.path}`}
                          title="Rename"
                          onKeyDownCapture={(event) => event.stopPropagation()}
                          onClick={() => startRename(entry.path)}
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                      <Menu.Trigger
                        id={triggerId}
                        handle={fileMenu}
                        payload={entry}
                        className="tree-action-button"
                        tabIndex={item.isFocused() ? 0 : -1}
                        aria-label={`Actions for ${entry.path}`}
                        title="More actions"
                        onKeyDownCapture={(event) => {
                          event.stopPropagation();
                          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                            event.preventDefault();
                            fileMenu.open(triggerId);
                          }
                        }}
                      >
                        <MoreHorizontal size={14} />
                      </Menu.Trigger>
                    </div>
                  </div>
                )}
              </div>
            );
            return entry.directory ? (
              <div
                key={item.getKey()}
                className="tree-branch"
                style={{ top: start, height: (end - index) * size, zIndex: items.length - index }}
              >
                {row}
              </div>
            ) : (
              row
            );
          })}
        </div>
        {!items.length && !error && (
          <div className="tree-empty">
            {loading ? 'Loading files…' : changes ? 'No local changes.' : 'This folder is empty.'}
          </div>
        )}
      </div>
      <TreeMenu
        handle={fileMenu}
        sessionId={session.id}
        create={startCreate}
        rename={startRename}
        submitting={submitting}
      />
    </section>
  );
}
