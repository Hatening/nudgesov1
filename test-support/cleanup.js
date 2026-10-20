import fs from 'node:fs/promises';

export async function stopChild(child) {
  if (child && child.exitCode === null) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      try { child.kill('SIGTERM'); } catch { clearTimeout(timer); resolve(); }
    });
  }
}

export async function removeDir(dataDir) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await fs.rm(dataDir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 19) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

export async function stopChildAndRemove(child, dataDir) {
  await stopChild(child);
  await removeDir(dataDir);
}
