// PostToolUse hook: lints a JS file right after the agent edited or wrote it.
// Reads the hook event JSON from stdin; on lint errors it blocks with the report
// so the agent sees and fixes them.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let file;
  try {
    const input = JSON.parse(raw);
    file = input.tool_input && (input.tool_input.file_path || input.tool_input.path);
  } catch (e) {
    return;
  }
  if (!file || !/\.(js|cjs|mjs)$/i.test(file)) return;

  const root = process.env.DEVIN_PROJECT_DIR || process.cwd();
  const abs = path.resolve(root, file);
  const eslint = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
  const r = spawnSync(process.execPath, [eslint, '--no-warn-ignored', abs], { cwd: root, encoding: 'utf8' });
  if (r.status === 0) return;
  console.log(JSON.stringify({ decision: 'block', reason: 'ESLint failed for ' + file + ':\n' + (r.stdout || r.stderr) }));
});
