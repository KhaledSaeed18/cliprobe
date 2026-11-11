// Asks a question with readline and waits for the answer, terminal or not.
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.question('Proceed? (y/n) ', (answer) => {
    process.stdout.write(`answer: ${answer}\n`);
    rl.close();
});
rl.on('close', () => process.exit(0));
