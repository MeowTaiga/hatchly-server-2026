import { createLogger } from '../config/logger.js';

const log = createLogger('Scheduler');

type JobFn = () => Promise<void>;
interface RegisteredJob {
  name: string;
  fn: JobFn;
  intervalMs: number;
  handle?: ReturnType<typeof setInterval>;
}

const jobs: RegisteredJob[] = [];

/**
 * Registers a periodic job. Call before start().
 *
 * @param name — Label for logging
 * @param fn — Async function to run (errors are caught and logged)
 * @param intervalMs — Milliseconds between runs
 */
export function registerJob(name: string, fn: JobFn, intervalMs: number): void {
  jobs.push({ name, fn, intervalMs });
}

async function runJob(job: RegisteredJob): Promise<void> {
  try {
    await job.fn();
  } catch (err) {
    log.error({ err, job: job.name }, 'Scheduled job failed');
  }
}

/**
 * Starts all registered jobs. Call after DB connect and WebSocket setup.
 */
export function startScheduler(): void {
  for (const job of jobs) {
    runJob(job);
    job.handle = setInterval(() => runJob(job), job.intervalMs);
    log.info({ job: job.name, intervalMs: job.intervalMs }, 'Job started');
  }
}

/**
 * Stops all jobs. Call before DB disconnect on shutdown.
 */
export function stopScheduler(): void {
  for (const job of jobs) {
    if (job.handle) {
      clearInterval(job.handle);
      job.handle = undefined;
    }
  }
  log.info('Scheduler stopped');
}
