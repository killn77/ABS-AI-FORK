const { expect } = require('chai')
const fs = require('fs')
const path = require('path')
const semver = require('semver')
const packageJson = require('../../../package.json')

describe('fork migration versioning', () => {
  it('keeps package version at or above the newest migration version', () => {
    const migrationsDir = path.join(__dirname, '..', '..', '..', 'server', 'migrations')
    const newestMigrationVersion = fs
      .readdirSync(migrationsDir)
      .map((file) => file.match(/^v(\d+\.\d+\.\d+)-/))
      .filter(Boolean)
      .map((match) => match[1])
      .sort(semver.compare)
      .pop()

    expect(semver.gte(packageJson.version, newestMigrationVersion)).to.equal(true)
  })
})
