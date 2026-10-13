const { jestConfig } = require('@salesforce/sfdx-lwc-jest/config');
module.exports = { ...jestConfig, testPathIgnorePatterns: ['/node_modules/', '/tests/'] };
