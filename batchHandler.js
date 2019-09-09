/* eslint camelcase: 0 */
const _ = require('lodash')
const common = require('scirichon-common')
const schema = require('scirichon-json-schema')
const search = require('scirichon-search')
const scirichonCache = require('scirichon-cache')
const requestHandler = require('./hooks/requestHandler')
const cypherInvoker = require('./cypher/cypherInvoker')
const requestPostHandler = require('./hooks/requestPostHandler')
const hooks = require('./hooks')
const config = require('config')

const batchUpdate = async (ctx, category, uuids, change_obj, removed) => {
  let cypher = `unwind {uuids} as uuid match (n:${category}) where n.uuid=uuid set `; let script = ``; let old_obj; let new_obj
  let stringified_change_obj = _.omit(requestHandler.objectFields2String(_.assign({ category }, change_obj)), 'category')
  for (let key in stringified_change_obj) {
    cypher += `n.${key}={${key}},`
  }
  for (let key in change_obj) {
    script += `ctx._source.${key}=params.${key};`
  }
  cypher = cypher.substr(0, cypher.length - 1)
  if (removed) {
    cypher += ` remove `
    for (let key of removed) {
      cypher += `n.${key},`
      script += `ctx._source.remove("${key}");`
    }
    cypher = cypher.substr(0, cypher.length - 1)
  }
  await cypherInvoker.executeCypher(ctx, cypher, _.assign({ uuids }, stringified_change_obj))
  let index = requestHandler.getIndexByCategory(category)
  if (index) {
    await search.batchUpdate(index, uuids, { script: { inline: script, params: change_obj } })
  }
  for (let uuid of uuids) {
    old_obj = await scirichonCache.getItemByCategoryAndID(category, uuid)
    if (!_.isEmpty(old_obj)) {
      new_obj = _.assign({}, old_obj, change_obj)
      if (removed) {
        new_obj = _.omit(new_obj, removed)
      }
      await scirichonCache.addItem(new_obj)
    }
  }
}

const batchPreprocess = async (params, ctx) => {
  let category = params.data.category; let item; let items = []
  if (ctx.method === 'POST') {
    let entries = params.data.fields
    for (let entry of entries) {
      schema.checkObject(category, entry)
      item = { category, data: { category } }
      item.data.fields = entry
      item = await hooks.cudItem_preProcess(item, ctx)
      items.push(item)
    }
    params.data.fields = items
  } else if (ctx.method === 'PUT' || ctx.method === 'DELETE') {
    let uuids = params.data.uuids
    for (let uuid of uuids) {
      item = { uuid, category, data: { category } }
      item.data.fields = params.data.fields
      item = await hooks.cudItem_preProcess(item, ctx)
      items.push(item)
    }
    params.data.fields = items
  }
  return params
}

const batchCypherNodes = async (params, ctx) => {
  let cypher, result
  if (ctx.method === 'POST' || ctx.method === 'PUT') {
    let labels = schema.getParentCategories(params.data.category)
    labels = _.isArray(labels) ? labels.join(':') : params.data.category
    let stringified_fields = _.map(params.data.fields, (item) => item.stringified_fields)
    cypher = `unwind {items} as item merge (n:${labels} {uuid:item.uuid}) on create set n=item on match set n=item`
    result = await cypherInvoker.executeCypher(ctx, cypher, { items: stringified_fields })
  } else if (ctx.method === 'DELETE') {
    cypher = `unwind {uuids} as uuid match (n:${params.data.category} {uuid:uuid}) detach delete n`
    result = await cypherInvoker.executeCypher(ctx, cypher, { uuids: params.data.uuids })
  }
  params.data.result = result
  return params
}

const batchPostprocess = async (params, ctx) => {
  if (ctx.method === 'POST' || ctx.method === 'PUT') {
    let items = []
    for (let item of params.data.fields) {
      item = await hooks.cudItem_postProcess(params.data.result, item, ctx)
      items.push(item)
    }
    params.data.fields = items
  }
  return params
}

