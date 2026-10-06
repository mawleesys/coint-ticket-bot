/**
 * Точка входа в приложение
 */

import http from 'http';
import { loadConfig, validateDryRunConfig } from './config/index.js';
import { initLogger } from './utils/logger.js';
import { TicketBot } from './discord/bot.js';
import { runDryRunDemo } from './dry-run/demo.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = initLogger();

  logger.info(
    {
      version: '0.1.0',
      dryRun: config.dryRun,
      logLevel: config.logLevel,
    },
    'Starting COINT Ticket Bot'
  );

  try {
    validateDryRunConfig(config);
  } catch (error) {
    logger.fatal({ error }, 'Configuration validation failed');
    process.exit(1);
  }

  const bot = new TicketBot(config, logger);

  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      const status = bot.getStatus();

      if (!config.dryRun && !status.ready) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'not_ready', ...status }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', ...status }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  await new Promise<void>((resolve) => {
    server.listen(config.healthPort, () => {
      logger.info({ port: config.healthPort }, 'Healthcheck server listening');
      resolve();
    });
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Received shutdown signal');

    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });

    await bot.stop();
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  try {
    await bot.start();

    if (config.dryRun) {
      runDryRunDemo(config, logger);
      logger.info(
        'Dry-run mode: bot initialized without Discord or site tokens'
      );

      if (config.dryRunExitAfterMs > 0) {
        setTimeout(() => {
          void shutdown('dry-run-timeout');
        }, config.dryRunExitAfterMs);
      }
    }
  } catch (error) {
    logger.fatal({ error }, 'Failed to start bot');
    process.exit(1);
  }
}

void main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
