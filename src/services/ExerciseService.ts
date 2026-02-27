import axios from 'axios';
import { env } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { AppError } from '../middleware/errorHandler.js';

const log = createLogger('ExerciseService');

const API_BASE = 'https://api.api-ninjas.com/v1/exercises';

export interface ExerciseSearchOptions {
  type?: string;
  muscle?: string;
  difficulty?: string;
  offset?: number;
}

/**
 * API Ninjas exercise database client.
 * Exported as a singleton (`exerciseService`).
 */
class ExerciseService {
  private apiKey: string;

  constructor() {
    this.apiKey = env.API_NINJAS_KEY;
    log.info('ExerciseService initialised');
  }

  /**
   * Searches for exercises by name, muscle group, type, or difficulty.
   *
   * @param query — Exercise name search term
   * @param opts  — Optional filters
   */
  async search(query: string, opts: ExerciseSearchOptions = {}): Promise<any[]> {
    try {
      const { data } = await axios.get(API_BASE, {
        headers: { 'X-Api-Key': this.apiKey },
        params: { name: query, ...opts },
      });

      return data;
    } catch (err: any) {
      log.error({ err, query }, 'Exercise search failed');
      throw new AppError('Exercise search unavailable', 502, 'EXERCISE_SEARCH_FAILED');
    }
  }
}

/** Singleton — import this, don't instantiate the class directly */
export const exerciseService = new ExerciseService();
