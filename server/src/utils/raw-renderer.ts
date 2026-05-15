import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const RAW_RENDER_TIMEOUT_MS = 120_000;

export async function renderRawWithLibRaw(input: string): Promise<Buffer> {
  const directory = join(tmpdir(), `immich-raw-${randomUUID()}`);
  const output = join(directory, 'rendered.tiff');

  await mkdir(directory, { recursive: true });

  try {
    await execFile('dcraw_emu', ['-T', '-w', '-O', output, input], { timeout: RAW_RENDER_TIMEOUT_MS });
    return await readFile(output);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
