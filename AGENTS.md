# superfluid

<!-- Adapted from pingdotgg/t3code/AGENTS.md at 0ea3c0243fb5b3c07bb8c2bad01c1d3d0f5fde35 (MIT). License: THIRD_PARTY_NOTICES.md. -->

superfluid is a lightweight Python IDE for working in multiple Git branches and worktrees at once. An Electron app wraps the React/Vite client and a local Node workspace backend.

## What makes superfluid special?

### 1. Performance without compromise

Lots of apps have gotten bogged down with bad tech decisions and "slop". We regularly audit for performance regressions, often caused by sending too much data over IPC, CSS animations causing GPU spikes, lists being hard to render, and more. Make sure all changes are considerate of performance impact.

### 2. Multiple worktrees

Worktrees are independent working contexts. Open files, unsaved buffers, navigation history, processes, and Python environments belong to their worktree. Switching context must not stop a process or mix another worktree's state into the active one.

### 3. Multiple surfaces

The desktop app bundles the local backend and the web UI. The editor, project tree, command palette, floating island, and secondary surfaces are different entry points into the same capabilities. A feature must work consistently wherever it is exposed.

## A note from the maintainers

We like ambitious ideas, simple systems, and software that feels obvious. Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising.

Channel both "measure twice, cut once" and "yagni". Fight scope creep. Try to honor the dev's intent in both a minimal and realistic fashion.

The rest of this document is meant to help you navigate the codebase and make changes effectively. Think of these instructions less as "hard rules", more as "good defaults". The developer's preferences should be able to override anything here.

Be careful about accessing data, killing dev servers, and other things that may damage the live IDE instance that the contributor is using.

## A small glossary

We need to be on the same page with terminology. When communicating, use this language:

- **you** means the agent reading this file and changing superfluid.
- **we, us, and maintainers** mean the people building superfluid. These are who you are talking to now.
- **user** means the person using superfluid to work on their code.
- **client** means the React UI running inside the Electron desktop app.
- **project** means a workspace record rooted at a directory, with its associated repository and worktrees.
- **worktree** means one checked-out working directory, with its own Git index and working files.
- **session** means the durable editor and process context associated with a worktree.
- **surface** means a view such as an editor, terminal, diff, browser, or pull request.
- **superfluid home** means the Electron userData directory. `SF_DATA_DIR` can select an isolated data directory.

## The three ways to hurt yourself

1. **Killing by pattern.** Never `pkill -f`, `pgrep | kill`, or `kill` a PID you found by matching a name, path, or worktree string. Your own agent process has this worktree's path in its argv, and this machine runs several other dev servers at once. Kill only a PID you captured at spawn, or the owner of your port after confirming its working directory is your worktree. On macOS, use `lsof -nP -iTCP:<port> -sTCP:LISTEN` and `lsof -a -p <pid> -d cwd` for that confirmation.
2. **Writing to the live install.** The installed app's userData contains the developer's real database, drafts, and managed worktrees. Reading it and copying from it are fine, and a good way to get real test data (see Test data). Never start a development instance against it, never open it read-write, never clean it up. The same applies to the host IDE's live data.
3. **Baking in origins.** Do not bake development origins or machine-specific paths into the production renderer. Desktop workspace access goes through the typed preload bridge; the development URL belongs to the desktop/dev runner, not feature components.

## Hit every surface

The most common defect in this repo is a change that works on the path you tested and is missing everywhere else. Before calling frontend work done, walk this list and say which entries applied:

