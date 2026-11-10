import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { githubRequest, gitlabRequest } from './hostingFixtures';
import { git } from '../apps/server/src/vcs/gitCommand';

export async function createElectronFixture() {
  const require = createRequire(import.meta.url);

  const executablePath = process.env.SF_EXECUTABLE || require('electron');

  const launchArgs = process.env.SF_EXECUTABLE ? [] : [resolve('.')];

  const temp = await mkdtemp(join(tmpdir(), 'superfluid-electron-'));

  const project = join(temp, 'fluid-lab');

  await mkdir(project);

  await writeFile(
    join(project, 'models.py'),
    'class Store:\n    def count(self) -> int:\n        return 42\n',
  );

  await writeFile(
    join(project, 'main.py'),
    'from models import Store\n\nstore = Store()\nprint(store.count())\n',
  );

  await writeFile(
    join(project, 'README.md'),
    '# Fluid lab\n\nA real Python fixture for Superfluid.\n',
  );

  await writeFile(join(project, 'bom.py'), '\ufeffvalue = 1\r\n');

  await git(project, ['init', '-b', 'main']);

  await git(project, ['config', 'user.name', 'Superfluid Test']);

  await git(project, ['config', 'user.email', 'test@superfluid.invalid']);

  await git(project, ['add', '.']);

  await git(project, ['commit', '-m', 'Initial fixture']);
  await writeFile(join(project, 'README.md'), '# Fluid lab\n\nPending documentation changes.\n');

  await git(project, [
    'remote',
    'add',
    'origin',
    'https://github.com/superfluid-tests/fluid-lab.git',
  ]);

  const bin = join(temp, 'bin');

  await mkdir(bin);

  const prFixture = { ...githubRequest, body: '## Summary\n\nKeep each worktree independent.' };

  const prPatch =
    'diff --git a/models.py b/models.py\nindex 1234567..abcdef0 100644\n--- a/models.py\n+++ b/models.py\n@@ -1,3 +1,3 @@\n-class Store:\n+class Inventory:\n     def count(self) -> int:\n         return 42\n';

  const ghState = join(temp, 'github.json');
  const glState = join(temp, 'gitlab.json');
  const jobOutput =
    '\x1b[31mFAILED tests/test_state.py\x1b[0m\nAssertionError: expected 42\n<script>plain log text</script>\n';
  await writeFile(ghState, JSON.stringify(prFixture));
  await writeFile(
    glState,
    JSON.stringify({
      ...gitlabRequest,
      detailed_merge_status: 'ci_must_pass',
      head_pipeline: {
        id: 12,
        project_id: 12,
        status: 'failed',
        sha: gitlabRequest.sha,
        web_url: 'https://gitlab.example.test/platform/editor/-/pipelines/12',
      },
      jobs: [
        {
          id: 20,
          name: 'compile',
          status: 'success',
          stage: 'build',
          web_url: 'https://gitlab.example.test/platform/editor/-/jobs/20',
          started_at: '2026-11-07T12:00:00Z',
          finished_at: '2026-11-07T12:00:04Z',
          duration: 4,
          allow_failure: false,
          pipeline: { id: 12 },
        },
        {
          id: 21,
          name: 'tests',
          status: 'failed',
          stage: 'test',
          web_url: 'https://gitlab.example.test/platform/editor/-/jobs/21',
          started_at: '2026-11-07T12:00:04Z',
          finished_at: '2026-11-07T12:00:13Z',
          duration: 9,
          allow_failure: false,
          pipeline: { id: 12 },
        },
      ],
      Discussions: gitlabRequest.Discussions.map((discussion) => ({
        ...discussion,
        notes: discussion.notes.map((note) =>
          note.system
            ? {
                ...note,
                body: 'added 2 commits\n\n<ul><li>6e8d826d - Preserve &lt;worktree&gt; state</li></ul>\n\n[Compare with previous version](/platform/editor/-/merge_requests/42/diffs)',
              }
            : note,
        ),
      })),
    }),
  );
  for (const cli of ['gh', 'glab'])
    await writeFile(
      join(bin, cli),
      '#!' +
        process.execPath +
        '\n' +
        `
  const fs = require('node:fs');
  const args = process.argv.slice(2);
  const file = ${JSON.stringify(cli === 'gh' ? ghState : glState)};
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  const gitlab = ${cli === 'glab'};
  fs.appendFileSync(file+'.calls', JSON.stringify(args)+String.fromCharCode(10));
  function respond() {
  if(args[0] === '--version') console.log(gitlab ? 'glab 1.128.0' : 'gh version 2.80.0');
  else if(args[0] === 'auth') console.log(JSON.stringify(value.signedOut ? (gitlab ? {hosts:[]} : {hosts:{}}) : gitlab ? {hosts:[{host:'gitlab.example.test',user:'fluid-dev',state:'success'}]} : {hosts:{'github.com':[{login:'fluid-dev',active:true,state:'success'}]}}));
  else if(args[0] === 'repo') { if(value.denyRepository) { console.error('Project access denied by fixture'); process.exit(1); } console.log(JSON.stringify(gitlab ? {id: 11, default_branch: args[2].includes('/people/') ? 'main' : 'develop',merge_method:value.mergeSettings?.method || 'merge',squash_option:value.mergeSettings?.squash || 'default_on',forked_from_project:args[2].includes('/people/') ? {path_with_namespace:'platform/editor'} : null} : {defaultBranchRef: {name: 'main'},parent:null})); }
  else if(args[1] === 'list') { const branch = args.indexOf('--source-branch'); console.log(JSON.stringify(value.filterBranch && ((branch >= 0 && args[branch+1] !== value.source_branch) || (value.state !== 'opened' && !args.includes('--all'))) ? [] : [gitlab && value.listWithoutChecks ? {...value,sha:null,head_pipeline:null,pipeline:null} : value])); }
  else if(args[1] === 'view') { if(value.failRead) { console.error('Refresh rejected by fixture'); process.exit(1); } console.log(JSON.stringify(value)); }
  else if(args[1] === 'merge') {
   if(value.failMerge) { console.error('Merge rejected by fixture'); process.exit(1); }
   const pin = args.indexOf(gitlab ? '--sha' : '--match-head-commit');
   if(pin < 0 || args[pin+1] !== value[gitlab ? 'sha' : 'headRefOid']) { console.error('Head changed'); process.exit(1); }
   value.mergeAttempts = (value.mergeAttempts || 0) + 1;
   if(args.includes('--disable-auto')) value.autoMergeRequest = null;
   else if(args.includes('--auto-merge=true') || args.includes('--auto')) { if(gitlab) value.merge_when_pipeline_succeeds = true; else value.autoMergeRequest = {enabledAt:'2026-11-07T14:00:00Z'}; }
   else value.state = gitlab ? 'merged' : 'MERGED';
   fs.writeFileSync(file,JSON.stringify(value));
  }
  else if(args[0] === 'api' && args[1].startsWith('repos/') && args[1].split('/').length === 3) console.log(JSON.stringify({allow_merge_commit:true,allow_squash_merge:true,allow_rebase_merge:true,allow_auto_merge:true,permissions:{push:true}}));
  else if(args[0] === 'api' && args[1].endsWith('/cancel_merge_when_pipeline_succeeds')) { value.merge_when_pipeline_succeeds = false; value.mergeAttempts = (value.mergeAttempts || 0)+1; fs.writeFileSync(file,JSON.stringify(value)); console.log('{}'); }
  else if(args[0] === 'api' && args[1] === 'graphql') console.log(JSON.stringify({data:{project:{mergeRequest:{diffStatsSummary:{additions:1394,deletions:544}}}}}));
  else if(args[0] === 'api' && args[1].includes('/repository/commits/')) console.log(JSON.stringify([{old_path:'commit.py',new_path:'commit.py',new_file:true,deleted_file:false,diff:'@@ -0,0 +1 @@'+String.fromCharCode(10)+'+print("selected commit")'+String.fromCharCode(10)}]));
  else if(args[0] === 'api' && args[1].includes('/pipelines/12/jobs')) { if(value.failJobs) { console.error('HTTP 403 insufficient_granular_scope Pipeline: Read'); process.exit(1); } console.log(JSON.stringify(value.jobs.map(job => job.status === 'failed' && value.head_pipeline.status === 'running' ? {...job,status:'running',finished_at:null,duration:null} : job))); }
  else if(args[0] === 'api' && args[1].includes('/jobs/')) { if(args[1].endsWith('/trace')) { if(value.failTrace) { console.error('HTTP 403 insufficient_granular_scope Job: Read'); process.exit(1); } process.stdout.write(${JSON.stringify(jobOutput)}); } else console.log(JSON.stringify(value.jobs.find(job=>args[1].endsWith('/jobs/'+job.id)))); }
  else if(args[0] === 'api') { let body=''; process.stdin.on('data', chunk => body += chunk); process.stdin.on('end', () => { value.description=JSON.parse(body).description;fs.writeFileSync(file,JSON.stringify(value)); }); }
  else if(args[1] === 'diff') process.stdout.write(${JSON.stringify(prPatch)});
  else if(args[1] === 'update' || args[1] === 'edit') {
   if(value.failUpdate) { console.error('Update rejected by fixture'); process.exit(1); }
   let body=''; process.stdin.on('data', chunk => body += chunk); process.stdin.on('end', () => {
    const title = args.indexOf('--title'); if(title >= 0) value.title = args[title+1];
    const base = args.indexOf(gitlab ? '--target-branch' : '--base'); if(base >= 0) value[gitlab ? 'target_branch' : 'baseRefName'] = args[base+1];
    if(args.includes('--draft')) value.draft = true;
    if(args.includes('--ready')) value.draft = false;
    if(args.includes('--description-file') || args.includes('--body-file')) value[gitlab ? 'description' : 'body'] = body;
    const updatedKey = gitlab ? 'updated_at' : 'updatedAt'; value[updatedKey] = new Date(Date.parse(value[updatedKey])+1000).toISOString(); fs.writeFileSync(file,JSON.stringify(value));
   });
  } else if(args[1] === 'note' || args[1] === 'comment') {
   let body=''; process.stdin.on('data', chunk => body += chunk); process.stdin.on('end', () => {
    value.commentAttempts = (value.commentAttempts || 0) + 1;
    if (value.failComment) { fs.writeFileSync(file,JSON.stringify(value)); console.error('Comment rejected by fixture'); process.exit(1); }
    if (gitlab) value.Discussions.push({id:'posted-'+value.commentAttempts,notes:[{id:200+value.commentAttempts,author:{username:'fluid-dev'},body,created_at:'2026-11-07T14:00:00Z',system:false}]});
    else value.comments.push({id:'posted-'+value.commentAttempts,author:{login:'fluid-dev'},body,createdAt:'2026-11-07T14:00:00Z'});
    fs.writeFileSync(file,JSON.stringify(value));
   });
  }
  else if(args[1] === 'ready') { value.isDraft = args.includes('--undo'); fs.writeFileSync(file,JSON.stringify(value)); }
  else process.exit(2);
  }
  const phase = args[0] === 'mr' && args[1] === 'view' ? (args.includes('--comments') ? 'discussion' : 'read') : args[1] === 'diff' ? 'diff' : args[1] === 'list' ? 'list' : null;
  const gate = phase && (!value.gateRepository || process.cwd().endsWith('/'+value.gateRepository)) && value.gates?.[phase];
  if (gate && !fs.existsSync(gate)) {
   fs.writeFileSync(gate+'.started', '');
   let released = false;
   const release = () => { if (released || !fs.existsSync(gate)) return; released = true; watcher.close(); respond(); };
   const watcher = fs.watch(require('node:path').dirname(gate), release);
   release();
  } else respond();
  `,
      { mode: 0o755 },
    );

  await mkdir('test-results', { recursive: true });

  const launchEnv: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

  launchEnv.SF_DATA_DIR = join(temp, 'data');
  launchEnv.CODEX_HOME = join(temp, 'codex-home');

  launchEnv.SF_TEST = '1';

  launchEnv.PATH = bin + ':' + launchEnv.PATH;

  if (process.env.SF_EXECUTABLE) launchEnv.SF_DEV_URL = 'https://untrusted.invalid';

  delete launchEnv.ELECTRON_RUN_AS_NODE;

  let app = await electron.launch({
    executablePath,
    args: [...launchArgs, '--project=' + project],
    env: launchEnv,
    timeout: 30000,
  });

  let nativeOutput = '';

  let appProcess = app.process();

  const captureNativeOutput = () => {
    appProcess = app.process();
    appProcess.stderr?.on('data', (chunk) => {
      nativeOutput = (nativeOutput + chunk.toString()).slice(-16384);
    });
  };

  captureNativeOutput();

  async function closeApp() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        app.close(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  'Electron did not finish safe shutdown within 30 seconds.\n' + nativeOutput,
                ),
              ),
            30000,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const errors: string[] = [];

  return {
    get app() {
      return app;
    },
    temp,
    project,
    prFixture,
    ghState,
    glState,
    errors,
    async firstWindow() {
      const page = await app.firstWindow();
      const window = await app.browserWindow(page);
      assert.equal(
        await window.evaluate((window) => window.isVisible()),
        process.env.SF_TEST_VERBOSE === '1',
      );
      await window.dispose();
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      return page;
    },
    async reopen() {
      await closeApp();
      app = await electron.launch({
        executablePath,
        args: launchArgs,
        env: launchEnv,
        timeout: 30000,
      });
      captureNativeOutput();
    },
    async captureFailure() {
      const page = await app.firstWindow();
      await page.screenshot({ path: 'test-results/failure.png' }).catch(() => {});
      console.error('Electron fixture:', temp);
      console.error('Error toasts:', await page.locator('.toast').allTextContents());
      console.error('Renderer errors:', errors);
      console.error('Native output:', nativeOutput);
    },
    async dispose(failed: boolean) {
      try {
        if (!failed) await closeApp();
      } finally {
        if (appProcess.exitCode === null)
          await app.evaluate(({ app }) => app.exit(1)).catch(() => {});
      }
    },
  };
}
