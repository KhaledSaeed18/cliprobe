import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

function isExecutableFile(path: string): boolean {
    try {
        accessSync(path, constants.X_OK);
        return statSync(path).isFile();
    } catch {
        return false;
    }
}

/**
 * Where `command` would be found, as spawn() looks for it: a path with a slash
 * as given, otherwise each PATH entry in turn (an empty entry is the current
 * directory). Under a PTY, a missing command is only a line of shell output, so
 * the terminal checks ask first.
 */
export function findCommand(
    command: string,
    path: string = process.env['PATH'] ?? '/usr/bin:/bin'
): string | undefined {
    if (command.includes('/')) return isExecutableFile(command) ? command : undefined;
    for (const dir of path.split(delimiter)) {
        const candidate = join(dir || '.', command);
        if (isExecutableFile(candidate)) return candidate;
    }
    return undefined;
}
