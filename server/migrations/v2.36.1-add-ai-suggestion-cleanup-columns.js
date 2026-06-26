const migrationVersion = '2.36.1'
const migrationName = `${migrationVersion}-add-ai-suggestion-cleanup-columns`
const loggerPrefix = `[${migrationVersion} migration]`

async function addColumnIfMissing(queryInterface, tableDescription, tableName, columnName, definition, logger) {
  if (tableDescription[columnName]) {
    logger.info(`${loggerPrefix} column "${tableName}.${columnName}" already exists`)
    return
  }
  logger.info(`${loggerPrefix} adding column "${tableName}.${columnName}"`)
  await queryInterface.addColumn(tableName, columnName, definition)
}

async function removeColumnIfExists(queryInterface, tableDescription, tableName, columnName, logger) {
  if (!tableDescription[columnName]) {
    logger.info(`${loggerPrefix} column "${tableName}.${columnName}" does not exist`)
    return
  }
  logger.info(`${loggerPrefix} removing column "${tableName}.${columnName}"`)
  await queryInterface.removeColumn(tableName, columnName)
}

async function up({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} UPGRADE BEGIN: ${migrationName}`)

  if (!(await queryInterface.tableExists('aiMetadataSuggestions'))) {
    logger.info(`${loggerPrefix} table "aiMetadataSuggestions" does not exist; fresh installs get columns from model sync`)
    logger.info(`${loggerPrefix} UPGRADE END: ${migrationName}`)
    return
  }

  const DataTypes = queryInterface.sequelize.Sequelize.DataTypes
  const table = await queryInterface.describeTable('aiMetadataSuggestions')

  await addColumnIfMissing(queryInterface, table, 'aiMetadataSuggestions', 'issueType', DataTypes.STRING, logger)
  await addColumnIfMissing(queryInterface, table, 'aiMetadataSuggestions', 'origin', DataTypes.STRING, logger)
  await addColumnIfMissing(queryInterface, table, 'aiMetadataSuggestions', 'canFastApply', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, logger)

  logger.info(`${loggerPrefix} UPGRADE END: ${migrationName}`)
}

async function down({ context: { queryInterface, logger } }) {
  logger.info(`${loggerPrefix} DOWNGRADE BEGIN: ${migrationName}`)

  if (!(await queryInterface.tableExists('aiMetadataSuggestions'))) {
    logger.info(`${loggerPrefix} table "aiMetadataSuggestions" does not exist`)
    logger.info(`${loggerPrefix} DOWNGRADE END: ${migrationName}`)
    return
  }

  const table = await queryInterface.describeTable('aiMetadataSuggestions')
  await removeColumnIfExists(queryInterface, table, 'aiMetadataSuggestions', 'canFastApply', logger)
  await removeColumnIfExists(queryInterface, table, 'aiMetadataSuggestions', 'origin', logger)
  await removeColumnIfExists(queryInterface, table, 'aiMetadataSuggestions', 'issueType', logger)

  logger.info(`${loggerPrefix} DOWNGRADE END: ${migrationName}`)
}

module.exports = { up, down }
