import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../core/index.js';

const RULEBOOK_DIR = path.join(os.homedir(), '.gaiia');
const RULEBOOK_FILE = path.join(RULEBOOK_DIR, 'mutation_rulebook.json');

interface MutationRule {
  errorMessage: string;
  mutation: any;
  successCount: number;
}

export class MutationRuleBook {
  private static instance: MutationRuleBook;
  private rules: Record<string, MutationRule> = {};

  private constructor() {
    this.loadFromDisk();
  }

  public static getInstance(): MutationRuleBook {
    if (!MutationRuleBook.instance) {
      MutationRuleBook.instance = new MutationRuleBook();
    }
    return MutationRuleBook.instance;
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(RULEBOOK_FILE)) {
        const data = fs.readFileSync(RULEBOOK_FILE, 'utf-8');
        this.rules = JSON.parse(data);
        logger.info(`[RuleBook] Loaded ${Object.keys(this.rules).length} mutation rules.`);
      }
    } catch (e: any) {
      logger.warn(`[RuleBook] Failed to load rulebook: ${e.message}`);
    }
  }

  private saveToDisk(): void {
    try {
      if (!fs.existsSync(RULEBOOK_DIR)) {
        fs.mkdirSync(RULEBOOK_DIR, { recursive: true });
      }
      fs.writeFileSync(RULEBOOK_FILE, JSON.stringify(this.rules, null, 2));
    } catch (e: any) {
      logger.warn(`[RuleBook] Failed to save rulebook: ${e.message}`);
    }
  }

  /**
   * Normalizes an error message by removing specific values (like IDs) to create a generic key.
   */
  private normalizeError(error: string): string {
    if (typeof error !== 'string') return 'generic_error';
    // Remove IDs, dates, and specific values
    return error
      .replace(/\d+/g, 'N')
      .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, 'UUID')
      .replace(/"[^"]*"/g, 'VALUE')
      .substring(0, 500);
  }

  public getMutation(errorMessage: string): any | null {
    const key = this.normalizeError(errorMessage);
    if (this.rules[key]) {
      logger.info(`[RuleBook] Found cached mutation for error: ${key}`);
      return this.rules[key].mutation;
    }
    return null;
  }

  public recordSuccess(errorMessage: string, mutation: any): void {
    const key = this.normalizeError(errorMessage);
    if (this.rules[key]) {
      this.rules[key].successCount++;
    } else {
      this.rules[key] = {
        errorMessage: key,
        mutation,
        successCount: 1
      };
    }
    this.saveToDisk();
  }
}

export const mutationRuleBook = MutationRuleBook.getInstance();
