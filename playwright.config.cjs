const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
    testDir: './tests/browser', timeout: 60000, workers: 1,
    use: { baseURL: 'http://127.0.0.1:4175', headless: true, channel: 'msedge' },
    webServer: { command: 'node scripts/test-server.mjs', url: 'http://127.0.0.1:4175', reuseExistingServer: false }
});
