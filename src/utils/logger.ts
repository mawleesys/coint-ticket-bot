/**
 * Структурированное логирование через Pino
 */

import pino from 'pino';
import type { Logger as PinoLogger } from 'pino';
import { getConfig } from '../config/index.js';

let logger: PinoLogger | null = null;

/**
 * Инициализирует глобальный logger
 */
export function initLogger(): PinoLogger {
  const config = getConfig();

  const usePretty =
    process.env.NODE_ENV !== 'production' && process.env.LOG_PRETTY !== 'false';

  logger = pino({
    level: config.logLevel,
    transport: usePretty
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
    base: {
      env: process.env.NODE_ENV || 'development',
      dryRun: config.dryRun,
    },
  });

  return logger;
}

/**
 * Получает глобальный logger
 * @throws {Error} если logger не инициализирован
 */
export function getLogger(): PinoLogger {
  if (!logger) {
    throw new Error('Logger не инициализирован. Вызовите initLogger() сначала.');
  }
  return logger;
}

/**
 * Создает child logger с дополнительным контекстом
 */
export function createChildLogger(
  context: Record<string, unknown>
): PinoLogger {
  return getLogger().child(context);
}
