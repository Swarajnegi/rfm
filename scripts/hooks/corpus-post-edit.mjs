// Claude Code PostToolUse hook for Corpus edits (Edit / Write / MultiEdit).
//
// 1. A web/*.js file is syntax-checked the moment it is written. A broken
//    app.js otherwise surfaced ten minutes into `npm run verify`, or on the
//    phone. A failure exits 2, which hands the error straight back to Claude.
// 2. Touching money code or screens adds one line of context naming the
//    reviewer agent to run before shipping, so it happens without the user
//    having to ask.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
const file = String(input.tool_input?.file_path || '').replace(/\\/g, '/');
if (!/\/rfm_2\.0\//i.test(file)) process.exit(0);

if (/\/rfm_2\.0\/(web|src|scripts|worker)\/.*\.(m?js)$/i.test(file) && !/\/(vendor|plugins)\.js$|pdf\.worker/i.test(file)) {
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (r.status !== 0) {
        process.stderr.write(`node --check failed for ${file}:\n${(r.stderr || r.stdout).trim()}\n`);
        process.exit(2);
    }
}

const money = /\/rfm_2\.0\/web\/(app|parser|regenWealth|research)\.js$/i.test(file);
const screens = /\/rfm_2\.0\/(web\/index\.html|src\/.*\.css)$/i.test(file);
const notes = [];
if (money) notes.push('Corpus money/import/AI code changed: before shipping, run the money-auditor agent on this change.');
if (screens) notes.push('Corpus screens or CSS changed: before shipping, run the device-reviewer agent on the changed screens.');
if (notes.length) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notes.join(' ') } }));
}
process.exit(0);
