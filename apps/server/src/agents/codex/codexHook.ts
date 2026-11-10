export function codexHookSource(connectionFile: string) {
  return `const fs = require('node:fs');
const http = require('node:http');
let input = '';
let size = 0;
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  size += Buffer.byteLength(chunk);
  if (size <= 2 * 1024 * 1024) input += chunk;
});
process.stdin.on('end', () => {
  try {
    if (size > 2 * 1024 * 1024) return;
    const event = JSON.parse(input);
    const connection = JSON.parse(fs.readFileSync(${JSON.stringify(connectionFile)}, 'utf8'));
    const tool = event.tool_input || {};
    const text = value => typeof value === 'string' ? value.slice(0, 8192) : undefined;
    const body = JSON.stringify({
      session_id: event.session_id,
      cwd: event.cwd,
      hook_event_name: event.hook_event_name,
      turn_id: event.turn_id,
      agent_id: event.agent_id,
      model: event.model,
      last_assistant_message: typeof event.last_assistant_message === 'string' ? event.last_assistant_message.slice(0, 32768) : undefined,
      tool_name: event.tool_name,
      tool_use_id: event.tool_use_id,
      tool_failed: event.tool_response?.isError === true ||
        (typeof event.tool_response?.exit_code === 'number' && event.tool_response.exit_code !== 0) ||
        (typeof event.tool_response === 'string' && /(?:Process exited with code|Exit code:)\\s*[1-9][0-9]*/.test(event.tool_response)),
      tool_input: {
        command: text(tool.command || tool.cmd),
        file_path: text(tool.file_path || tool.path),
        description: text(tool.description),
      },
    });
    const request = http.request({
      socketPath: connection.socketPath,
      path: '/hook', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, response => {
      clearTimeout(connectTimer);
      let output = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { if (output.length < 16384) output += chunk; });
      response.on('end', () => {
        clearTimeout(timer);
        if (response.statusCode !== 200) return;
        try {
          const result = JSON.parse(output);
          if (event.hook_event_name === 'PermissionRequest' && result.hookSpecificOutput)
            process.stdout.write(JSON.stringify(result));
        } catch {}
      });
      response.on('error', () => { clearTimeout(timer); });
    });
    const connectTimer = setTimeout(() => request.destroy(), 1500);
    const timer = setTimeout(() => request.destroy(), event.hook_event_name === 'PermissionRequest' ? 295000 : 2000);
    request.on('socket', socket => socket.once('connect', () => clearTimeout(connectTimer)));
    request.on('error', () => { clearTimeout(connectTimer); clearTimeout(timer); });
    request.end(body);
  } catch {}
});
`;
}
