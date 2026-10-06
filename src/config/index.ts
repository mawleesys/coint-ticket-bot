/**
 * Конфигурация бота с валидацией через Zod.
 *
 * В DRY_RUN токены и URL могут быть пустыми — бот не ходит наружу.
 * В обычном режиме обязательные поля проверяются через superRefine.
 */

import { z } from 'zod';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

const logLevelSchema = z.enum([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
]);

const configSchema = z
  .object({
    dryRun: z.boolean().default(false),
    dryRunExitAfterMs: z.coerce.number().int().min(0).default(0),
    logLevel: logLevelSchema.default('info'),
    healthPort: z.coerce.number().int().min(1).max(65535).default(3000),

    discord: z.object({
      token: z.string().default(''),
      guildId: z.string().default(''),
      forumChannelId: z.string().default(''),
      confidentialForumChannelId: z.string().default(''),
      minStaffRoleId: z.string().optional(),
      statsChannelId: z.string().optional(),
    }),

    site: z.object({
      url: z.string().default(''),
      apiToken: z.string().default(''),
      apiTimeout: z.coerce.number().int().min(1000).default(10000),
      /** Site user for list / stats / resync (staff with view). */
      actorUserId: z.number().int().positive().optional(),
    }),

    sync: z.object({
      pollInterval: z.coerce.number().int().min(5).default(30),
      batchSize: z.coerce.number().int().min(1).max(100).default(50),
      eventsLimit: z.coerce.number().int().min(1).max(500).default(100),
      cursorPath: z.string().default('./data/event-cursor.json'),
      outboxRetentionDays: z.coerce.number().int().min(1).default(90),
    }),

    stats: z.object({
      enabled: z.boolean().default(true),
      weeklyReportDay: z.coerce.number().int().min(0).max(6).default(1),
      weeklyReportHour: z.coerce.number().int().min(0).max(23).default(9),
    }),

    /**
     * Реализованные на сайте endpoint'ы включены по умолчанию.
     * Выключить можно через FEATURE_*=false, если понадобится откат.
     */
    features: z.object({
      siteEventFeed: z.boolean().default(true),
      discordUserLookup: z.boolean().default(true),
      sitePermissionCheck: z.boolean().default(true),
      messageDedupeByExternalId: z.boolean().default(true),
      categoriesEndpoint: z.boolean().default(true),
      ticketManagement: z.boolean().default(true),
      ticketList: z.boolean().default(true),
      siteStats: z.boolean().default(true),
    }),

    maxAttachmentSize: z.coerce.number().int().min(1).default(8388608),
    debugApiRequests: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.dryRun) {
      return;
    }

    const required: Array<{ path: (string | number)[]; value: string; label: string }> = [
      { path: ['discord', 'token'], value: data.discord.token, label: 'DISCORD_TOKEN' },
      { path: ['discord', 'guildId'], value: data.discord.guildId, label: 'DISCORD_GUILD_ID' },
      {
        path: ['discord', 'forumChannelId'],
        value: data.discord.forumChannelId,
        label: 'DISCORD_FORUM_CHANNEL_ID',
      },
      {
        path: ['discord', 'confidentialForumChannelId'],
        value: data.discord.confidentialForumChannelId,
        label: 'DISCORD_CONFIDENTIAL_FORUM_CHANNEL_ID',
      },
      { path: ['site', 'url'], value: data.site.url, label: 'SITE_URL' },
      { path: ['site', 'apiToken'], value: data.site.apiToken, label: 'SITE_API_TOKEN' },
    ];

    for (const field of required) {
      if (!field.value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: field.path,
          message: `${field.label} обязателен вне DRY_RUN`,
        });
      }
    }

    if (data.site.url && !z.string().url().safeParse(data.site.url).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['site', 'url'],
        message: 'SITE_URL должен быть валидным URL',
      });
    }
  });

export type Config = z.infer<typeof configSchema>;

