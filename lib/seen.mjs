import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA_VERSION = 1;

export class Seen {
  constructor(path, data) {
    this.path = path;
    this.data = data;
  }

  static load(path) {
    if (!existsSync(path)) {
      return new Seen(path, { schema_version: SCHEMA_VERSION, last_run_at: null, notes: {} });
    }
    try {
      const raw = readFileSync(path, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed.notes || typeof parsed.notes !== 'object') throw new Error('bad shape');
      return new Seen(path, {
        schema_version: parsed.schema_version ?? SCHEMA_VERSION,
        last_run_at: parsed.last_run_at ?? null,
        notes: parsed.notes,
      });
    } catch {
      return new Seen(path, { schema_version: SCHEMA_VERSION, last_run_at: null, notes: {} });
    }
  }

  has(noteId) {
    return Object.prototype.hasOwnProperty.call(this.data.notes, noteId);
  }

  get(noteId) {
    return this.data.notes[noteId];
  }

  noteIds() {
    return Object.keys(this.data.notes);
  }

  markSeen(noteId, { title, firstSeen }) {
    if (this.has(noteId)) return;
    this.data.notes[noteId] = {
      first_seen: firstSeen.toISOString(),
      title: String(title ?? ''),
      verdict: null,
    };
  }

  setVerdict(noteId, verdict) {
    if (!this.has(noteId)) return;
    this.data.notes[noteId].verdict = verdict;
  }

  setLastRunAt(date) {
    this.data.last_run_at = date.toISOString();
  }

  gc(maxAgeDays, now = new Date()) {
    const cutoff = now.getTime() - maxAgeDays * 86400_000;
    for (const [id, entry] of Object.entries(this.data.notes)) {
      const firstSeenMs = Date.parse(entry.first_seen);
      if (firstSeenMs < cutoff) delete this.data.notes[id];
    }
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf8');
  }
}
