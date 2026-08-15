import { Types } from 'mongoose';
import {
  PET_DATA_COLLECTIONS,
  PET_DATA_COLLECTION_KEYS,
  isAllowedCollection,
  type PetDataCollectionKey,
} from './PetDataToolConfig.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('PetDataToolService');

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

export interface QueryUserDataArgs {
  collection: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

function isValidDateStr(s: string): boolean {
  return DATE_REGEX.test(s);
}

/**
 * Executes a read-only query against a user-scoped collection.
 * userId is ALWAYS injected from auth — never from the AI.
 */
async function executeQuery(
  userId: string,
  args: QueryUserDataArgs,
): Promise<string> {
  const { collection: collectionKey, dateFrom, dateTo, limit } = args;

  if (!isAllowedCollection(collectionKey)) {
    log.warn({ userId, collectionKey }, 'PetDataTool: rejected unknown collection');
    return JSON.stringify({ error: `Unknown collection: ${collectionKey}` });
  }

  const config = PET_DATA_COLLECTIONS[collectionKey as PetDataCollectionKey];
  const userIdObj = new Types.ObjectId(userId);

  // Every query MUST include userId — filter is always constructed server-side
  const filter: Record<string, unknown> = {
    [config.userIdField]: userIdObj,
  };

  if (config.dateField && (dateFrom || dateTo)) {
    const dateFilter: Record<string, unknown> = {};
    if (dateFrom) {
      if (!isValidDateStr(dateFrom)) {
        return JSON.stringify({ error: 'dateFrom must be YYYY-MM-DD' });
      }
      dateFilter.$gte = dateFrom;
    }
    if (dateTo) {
      if (!isValidDateStr(dateTo)) {
        return JSON.stringify({ error: 'dateTo must be YYYY-MM-DD' });
      }
      dateFilter.$lte = dateTo;
    }
    if (Object.keys(dateFilter).length > 0) {
      filter[config.dateField] = dateFilter;
    }
  }

  const cappedLimit = Math.min(
    Math.max(limit ?? DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  try {
    const docs = await config.model
      .find(filter)
      .lean()
      .limit(cappedLimit)
      .sort(config.dateField ? { [config.dateField]: -1 } : { createdAt: -1 });

    log.info(
      {
        userId,
        collection: collectionKey,
        dateFrom: dateFrom ?? null,
        dateTo: dateTo ?? null,
        limit: cappedLimit,
        resultCount: docs.length,
      },
      'PetDataTool: query_user_data executed',
    );

    return JSON.stringify(docs);
  } catch (err) {
    log.error({ err, userId, collectionKey }, 'PetDataTool query failed');
    return JSON.stringify({ error: 'Query failed' });
  }
}

/**
 * Creates the query_user_data tool with userId bound in closure.
 * The AI never receives or can specify userId — it comes only from auth.
 */
/**
 * Tool structure for OpenAI runTools — matches RunnableToolFunction<QueryUserDataArgs>
 */
export function createQueryUserDataTool(userId: string) {
  return {
    type: 'function' as const,
    function: {
      name: 'query_user_data',
      description:
        "Look up the user's wellness and game data. Use when they ask about food, water, mood, weight, fasting, quests, achievements, or login streaks. Returns JSON.",
      parameters: {
        type: 'object',
        properties: {
          collection: {
            type: 'string',
            enum: PET_DATA_COLLECTION_KEYS,
            description: [
              'Which data to fetch. Choose based on user\'s question:',
              ...PET_DATA_COLLECTION_KEYS.map((k) => `- ${k}: ${PET_DATA_COLLECTIONS[k].descriptionForAI}`),
            ].join('\n'),
          },
          dateFrom: {
            type: 'string',
            description: 'Start date YYYY-MM-DD (optional)',
          },
          dateTo: {
            type: 'string',
            description: 'End date YYYY-MM-DD (optional)',
          },
          limit: {
            type: 'number',
            default: DEFAULT_LIMIT,
            description: 'Max documents (1-50)',
          },
        },
        required: ['collection'],
      },
      parse: (input: string): QueryUserDataArgs => {
        const parsed = JSON.parse(input) as QueryUserDataArgs;
        return {
          collection: parsed.collection,
          dateFrom: parsed.dateFrom,
          dateTo: parsed.dateTo,
          limit: parsed.limit,
        };
      },
      function: async (args: QueryUserDataArgs) => {
        return executeQuery(userId, args);
      },
    },
  };
}