- **Entry points.** A behavior reachable from the editor is usually also reachable from the island, the command palette, and a keybinding. Fixing one is not fixing the feature.
- **Clients.** The web renderer and desktop shell share behavior, but Electron owns native dialogs, IPC, windows, and browser views. Keep those responsibilities separate.
- **Worktrees.** Check the active session, an inactive session, and a session reopened from durable state. Bind asynchronous work to its destination session, not whichever worktree is active when it finishes.
- **Contracts.** Anything crossing the process boundary is typed in `packages/contracts`. Change the schema and the server, web, and desktop all follow.
- **Reverse states.** If you added a way in, add the way out and the way to see it. Close needs reopen. Start needs stop. A one-way door is a bug.
- **Docs.** Check whether the change makes existing guidance inaccurate. Apply the [documentation rules](#documentation) before adding anything.

## Dev servers

- `rtk pnpm install` installs. It also runs the setup scripts for Electron and the bundled Python tooling; if module resolution looks broken, installation probably did not finish.
- `rtk pnpm dev` starts the web dev server, local backend, and Electron client. Use an explicit absolute `SF_DATA_DIR` pointing at disposable development data, not the installed app's home. The current dev runner does not automatically isolate state by worktree.
- Vite currently uses `http://127.0.0.1:5176`. Read the actual startup output; do not start another copy over an existing runner. Changes to bundled server or desktop code require restarting the runner.
- Stop what you started, by the PID you tracked. See rule 1.
- Need a second checkout? `git worktree add` it next to this worktree, not in `/tmp`. Remove it when done.

## Test data

An empty database is a bad test. Use representative projects, multiple worktrees, dirty buffers, and running processes in an isolated profile instead of pointing at live state:

- `tests/electron.ts` creates its own temporary projects and `SF_DATA_DIR`.
- If real data is necessary, take a consistent read-only SQLite snapshot before opening the copy. Do not copy only the main SQLite file while its WAL is live.
- Bring credentials or settings only if the flow under test needs them. GitHub fixture tests should not publish real commits, comments, or PRs.
- Copy in, never symlink. Data flows one way: into your sandbox, never back out.

## Verifying

- While you iterate, run the owning test file or case: `rtk pnpm exec tsx --test --test-name-pattern '<name>' apps/server/src/files/FileService.test.ts`. Build the backend first if the case runs a bundled worker.
- Use the existing scripts in `package.json`: `typecheck`, `lint`, `format:check`, `test`, `build`, and `test:electron`. Do not invent a successful check command or claim a tool is configured when it is not.
- Test behavior that can break, such as persistence and migrations, external-format parsing, process and protocol translation, permission guards, race fixes, and the logic a bug fix changed. Leave out tests for what types already guarantee, trivial logic, copy text, smoke runs that duplicate the same case, mock-call mirrors, callback wiring, and props rendered to static markup.
- Extend before you add. When an existing test or table covers the behavior, add a row or an assertion there. Write a new test only when no case fits.
- Test at one layer: the lowest one that fails on `main`. Do not repeat the case in a wrapper test or at each call site.
- **Do not run repo-wide checks unless the developer asks.** CI owns the full suite. Pick checks that exercise the changed behavior.
- Backend behavior changes ship with focused tests for that behavior.
- Proof for a bug fix depends on the bug. Logic, data, state, and protocol bugs get a failing test first (the fewest that fail on `main` for that reason, in an existing case of the module's test file where one fits), then the fix. Purely visual bugs (spacing, colour, alignment, a layout shift) get before/after captures as their proof and no test: do not add UI tests for nitpicks, and do not ask for one in review when a capture already shows it. A server-only fix with no visible surface ships the test plus a short runtime transcript.
- Await the specific persisted result, event, queue item, or completion signal that marks the milestone. Never wait on arbitrary sleeps or polling. A test that needs a timeout to pass is wrong.
  - Where Effect is used, `it.effect` runs on a `TestClock`; `Effect.sleep` only advances through `TestClock.adjust`. `it.live` is wall-clock and only for subprocess or network fixtures.
  - No `yieldNow` or `sleep` polling loops. Await the `Deferred`, take from the `Queue`, or drain the worker.
  - No per-test timeout argument or `retry`. The project timeout is the ceiling, and flaky tests are fixed, not retried.
  - No `performance.now()` or `Date.now()` deltas in behavior tests. Assert on events and counts, not elapsed time. Dedicated performance measurements have a different purpose.
  - Browser tests assert through the test runner's observable assertions, never `requestAnimationFrame` or `transitionend`.
  - `vi.mock` factories must not spread a real module that pulls in Shiki or the diff workers.
  - Skipped tests need a tracking issue on the line above: `// quarantine: #1234 <why>`.
- Component browser tests belong beside their module as `*.browser.test.tsx` or `*.browser.test.ts`. Use disposable rendering and cleanup when adding that test layer; do not leave a mounted screen behind after a failed wait.
  - Acquire what the test drives after mounting (fake timers it advances, spies it sets up after mounting) after the render, so it disposes before the unmount. Anything the first render reads comes before it.
  - A helper that renders and then waits or clicks puts the screen in an `AsyncDisposableStack` and `move()`s it out only on success, so a failed wait still unmounts.
  - `rerender` needs a fresh element on every call.
  - No lifecycle hooks and no module-level mutable state. Shared mock state that `vi.mock` factories read is reset by a `setup()` call at the top of the test.
- User-visible frontend changes should get one integrated pass in the real Electron client. The primary agent does this once after integrating. Subagents do not launch their own dev servers.

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- Conventional commit titles, plain language: `fix(web): switching worktrees no longer spikes CPU`.
- Body: the problem in a sentence or two, then how you fixed it. End with the model and harness that did the work.
- UI changes need before/after images. Motion or timing needs a short video.
- Upload PR evidence to GitHub. Never commit PR-only screenshots or assets such as `.github/pr-assets/`.
- One request is one PR. Split it only when the maintainer asks.
- When babysitting: call `watch_pull_request` and end your turn. The host wakes you on checks, comments, or conflicts. Do not poll or sleep. Verify each bot finding against the source, fix real ones, dismiss false positives with a written reason. Stay quiet when nothing is new. Stop when the bots are green on the latest commit.

## Documentation

Most code changes do not need an internal documentation change. Agents can read the code.

- `docs/internals/` is for architectural decisions and their reasons, constraints that span components, and implementation traps that are hard to discover from the source. Before adding a paragraph, ask what a maintainer would get wrong without it. If reading the relevant code answers the question, leave it out.
- Do not document every feature, enumerate fields or methods, narrate control flow, maintain file catalogs, or append PR summaries. Types, tests, and code already record the implementation. The glossary defines shared vocabulary; it is not a feature index.
- A local reason the code can't show goes in a short nearby code comment. Use an internal doc when the reasoning crosses boundaries or needs context the code cannot carry well. Link to the relevant source instead of copying it.
- When a documented decision or constraint changes, rewrite or remove the affected text. Do not append another account of the new behavior. A new internal page needs a distinct, durable reason to exist.
- `docs/user/` helps users accomplish tasks. Give each major feature a concise section explaining what it does, how to start, and anything unintuitive. A settings path is useful; descriptions of visible buttons, icons, layouts, animations, or every UI state are not. Before adding text, ask what task or decision it helps the user with.
- Keep user docs in the shipped product's voice, without implementation details or contributor tooling. Update the relevant feature section when how to use it changes. A UI tweak does not need a documentation entry, and a new control does not need its own page.
- `docs/operations/` holds maintainer setup, release, and debugging procedures. Keep instructions for operating an installed superfluid app in the user guides.

## Plans and work artifacts

- Do not commit implementation plans, research notes, or agent scratch files. Keep temporary working material outside the worktree.
- Track active maintainer work in the GitHub issue or project item that owns it.
- A merged PR is the implementation record. Close or update its tracking item when the work lands; do not preserve a second checklist in the repository.

## How it works

The Electron renderer sends typed requests through the preload bridge. The desktop shell validates and routes workspace requests to the local backend. Domain services own project/worktree state, files and recovery, Git/GitHub operations, Python language tools, and terminals. SQLite stores durable state; PTY parsing and other expensive work stay outside the renderer. Native dialogs, window lifecycle, and isolated browser views remain in the desktop shell.

## Where code lives

Follow these boundaries when changing the code. Keep each feature and its tests with the module that owns it.

- `apps/server/src` — workspace services and their adapters. Group behavior by domain, as upstream does with `project`, `workspace`, `vcs`, `pullRequest`, `terminal`, and `persistence`. Keep startup/composition separate from those services.
- `apps/web/src` — React/Vite UI. Feature components live under `components/<feature>`, reusable primitives under `components/ui`, hooks under `hooks`, raw transport clients under `rpc`, and UI state under `state`. Keep feature logic and its tests near the owning feature.
- `apps/desktop/src` — Electron shell. Separate `app`, `window`, `ipc`, `backend`, and `preview` responsibilities instead of growing one main-process file. `preload` exposes the narrow typed bridge.
- `packages/contracts` — transport schemas plus small derived helpers. No heavy runtime logic.
- `packages/shared` — shared runtime utilities, subpath exports, no barrel. Extract genuinely shared behavior, not a second home for feature logic.
- `packages/ghostty` — terminal tooling boundary, including its upstream/vendor integration. Python language tooling lives in `apps/server/src/python` and uses the bundled Pyright dependency.
- Read-only upstream references are references, not runtime dependencies. Prefer their patterns over invented ones. Never edit or import application code directly from a reference checkout.

## Taste

- Complexity belongs at the adapter boundary. Orchestration stays pure, UI stays dumb.
- Keep raw transport clients behind `rpc/`. Client mutations use a shared typed command boundary; permissions and destination-session validation remain authoritative in the backend.
- Server features are services; transports stay thin. An IPC handler, worker message handler, or future HTTP route decodes input, calls one service method, and maps errors.
- `apps/web/src/components/ui` exports own their look. Pick a `variant` or `size`; do not restyle one with `className`. If none fits and the look is a generic concept, add a variant to the component; a look that belongs to one feature stays in that feature's own component, not in `components/ui`. Layout classes (width, flex, margin, position) belong on the parent.
- Where Effect is used, reusable functions use `Effect.fn("Service.operation")` with a stable span name, not a function wrapping `Effect.gen`. Keep `Effect.gen` for inline programs and layer construction. Use `Effect.fnUntraced` only when spans would be too frequent (stream chunks, per-event projection, tight loops) or duplicate an existing tracing boundary; explain that choice nearby. Named `Effect.fn` creates a span; the unnamed form does not. Preserve existing span names and options, and pass combinators as additional function-builder arguments.
- Inferred types over annotations. `any` is the enemy.
- Default to no comment. Write one only for a constraint, an external quirk, or an invariant the code can't show, in one line where you can and four at most. Don't restate names or signatures, narrate steps, record history, or explain the fix you just made; the PR carries that.
- React effects are for synchronizing with something outside React. Derive in render and act in handlers instead of syncing state, but don't hide real lifecycle work in refs or stores to dodge one. An effect that stays should have a concrete external synchronization reason.
- Our users work in the editor all day and notice a dropped frame, a lying spinner, and a stale label. No continuously repainting animations; they peg the GPU on high-refresh displays.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before breaking it.

## Additional tips

- Security is important, but should not be over-indexed on, especially for dev mode/maintainer-only features.

<!-- codebase-memory-mcp:start -->

# Codebase Knowledge Graph (codebase-memory-mcp)

This project uses codebase-memory-mcp to maintain a knowledge graph of the codebase.
ALWAYS prefer MCP graph tools over grep/glob/file-search for code discovery.

## Priority Order

1. `search_graph` — find functions, classes, routes, variables by pattern
2. `trace_path` — trace who calls a function or what it calls
3. `get_code_snippet` — read specific function/class source code
4. `query_graph` — run Cypher queries for complex patterns
5. `get_architecture` — high-level project summary

## When to fall back to grep/glob

- Searching for string literals, error messages, config values
- Searching non-code files (Dockerfiles, shell scripts, configs)
- When MCP tools return insufficient results

## Examples

- Find a handler: `search_graph(name_pattern=".*OrderHandler.*")`
- Who calls it: `trace_path(function_name="OrderHandler", direction="inbound")`
- Read source: `get_code_snippet(qualified_name="pkg/orders.OrderHandler")`

<!-- codebase-memory-mcp:end -->

<!-- headroom:rtk-instructions -->

# RTK (Rust Token Killer) - Token-Optimized Commands

When running shell commands, **always prefix with `rtk`**. This reduces context
usage by 60-90% with zero behavior change. If rtk has no filter for a command,
it passes through unchanged — so it is always safe to use.

## Key Commands

```bash
# Git (59-80% savings)
rtk git status          rtk git diff            rtk git log

# Files & Search (60-75% savings)
rtk ls <path>           rtk read <file>         rtk grep <pattern>
rtk find <pattern>      rtk diff <file>

# Test (90-99% savings) — shows failures only
rtk pytest tests/       rtk cargo test          rtk test <cmd>

# Build & Lint (80-90% savings) — shows errors only
rtk tsc                 rtk lint                rtk cargo build
rtk prettier --check    rtk mypy                rtk ruff check

# Analysis (70-90% savings)
rtk err <cmd>           rtk log <file>          rtk json <file>
rtk summary <cmd>       rtk deps                rtk env

# GitHub (26-87% savings)
rtk gh pr view <n>      rtk gh run list         rtk gh issue list

# Infrastructure (85% savings)
rtk docker ps          rtk kubectl get         rtk docker logs <c>

# Package managers (70-90% savings)
rtk pip list           rtk pnpm install        rtk npm run <script>
```

## Rules

- In command chains, prefix each segment: `rtk git add . && rtk git commit -m "msg"`
- For debugging, use raw command without rtk prefix
- `rtk proxy <cmd>` runs command without filtering but tracks usage

<!-- /headroom:rtk-instructions -->
