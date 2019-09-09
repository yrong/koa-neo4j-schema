/* eslint camelcase: 0 */
const _ = require('lodash')
const config = require('config')
const schema = require('scirichon-json-schema')
const es_config = config.get('elasticsearch')
const search = require('scirichon-search')
const hooks = require('../hooks')
const batchHandler = require('../batchHandler')
const compose = require('koa-compose')

const schema_checker = (params) => {
  schema.checkObject((params.data && params.data.category) || params.category, (params.data && params.data.fields) || params)
  return params
}

const es_checker = () => {
  if (es_config.mode === 'strict') { return search.checkStatus() }
  return none_checker()
}

const none_checker = () => true

module.exports = (app) => {
  let routesDef = schema.getApiRouteSchemas()

  let allowed_methods = ['Add', 'Modify', 'Delete', 'FindOne', 'FindAll', 'BatchAdd', 'BatchUpdate', 'BatchDelete', 'LoopAdd', 'LoopUpdate', 'LoopDelete']

  let globalTransaction = config.get('globalTransaction'); let timeout = config.get('timeout')

  /* common route */
  _.each(routesDef, (val) => {
    if (val.service === process.env['NODE_NAME']) {
      _.each(allowed_methods, (method) => {
        switch (method) {
          case 'Add':
            app.defineAPI({
              method: 'POST',
              route: val.route,
              check: [schema_checker, es_checker],
              preProcess: hooks.cudItem_preProcess,
              postProcess: hooks.cudItem_postProcess,
              timeout,
              globalTransaction
            })
            break
          case 'Modify':
            ['PATCH', 'PUT'].forEach((method) => {
              app.defineAPI({
                method: method,
                route: val.route + '/:uuid',
                check: [es_checker],
                preProcess: hooks.cudItem_preProcess,
                postProcess: hooks.cudItem_postProcess,
                timeout,
                globalTransaction
              })
            })
            break
          case 'Delete':
            app.defineAPI({
              method: 'DEL',
              route: val.route + '/:uuid',
              check: [es_checker],
              preProcess: hooks.cudItem_preProcess,
              postProcess: hooks.cudItem_postProcess,
              timeout,
              globalTransaction
            })
            break
          case 'FindOne':
            app.defineAPI({
              method: 'GET',
              route: val.route + '/:uuid',
              preProcess: hooks.queryItems_preProcess,
              postProcess: hooks.queryItems_postProcess,
              timeout
            })
            break
          case 'FindAll':
            app.defineAPI({
              method: 'GET',
              route: val.route,
              preProcess: hooks.queryItems_preProcess,
              postProcess: hooks.queryItems_postProcess,
              timeout
            })
            break
          case 'BatchAdd':
            app.defineAPI({
              method: 'POST',
              route: '/batch' + val.route,
              procedure: batchHandler.batchProcessor
            })
            break
          case 'BatchUpdate':
            app.defineAPI({
              method: 'PUT',
              route: '/batch' + val.route,
              procedure: batchHandler.batchProcessor
            })
            break
          case 'BatchDelete':
            app.defineAPI({
              method: 'DEL',
              route: '/batch' + val.route,
              procedure: batchHandler.batchProcessor
            })
            break
          case 'LoopAdd':
            app.defineAPI({
              method: 'POST',
              route: '/loop' + val.route,
              procedure: batchHandler.loopAddProcessor
            })
            break
          case 'LoopUpdate':
            app.defineAPI({
              method: 'PUT',
              route: '/loop' + val.route,
              procedure: batchHandler.loopUpdateProcessor
            })
            break
          case 'LoopDelete':
            app.defineAPI({
              method: 'DEL',
              route: '/loop' + val.route,
              procedure: batchHandler.loopDeleteProcessor
            })
            break
        }
      })
    }
  })

  /* search by es */
  app.defineAPI({
    method: 'POST',
    route: '/api/searchByEql',
    procedure: search.searchItem
  })

  /* search by neo4j */
  app.defineAPI({
    method: 'POST',
    route: '/api/searchByCypher',
    preProcess: hooks.customizedQueryItems_preProcess,
    postProcess: hooks.queryItems_postProcess,
    timeout
  })

  /* get schema */
  app.defineAPI({
    method: 'GET',
    route: '/api/schema/:category',
    procedure: hooks.getCategorySchema
  })

  /* get SchemaHierarchy */
  app.defineAPI({
    method: 'GET',
    route: '/api/schema/hierarchy/:category',
    procedure: hooks.getCategoryInheritanceHierarchy
  })

  /* add SchemaHierarchy */
  app.defineAPI({
    method: 'POST',
    route: '/api/schema/hierarchy/:category',
    procedure: hooks.addCategoryInheritanceHierarchy
  })

  /* delete all Items(for test purpose) */
  if (process.env.NODE_ENV === 'development') {
    app.defineAPI({
      method: 'DEL',
      route: '/hidden/clean',
      procedure: hooks.clean
    })
  }

  /* license */
  app.defineAPI({
    method: 'GET',
    route: '/api/license',
    procedure: hooks.getLicense
  })

  /* member */
  app.defineAPI({
    method: 'POST',
    route: '/api/members',
    procedure: hooks.getItemWithMembers
  })

  /* generate uuid */
  app.defineAPI({
    method: 'POST',
    route: '/api/generateId',
    procedure: hooks.generateId
  })

  /* join search by es */
  app.defineAPI({
    method: 'POST',
    route: '/api/joinSearchByEql',
    procedure: search.joinSearchItem
  })

  app.use(compose(
    [
      app.router.routes(),
      app.router.allowedMethods()
    ]))

  return app
}
