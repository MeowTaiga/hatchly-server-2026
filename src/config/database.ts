import mongoose from 'mongoose';
import { env } from './env.js';
import { createLogger } from './logger.js';

const log = createLogger('Database');

/**
 * Connects Mongoose to the `hatchly` database.
 * Logs connection status and attaches event listeners for
 * disconnect / reconnect so we always know what the DB is doing.
 */
export async function connectDatabase(): Promise<void> {
  const uri = env.MONGODB_URI.endsWith('/')
    ? `${env.MONGODB_URI}hatchly`
    : `${env.MONGODB_URI}/hatchly`;

  try {
    await mongoose.connect(uri);
    log.info('Connected to MongoDB - database: hatchly');
  } catch (err) {
    log.fatal({ err }, 'Failed to connect to MongoDB');
    process.exit(1);
  }

  mongoose.connection.on('disconnected', () => {
    log.warn('MongoDB disconnected');
  });

  mongoose.connection.on('reconnected', () => {
    log.info('MongoDB reconnected');
  });

  mongoose.connection.on('error', (err) => {
    log.error({ err }, 'MongoDB connection error');
  });
}

/**
 * Gracefully closes the Mongoose connection.
 * Called during server shutdown.
 */
export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  log.info('MongoDB disconnected gracefully');
}
