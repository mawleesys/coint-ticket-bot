import { loadConfig, resetConfig } from '../src/config/index.js';

describe('config validation', () => {
  afterEach(() => {
    resetConfig();
  });

  it('allows empty tokens in dry-run', () => {
    const config = loadConfig({
      dryRun: true,
      discord: {},
      site: {},
      sync: {},
      stats: {},
      features: {},
    });

    expect(config.dryRun).toBe(true);
    expect(config.discord.token).toBe('');
    expect(config.site.apiToken).toBe('');
  });

  it('rejects missing production tokens', () => {
    expect(() =>
      loadConfig({
        dryRun: false,
        discord: { token: '' },
        site: { url: '', apiToken: '' },
        sync: {},
        stats: {},
        features: {},
      })
    ).toThrow(/Невалидная конфигурация/);
  });
});
