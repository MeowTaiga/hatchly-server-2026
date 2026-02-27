import axios from 'axios';
import { env } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { AppError } from '../middleware/errorHandler.js';

const log = createLogger('FatSecretService');

const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token';
const API_BASE = 'https://platform.fatsecret.com/rest/server.api';

interface FatSecretToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * FatSecret food database API client.
 *
 * Uses OAuth 2.0 client-credentials flow with automatic token caching
 * and refresh. Exported as a singleton (`fatSecretService`).
 */
class FatSecretService {
  private clientId: string;
  private clientSecret: string;
  private token: FatSecretToken | null = null;

  constructor() {
    this.clientId = env.FATSECRET_CLIENT_ID;
    this.clientSecret = env.FATSECRET_CLIENT_SECRET;
    log.info('FatSecretService initialised');
  }

  /**
   * Retrieves a valid OAuth2 access token, refreshing if expired.
   * Token is cached in memory until it expires.
   */
  private async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) {
      return this.token.accessToken;
    }

    try {
      const { data } = await axios.post(TOKEN_URL, 'grant_type=client_credentials&scope=premier%20barcode', {
        auth: { username: this.clientId, password: this.clientSecret },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      this.token = {
        accessToken: data.access_token,
        expiresAt: Date.now() + data.expires_in * 1000 - 60_000,
      };

      log.debug('FatSecret OAuth token refreshed');
      return this.token.accessToken;
    } catch (err: any) {
      log.error({ err }, 'Failed to obtain FatSecret access token');
      throw new AppError('FatSecret authentication failed', 502, 'FATSECRET_AUTH_FAILED');
    }
  }

  /**
   * Makes an authenticated request to the FatSecret REST API.
   * Throws on API error response (e.g. error code 211 = barcode not found).
   */
  private async request(method: string, params: Record<string, string> = {}): Promise<any> {
    const token = await this.getAccessToken();

    const { data } = await axios.get(API_BASE, {
      headers: { Authorization: `Bearer ${token}` },
      params: { method, format: 'json', ...params },
    });

    const err = data?.error;
    if (err) {
      const code = err.code ?? 'unknown';
      const msg = err.message ?? 'Unknown API error';
      log.warn({ method, params, fatSecretErrorCode: code, fatSecretMessage: msg }, 'FatSecret API error');
      throw new AppError(
        code === '211' ? 'Food not found for this barcode' : `FatSecret API error: ${msg}`,
        code === '211' ? 404 : 502,
        code === '211' ? 'BARCODE_NOT_FOUND' : 'FATSECRET_API_ERROR',
      );
    }

    return data;
  }

  /**
   * Searches for foods by name/keyword.
   *
   * @param query  — search term (e.g. "chicken breast")
   * @param page   — zero-based page number
   */
  async search(query: string, page = 0): Promise<any> {
    return this.request('foods.search', {
      search_expression: query,
      page_number: String(page),
    });
  }

  /**
   * Retrieves detailed nutrition info for a specific food by ID.
   */
  async getById(foodId: string): Promise<any> {
    return this.request('food.get.v4', { food_id: foodId });
  }

  /**
   * Normalizes barcode to GTIN-13 (required by FatSecret).
   * UPC-A (12 digits) and EAN-8 (8 digits) are zero-padded on the left.
   */
  private normalizeBarcode(barcode: string): string {
    const digits = barcode.replace(/\D/g, '');
    return digits.length >= 13 ? digits.slice(0, 13) : digits.padStart(13, '0');
  }

  /**
   * Looks up a food by its barcode (UPC/EAN).
   * Uses v2 API which returns full food object in one call.
   */
  async getByBarcode(barcode: string): Promise<any> {
    const normalized = this.normalizeBarcode(barcode);
    if (normalized.length < 8) {
      log.warn({ barcode, normalized }, 'Barcode too short after normalization');
      throw new AppError('Invalid barcode format', 400, 'INVALID_BARCODE');
    }
    log.debug({ barcode, normalized }, 'FatSecret barcode lookup');
    return this.request('food.find_id_for_barcode.v2', { barcode: normalized });
  }
}

/** Singleton — import this, don't instantiate the class directly */
export const fatSecretService = new FatSecretService();
