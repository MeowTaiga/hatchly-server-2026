import { execSync } from 'child_process';
import { createServer } from 'http';
import express from 'express';
import { env, isDev } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { applySecurity } from './middleware/security.js';
import { globalErrorHandler, AppError } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { setupWebSocket } from './websocket/index.js';
import { registerAllJobs } from './jobs/index.js';
import { startScheduler, stopScheduler } from './services/SchedulerService.js';
import authRoutes from './routes/auth.js';
import petsRoutes from './routes/pets.js';
import usersRoutes from './routes/users.js';
import subscriptionRoutes from './routes/subscription.js';
import foodRoutes from './routes/food.js';
import weightRoutes from './routes/weight.js';
import waterRoutes from './routes/water.js';
import fastingRoutes from './routes/fasting.js';
import goalsRoutes from './routes/goals.js';
import moodRoutes from './routes/mood.js';
import achievementRoutes from './routes/achievements.js';
import adminRoutes from './routes/admin.js';
import gameRoutes from './routes/game.js';
import friendsRoutes from './routes/friends.js';
import mailRoutes from './routes/mail.js';
import notificationsRoutes from './routes/notifications.js';
import chatRoutes from './routes/chat.js';
import waitlistRoutes from './routes/waitlist.js';
import analyticsRoutes from './routes/analytics.js';
import devAuthRoutes from './routes/devAuth.js';

// ─── Crash traps — catch EVERYTHING so we see the real error ─────────────────

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
  process.exit(1);
});

// ─── Port Cleanup (Windows + nodemon fix) ────────────────────────────────────

function killPort(port: number): void {
  try {
    if (process.platform === 'win32') {
      const out = execSync(
        `netstat -ano | findstr :${port} | findstr LISTENING`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
      );
      const pids = new Set(
        out.trim().split('\n')
          .map((line) => line.trim().split(/\s+/).pop())
          .filter((pid): pid is string => !!pid && pid !== String(process.pid)),
      );
      for (const pid of pids) {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        logger.info(`Killed zombie process ${pid} on port ${port}`);
      }
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' });
    }
  } catch {
    // No process found or already dead — that's fine
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  await connectDatabase();
  registerAllJobs();
  startScheduler();

  const app = express();

  // Correct client IPs behind Vercel / nginx / Cloudflare
  app.set('trust proxy', 1);

  applySecurity(app);
  app.use(apiLimiter);

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/auth', authRoutes);
  app.use('/pets', petsRoutes);
  app.use('/users', usersRoutes);
  app.use('/subscription', subscriptionRoutes);
  app.use('/food', foodRoutes);
  app.use('/weight', weightRoutes);
  app.use('/water', waterRoutes);
  app.use('/fasting', fastingRoutes);
  app.use('/goals', goalsRoutes);
  app.use('/mood', moodRoutes);
  app.use('/achievements', achievementRoutes);
  app.use('/admin', adminRoutes);
  app.use('/game', gameRoutes);
  app.use('/friends', friendsRoutes);
  app.use('/mail', mailRoutes);
  app.use('/notifications', notificationsRoutes);
  app.use('/chat', chatRoutes);
  app.use('/waitlist', waitlistRoutes);
  app.use('/analytics', analyticsRoutes);

  if (isDev) {
    app.use('/dev-auth', devAuthRoutes);
    logger.warn('Dev auth routes enabled at /dev-auth — never run this in production');
  }

  app.use((req, _res, next) => {
    next(new AppError(`Route ${req.method} ${req.originalUrl} not found`, 404, 'NOT_FOUND'));
  });

  app.use(globalErrorHandler);

  const server = createServer(app);
  setupWebSocket(server);

  // ── Listen with auto-recovery on port conflict ──────────────────────────
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.warn(`Port ${env.PORT} in use - killing zombie and retrying`);
      killPort(env.PORT);
      setTimeout(() => server.listen(env.PORT), 1000);
    } else {
      console.error('[SERVER ERROR]', err);
      process.exit(1);
    }
  });

  server.listen(env.PORT, () => {
    logger.info(`Server running on port ${env.PORT} [${env.NODE_ENV}]`);
  });

  // ── Track connections for clean shutdown ─────────────────────────────────
  const connections = new Set<import('net').Socket>();

  server.on('connection', (conn) => {
    connections.add(conn);
    conn.on('close', () => connections.delete(conn));
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`${signal} received — shutting down`);

    stopScheduler();
    for (const conn of connections) conn.destroy();

    server.close(async () => {
      try { await disconnectDatabase(); } catch { /* ignore */ }
      process.exit(0);
    });

    // Force exit after 2s — use exit code 0 so nodemon doesn't report "crashed"
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('[FATAL] Bootstrap failed:', err);
  process.exit(1);
});
