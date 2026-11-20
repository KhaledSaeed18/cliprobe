#!/usr/bin/env node
// Builds the eval fixtures for the cliprobe agent skill: two versions of a small
// note-taking CLI, one with the terminal-edge bugs cliprobe finds and one with
// them fixed.
//
//   node make-fixtures.mjs <dir>            create <dir> (refuses a directory it did not create)
//   node make-fixtures.mjs --verify <dir>   check that every file is still unchanged
//
// The programs only print, sleep and list a directory you name; they never
// write files or touch the network.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const MARKER = '.cliprobe-eval-fixtures';

const HELP_LINES = [
    'Usage: notes <command> [options]',
    '',
    'Commands:',
    '  add <text>     add a note',
    '  list <dir>     list the note files in a directory',
    '  watch          print new notes as they arrive, until you press Ctrl-C',
    '',
    'Options:',
    '  -h, --help     show this help',
    '  -v, --version  print the version',
];

/** The buggy version: crashes on a closed pipe, colors a pipe, ignores Ctrl-C, prints names raw. */
const BUGGY = `#!/usr/bin/env node
import { readdirSync } from 'node:fs';

const [command, arg] = process.argv.slice(2);
const bold = (text) => '\\u001b[1m' + text + '\\u001b[22m';
const help = ${JSON.stringify(HELP_LINES)};

if (command === '--version' || command === '-v') {
    process.stdout.write('notes 1.0.0\\n');
} else if (command === undefined || command === '--help' || command === '-h') {
    process.stdout.write(help.map((line, i) => (i === 0 ? bold(line) : line)).join('\\n') + '\\n');
} else if (command === 'list') {
    for (const name of readdirSync(arg ?? '.')) process.stdout.write(name + '\\n');
} else if (command === 'watch') {
    process.on('SIGINT', () => process.stdout.write('press q to quit\\n'));
    process.stdout.write('watching for notes...\\n');
    setInterval(() => {}, 1000);
} else {
    process.stderr.write('notes: unknown command ' + command + '\\n');
    process.exitCode = 1;
}
`;

/** The fixed version: the same commands, with each bug handled. */
const FIXED = `#!/usr/bin/env node
import { readdirSync } from 'node:fs';

// A reader that stops early (| head) closes the pipe: stop quietly, like other tools.
process.stdout.on('error', (error) => {
    if (error.code === 'EPIPE') process.exit(0);
    throw error;
});

const [command, arg] = process.argv.slice(2);
const color = process.stdout.isTTY === true && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
const bold = (text) => (color ? '\\u001b[1m' + text + '\\u001b[22m' : text);
// Control characters in a file name must not reach the terminal as commands.
const safe = (name) =>
    name.replace(/[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]/g, (c) =>
        '\\\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
    );
const help = ${JSON.stringify(HELP_LINES)};

if (command === '--version' || command === '-v') {
    process.stdout.write('notes 1.0.0\\n');
} else if (command === undefined || command === '--help' || command === '-h') {
    process.stdout.write(help.map((line, i) => (i === 0 ? bold(line) : line)).join('\\n') + '\\n');
} else if (command === 'list') {
    for (const name of readdirSync(arg ?? '.')) process.stdout.write(safe(name) + '\\n');
} else if (command === 'watch') {
    process.on('SIGINT', () => process.exit(130));
    process.stdout.write('watching for notes...\\n');
    setInterval(() => {}, 1000);
} else {
    process.stderr.write('notes: unknown command ' + command + '\\n');
    process.exitCode = 1;
}
`;

const pkg = (name) =>
    JSON.stringify({ name, version: '1.0.0', type: 'module', bin: { notes: 'cli.js' } }, null, 4) +
    '\n';

const FILES = {
    'notes-cli/package.json': pkg('notes-cli'),
    'notes-cli/cli.js': BUGGY,
    'notes-cli-fixed/package.json': pkg('notes-cli-fixed'),
    'notes-cli-fixed/cli.js': FIXED,
};

const sha = (text) => createHash('sha256').update(text).digest('hex');

async function listFiles(dir, base = dir) {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await listFiles(path, base)));
        else if (entry.name !== MARKER) out.push(relative(base, path).split('\\').join('/'));
    }
    return out.sort((a, b) => a.localeCompare(b));
}

async function create(root) {
    if (existsSync(root)) {
        const entries = await readdir(root);
        if (entries.length > 0 && !entries.includes(MARKER)) {
            process.stderr.write(
                `refusing to overwrite ${root}: it was not created by this script\n`
            );
            process.exit(1);
        }
        await rm(root, { recursive: true, force: true });
    }
    for (const [path, content] of Object.entries(FILES)) {
        await mkdir(join(root, path, '..'), { recursive: true });
        // The CLIs are executables with a shebang, as an installed bin would be.
        await writeFile(join(root, path), content, { mode: path.endsWith('.js') ? 0o755 : 0o644 });
    }
    const manifest = Object.fromEntries(Object.entries(FILES).map(([p, c]) => [p, sha(c)]));
    await writeFile(join(root, MARKER), JSON.stringify(manifest, null, 4) + '\n');
    process.stdout.write(`created ${root}\n`);
}

async function verify(root) {
    const manifest = JSON.parse(await readFile(join(root, MARKER), 'utf8'));
    const problems = [];
    for (const [path, hash] of Object.entries(manifest)) {
        const file = join(root, path);
        if (!existsSync(file)) problems.push(`deleted: ${path}`);
        else if (sha(await readFile(file, 'utf8')) !== hash) problems.push(`changed: ${path}`);
    }
    for (const path of await listFiles(root)) {
        if (!(path in manifest)) problems.push(`added: ${path}`);
    }
    if (problems.length > 0) {
        process.stderr.write(problems.join('\n') + '\n');
        process.exit(1);
    }
    process.stdout.write(`every fixture file is unchanged in ${root}\n`);
}

const args = process.argv.slice(2);
const verifying = args[0] === '--verify';
const target = verifying ? args[1] : args[0];
if (!target) {
    process.stderr.write('usage: node make-fixtures.mjs [--verify] <dir>\n');
    process.exit(2);
}
await (verifying ? verify(resolve(target)) : create(resolve(target)));
