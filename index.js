/* eslint camelcase: 0 */
const config = require('config')
const path = require('path')
const log4js_wrapper = require('log4js-wrapper-advanced')
const KoaNeo4jApp = require('koa-neo4j')
const scirichonSchema = require('scirichon-json-schema')
const scirichonCache = require('scirichon-cache')
const cypherInvoker = require('./cypher/cypherInvoker')
const hooks = require('./hooks')
const batchHandler = require('./batchHandler')
const route = require('./route')
const middleware = require('./middleware')

const initApp = async () => {
  /**
     * init logger
     */
  log4js_wrapper.initialize(Object.assign({}, config.get('logger')))

  /**
     * int koa app and load middleware
     */
  const middlewares = require(path.resolve('./middlewares'))
  const neo4jConfig = config.get('neo4j')
  let koaNeo4jOptions = {
    neo4j: {
      boltUrl: `bolt://${process.env['NEO4J_HOST'] || neo4jConfig.host}:${neo4jConfig.port}`,
      user: process.env['NEO4J_USER'] || neo4jConfig.user,
      password: process.env['NEO4J_PASSWD'] || neo4jConfig.password,
      option: { transaction: true }
    },
    loadMiddlewareByApp: true,
    loadRouteByApp: true
  }
  const app = new KoaNeo4jApp(koaNeo4jOptions)
  middlewares.load(app)

  /**
     * load route from schema
     */
  const redisOption = config.get('redis')
  const additionalPropertyCheck = config.get('additionalPropertyCheck')
  const schema_option = { redisOption, additionalPropertyCheck, prefix: process.env['SCHEMA_TYPE'] || 'scirichon-schema' }
  const routes = require(path.resolve('./routes'))
  await app.neo4jConnection.initialized
  await scirichonSchema.initSchemas(schema_option)
  await scirichonCache.initialize(schema_option)
  routes.load(app)
  return app
}

module.exports = { cypherInvoker, hooks, batchHandler, route, middleware, initApp }