export function readEnvConfig(): Record<string, unknown> {
  return {
    dryRun: process.env.DRY_RUN === 'true',
    dryRunExitAfterMs: parseInt(process.env.DRY_RUN_EXIT_AFTER_MS || '0', 10),
    logLevel: process.env.LOG_LEVEL || 'info',
    healthPort: parseInt(process.env.HEALTH_PORT || '3000', 10),

    discord: {
      token: process.env.DISCORD_TOKEN || '',
      guildId: process.env.DISCORD_GUILD_ID || '',
      forumChannelId: process.env.DISCORD_FORUM_CHANNEL_ID || '',
      confidentialForumChannelId:
        process.env.DISCORD_CONFIDENTIAL_FORUM_CHANNEL_ID || '',
      minStaffRoleId: process.env.DISCORD_MIN_STAFF_ROLE_ID,
      statsChannelId: process.env.DISCORD_STATS_CHANNEL_ID,
    },

    site: {
      url: process.env.SITE_URL || '',
      apiToken: process.env.SITE_API_TOKEN || '',
      apiTimeout: parseInt(process.env.SITE_API_TIMEOUT || '10000', 10),
      actorUserId: process.env.SITE_ACTOR_USER_ID
        ? parseInt(process.env.SITE_ACTOR_USER_ID, 10)
        : undefined,
    },

    sync: {
      pollInterval: parseInt(process.env.SYNC_POLL_INTERVAL || '30', 10),
      batchSize: parseInt(process.env.SYNC_BATCH_SIZE || '50', 10),
      eventsLimit: parseInt(process.env.SYNC_EVENTS_LIMIT || '100', 10),
      cursorPath: process.env.SYNC_CURSOR_PATH || './data/event-cursor.json',
      outboxRetentionDays: parseInt(
        process.env.OUTBOX_RETENTION_DAYS || '90',
        10
      ),
    },

    stats: {
      enabled: process.env.STATS_ENABLED !== 'false',
      weeklyReportDay: parseInt(process.env.STATS_WEEKLY_REPORT_DAY || '1', 10),
      weeklyReportHour: parseInt(process.env.STATS_WEEKLY_REPORT_HOUR || '9', 10),
    },

    features: {
      siteEventFeed: process.env.FEATURE_SITE_EVENT_FEED !== 'false',
      discordUserLookup: process.env.FEATURE_DISCORD_USER_LOOKUP !== 'false',
      sitePermissionCheck: process.env.FEATURE_SITE_PERMISSION_CHECK !== 'false',
      messageDedupeByExternalId:
        process.env.FEATURE_MESSAGE_DEDUPE_BY_EXTERNAL_ID !== 'false',
      categoriesEndpoint: process.env.FEATURE_CATEGORIES_ENDPOINT !== 'false',
      ticketManagement: process.env.FEATURE_TICKET_MANAGEMENT !== 'false',
      ticketList: process.env.FEATURE_TICKET_LIST !== 'false',
      siteStats: process.env.FEATURE_SITE_STATS !== 'false',
    },

    maxAttachmentSize: parseInt(process.env.MAX_ATTACHMENT_SIZE || '8388608', 10),
    debugApiRequests: process.env.DEBUG_API_REQUESTS === 'true',
  };
}

let cachedConfig: Config | null = null;

export function loadConfig(raw?: Record<string, unknown>): Config {
  if (cachedConfig && raw === undefined) {
    return cachedConfig;
  }

  const result = configSchema.safeParse(raw ?? readEnvConfig());

  if (!result.success) {
    console.error('❌ Ошибка конфигурации:', JSON.stringify(result.error.format(), null, 2));
    throw new Error('Невалидная конфигурация. Проверьте .env файл или включите DRY_RUN=true.');
  }

  cachedConfig = result.data;
  return cachedConfig;
}

/**
 * Оставлен для обратной совместимости: superRefine уже проверяет прод-поля.
 */
export function validateDryRunConfig(config: Config): void {
  if (config.dryRun) {
    return;
  }

  const missing: string[] = [];
  if (!config.discord.token) missing.push('DISCORD_TOKEN');
  if (!config.discord.guildId) missing.push('DISCORD_GUILD_ID');
  if (!config.discord.forumChannelId) missing.push('DISCORD_FORUM_CHANNEL_ID');
  if (!config.discord.confidentialForumChannelId) {
    missing.push('DISCORD_CONFIDENTIAL_FORUM_CHANNEL_ID');
  }
  if (!config.site.url) missing.push('SITE_URL');
  if (!config.site.apiToken) missing.push('SITE_API_TOKEN');

  if (missing.length > 0) {
    console.error('❌ Отсутствуют обязательные переменные окружения:');
    missing.forEach((name) => {
      console.error(`  - ${name}`);
    });
    throw new Error(
      'Не все обязательные переменные окружения заданы. Для работы без токенов используйте DRY_RUN=true'
    );
  }
}

export function getConfig(): Config {
  if (!cachedConfig) {
    throw new Error('Конфигурация не загружена. Вызовите loadConfig() сначала.');
  }
  return cachedConfig;
}

export function resetConfig(): void {
  cachedConfig = null;
}

export function createTestConfig(overrides: Partial<Config> = {}): Config {
  const base: Config = {
    dryRun: true,
    dryRunExitAfterMs: 0,
    logLevel: 'silent',
    healthPort: 3000,
    discord: {
      token: '',
      guildId: 'guild-id',
      forumChannelId: 'forum-public',
      confidentialForumChannelId: 'forum-confidential',
    },
    site: {
      url: 'http://127.0.0.1:9',
      apiToken: 'test-token',
      apiTimeout: 5000,
      actorUserId: 45,
    },
    sync: {
      pollInterval: 30,
      batchSize: 50,
      eventsLimit: 100,
      cursorPath: './data/event-cursor.json',
      outboxRetentionDays: 90,
    },
    stats: {
      enabled: true,
      weeklyReportDay: 1,
      weeklyReportHour: 9,
    },
    features: {
      siteEventFeed: true,
      discordUserLookup: true,
      sitePermissionCheck: true,
      messageDedupeByExternalId: true,
      categoriesEndpoint: true,
      ticketManagement: true,
      ticketList: true,
      siteStats: true,
    },
    maxAttachmentSize: 8388608,
    debugApiRequests: false,
  };

  return {
    ...base,
    ...overrides,
    discord: { ...base.discord, ...overrides.discord },
    site: { ...base.site, ...overrides.site },
    sync: { ...base.sync, ...overrides.sync },
    stats: { ...base.stats, ...overrides.stats },
    features: { ...base.features, ...overrides.features },
  };
}
