
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SUFFIXES = ['', '-wal', '-shm', '-journal'];

function removeAll(dbPath) {
  for (const suffix of SUFFIXES) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* war nicht da, gut so */ }
  }
}

export function freshTestDbPath(name) {
  const dbPath = path.join(os.tmpdir(), `aashiyana-${name}-${process.pid}.db`);
  removeAll(dbPath);
  process.env.DB_PATH = dbPath;



  // (der naechste Lauf raeumt ihn oben weg), aber 1,4 MB je Suite je Lauf

  process.on('exit', () => removeAll(dbPath));
  return dbPath;
}
