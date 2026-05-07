import { logger } from '../core/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CACHE_DIR = path.join(os.homedir(), '.gaiia');
const CACHE_FILE = path.join(CACHE_DIR, 'context_cache.json');

export class ContextStore {
  private static instance: ContextStore;
  private schemaCache: Record<string, any> = {};

  private constructor() {
    this.loadFromDisk();
  }

  public static getInstance(): ContextStore {
    if (!ContextStore.instance) {
      ContextStore.instance = new ContextStore();
    }
    return ContextStore.instance;
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const data = fs.readFileSync(CACHE_FILE, 'utf-8');
        this.schemaCache = JSON.parse(data);
        logger.info(`[ContextStore] Loaded ${Object.keys(this.schemaCache).length} schemas from disk.`);
      }
    } catch (e: any) {
      logger.warn(`[ContextStore] Failed to load cache from disk: ${e.message}`);
    }
  }

  private saveToDisk(): void {
    try {
      if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
      }
      fs.writeFileSync(CACHE_FILE, JSON.stringify(this.schemaCache, null, 2));
    } catch (e: any) {
      logger.warn(`[ContextStore] Failed to save cache to disk: ${e.message}`);
    }
  }

  /**
   * Normalizes a URL to a resource path by removing specific IDs and query params.
   * e.g. http://api.com/users/123?a=b -> /users
   */
  public normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      let path = urlObj.pathname;

      // Remove common ID patterns (numeric or UUID)
      path = path.replace(/\/\d+(?=\/|$)/g, '/:id');
      path = path.replace(/\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?=\/|$)/g, '/:id');

      return path;
    } catch (e) {
      return url;
    }
  }

  public saveSchema(url: string, schema: any): void {
    const key = this.normalizeUrl(url);
    logger.info(`[ContextStore] Caching schema for path: ${key}`);
    this.schemaCache[key] = schema;
    this.saveToDisk();
  }

  public getSchema(url: string): any | null {
    const key = this.normalizeUrl(url);
    const schema = this.schemaCache[key];
    if (schema) {
      logger.info(`[ContextStore] Cache HIT for path: ${key}`);
      return schema;
    }
    return null;
  }
}

export const contextStore = ContextStore.getInstance();
