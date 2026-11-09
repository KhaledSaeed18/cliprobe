import { build } from 'tsdown';

export default async function setup(): Promise<void> {
    await build({ logLevel: 'warn' });
}
