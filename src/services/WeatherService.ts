import axios from 'axios';
import { env } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { AppError } from '../middleware/errorHandler.js';

const log = createLogger('WeatherService');

const API_BASE = 'https://api.openweathermap.org/data/2.5';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface CacheEntry {
  data: any;
  expiresAt: number;
}

/**
 * OpenWeatherMap API client with a 1-hour in-memory TTL cache.
 * Exported as a singleton (`weatherService`).
 */
class WeatherService {
  private apiKey: string;
  private cache = new Map<string, CacheEntry>();

  constructor() {
    this.apiKey = env.OPENWEATHER_API_KEY;
    log.info('WeatherService initialised');
  }

  /**
   * Returns a cache key for a lat/lng pair (rounded to 2 decimals
   * so nearby coordinates share a cache entry).
   */
  private cacheKey(lat: number, lng: number): string {
    return `${lat.toFixed(2)},${lng.toFixed(2)}`;
  }

  /**
   * Fetches current weather data for the given coordinates.
   * Results are cached for 1 hour per rounded lat/lng.
   *
   * @param lat — Latitude
   * @param lng — Longitude
   */
  async getCurrent(lat: number, lng: number): Promise<any> {
    const key = this.cacheKey(lat, lng);
    const cached = this.cache.get(key);

    if (cached && Date.now() < cached.expiresAt) {
      log.debug({ key }, 'Weather cache hit');
      return cached.data;
    }

    try {
      const { data } = await axios.get(`${API_BASE}/weather`, {
        params: {
          lat,
          lon: lng,
          appid: this.apiKey,
          units: 'imperial',
        },
      });

      this.cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      log.debug({ key }, 'Weather data fetched and cached');
      return data;
    } catch (err: any) {
      log.error({ err, lat, lng }, 'Failed to fetch weather');
      throw new AppError('Weather data unavailable', 502, 'WEATHER_FETCH_FAILED');
    }
  }
}

/** Singleton — import this, don't instantiate the class directly */
export const weatherService = new WeatherService();
