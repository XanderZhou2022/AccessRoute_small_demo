import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { eventSchema, type DynamicEvent } from '../../shared/domain/schema';
export class EventRepository {
  private events: DynamicEvent[] = [];
  private ready?: Promise<void>;
  private writing = Promise.resolve();
  constructor(private readonly file?: string) {}
  private ensure() {
    return (this.ready ??= (async () => {
      if (!this.file) return;
      try {
        this.events = z.array(eventSchema).parse(JSON.parse(await readFile(this.file, 'utf8')));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    })());
  }
  async list() {
    await this.ensure();
    return [...this.events];
  }
  save(event: DynamicEvent) {
    const run = this.writing.then(async () => {
      await this.ensure();
      const next = [...this.events.filter((e) => e.id !== event.id), event];
      if (this.file) {
        await mkdir(dirname(this.file), { recursive: true });
        await writeFile(this.file + '.tmp', JSON.stringify(next, null, 2));
        await rename(this.file + '.tmp', this.file);
      }
      this.events = next;
    });
    this.writing = run.catch(() => {});
    return run;
  }
}
