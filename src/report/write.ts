import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Writes a report so that nothing ever sees half of it: a temporary file in the
 * same directory, then a rename, which is atomic on one file system. Missing
 * parent directories are created. Throws on failure, leaving no temporary file.
 */
export function writeReportFile(path: string, text: string): void {
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.cliprobe-${process.pid}.tmp`;
    try {
        writeFileSync(temp, text);
        renameSync(temp, path);
    } catch (error) {
        rmSync(temp, { force: true });
        throw error;
    }
}