const batchSearch = async (params, ctx) => {
  let items = _.map(params.data.fields, (item) => item.fields)
  let index = requestHandler.getIndexByCategory(params.data.category)
  if (index) {
    if (ctx.method === 'POST' || ctx.method === 'PUT') {
      await search.batchCreate(index, items)
    } else if (ctx.method === 'DELETE') {
      await search.batchDelete(index, params.data.uuids)
    }
  }
}

const batchCache = async (params, ctx) => {
  if (ctx.method === 'POST' || ctx.method === 'PUT') {
    let items = _.map(params.data.fields, (item) => item.fields)
    for (let item of items) {
      await scirichonCache.addItem(item)
    }
  } else if (ctx.method === 'DELETE') {
    for (let uuid of params.data.uuids) {
      let old_obj = await scirichonCache.getItemByCategoryAndID(params.data.category, uuid)
      if (!_.isEmpty(old_obj)) {
        await scirichonCache.delItem(old_obj)
      }
    }
  }
}

const batchNotification = async (params, ctx) => {
  let needNotify = requestPostHandler.needNotify({ category: params.data.category }, ctx)
  if (needNotify) {
    let notifications = []; let notification_url = common.getServiceApiUrl('notifier')
    let notification = { user: ctx[config.get('auth.userFieldName')], source: process.env['NODE_NAME'] }
    for (let item of params.data.fields) {
      notification.type = params.data.category
      notification.action = ctx.method === 'POST' ? 'CREATE' : (ctx.method === 'PUT' ? 'UPDATE' : 'DELETE')
      notification.new = item.fields
      notification.old = item.fields_old
      notifications.push(notification)
    }
    await common.apiInvoker('POST', notification_url, '/api/notifications/batch', '', notifications)
  }
}

const batchProcessor = async (params, ctx) => {
  ctx.batch = true
  await batchPreprocess(params, ctx)
  await batchCypherNodes(params, ctx)
  await batchPostprocess(params, ctx)
  await batchSearch(params, ctx)
  await batchCache(params, ctx)
  await batchNotification(params, ctx)
  return ctx.method === 'POST' ? _.map(params.data.fields, (field) => { return field.uuid }) : params.data.uuids
}

const loopAddProcessor = async (params, ctx) => {
  let entries = params.data.fields; let item; let result; let results = []
  for (let entry of entries) {
    try {
      schema.checkObject(params.data.category, entry)
      item = { category: params.data.category, uuid: entry.uuid, data: { category: params.data.category, fields: entry } }
      item = await hooks.cudItem_preProcess(item, ctx)
      result = []
      for (let cypher of item.cypher) {
        result.push(await cypherInvoker.executeCypher(ctx, cypher, item))
      }
      result = await hooks.cudItem_postProcess(result, item, ctx)
      results.push(result)
    } catch (error) {
      result = entry
      result.category = params.data.category
      result.error = error.message
      results.push(result)
    }
  }
  return results
}

const loopUpdateProcessor = async (params, ctx) => {
  let fields = params.data.fields; let category = params.data.category; let uuids = params.data.uuids; let results = []; let item; let result
  for (let uuid of uuids) {
    try {
      item = { category, uuid, data: { category, fields } }
      item = await hooks.cudItem_preProcess(item, ctx)
      result = []
      for (let cypher of item.cypher) {
        result.push(await cypherInvoker.executeCypher(ctx, cypher, item))
      }
      result = await hooks.cudItem_postProcess(result, item, ctx)
      results.push(result)
    } catch (error) {
      result = { category, uuid, error: error.message }
      results.push(result)
    }
  }
  return results
}

const loopDeleteProcessor = async (params, ctx) => {
  let category = params.data.category; let uuids = params.data.uuids; let results = []; let item; let result
  for (let uuid of uuids) {
    try {
      item = { category, uuid }
      item = await hooks.cudItem_preProcess(item, ctx)
      result = await cypherInvoker.executeCypher(ctx, item.cypher, item)
      result = await hooks.cudItem_postProcess(result, item, ctx)
      results.push(result)
    } catch (error) {
      result = { category, uuid, error: error.message }
      results.push(result)
    }
  }
  return results
}

module.exports = { batchProcessor, loopAddProcessor, loopUpdateProcessor, loopDeleteProcessor, batchUpdate }
