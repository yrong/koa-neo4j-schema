/* eslint camelcase: 0 */
const _ = require('lodash')
const jp = require('jsonpath')
const config = require('config')
const uuid = require('uuid')
const schema = require('scirichon-json-schema')
const common = require('scirichon-common')
const ScirichonError = common.ScirichonError
const cypherBuilder = require('../cypher/cypherBuilder')
const scirichon_cache = require('scirichon-cache')
const cypherInvoker = require('../cypher/cypherInvoker')

const getCategoryByUrl = function (ctx) {
  let category; let val; let routeSchemas = schema.getApiRouteSchemas()
  for (val of routeSchemas) {
    if (ctx.path === val.route) {
      category = val.id
      break
    }
  }
  if (!category) {
    for (val of routeSchemas) {
      if (ctx.path.includes(val.route)) {
        category = val.id
        break
      }
    }
  }
  if (!category) {
    throw new ScirichonError(`can not find category for ${ctx.path}`)
  }
  return category
}

const getIndexByCategory = (category) => {
  let schema_obj = schema.getAncestorSchema(category); let index
  if (schema_obj && schema_obj.search && schema_obj.search.index) {
    index = schema_obj.search.index
  }
  return index
}

const assignFields4Query = async function (params, ctx) {
  params.category = params.category || getCategoryByUrl(ctx)
  if (params.page) {
    params.pagination = true
    params.limit = params.per_page = parseInt(params.per_page || config.get('perPageSize'))
    params.skip = (parseInt(params.page) - 1) * parseInt(params.per_page)
  }
}

const objectFields2String = (params) => {
  let object = _.cloneDeep(params)
  let objectFields = schema.getSchemaObjectProperties(params.category)
  for (let key of objectFields) {
    if (_.isObject(params[key])) {
      object[key] = JSON.stringify(params[key])
    }
  }
  return object
}

const stringFields2Object = (params) => {
  let object = _.cloneDeep(params)
  let objectFields = schema.getSchemaObjectProperties(params.category)
  for (let key of objectFields) {
    if (_.isString(params[key])) {
      try {
        object[key] = JSON.parse(params[key])
      } catch (error) {
        // just ignore
      }
    }
  }
  return object
}

const checkReferenceObj = async (key, value) => {
  let cached_val = await scirichon_cache.getItemByCategoryAndID(key, value)
  if (!cached_val || !cached_val.uuid) {
    throw new ScirichonError(`不存在引用类型为${key},id为${value}的节点`)
  }
  return cached_val
}

const checkReferenceAndSetNameField = async (params) => {
  let refs = schema.getSchemaRefProperties(params.category); let key; let path; let key_name; let vals; let val; let category; let ref_obj; let ref_names
  if (refs) {
    for (let ref of refs) {
      key = ref.attr
      path = `$.${key}`
      vals = jp.query(params.fields, path)
      key_name = _.replace(key, /\./g, '_') + '_name'
      category = ref.schema || (ref.items && ref.items.schema)
      if (vals && vals.length) {
        if (ref.type === 'array' && ref.item_type) {
          vals = _.isArray(vals[0]) ? vals[0] : vals
          ref_names = []
          for (let val of vals) {
            if (_.isString(val)) {
              ref_obj = await checkReferenceObj(category, val)
              if (ref_obj && ref_obj.unique_name && config.get('addRefUniqueNameField')) {
                ref_names.push(ref_obj.unique_name)
              }
            }
          }
          if (ref_names.length) {
            params.fields[key_name] = ref_names
          }
        } else {
          val = vals[0]
          if (!_.isEmpty(val)) {
            ref_obj = await checkReferenceObj(category, val)
            if (ref_obj && ref_obj.unique_name && config.get('addRefUniqueNameField')) {
              params.fields[key_name] = ref_obj.unique_name
            }
          }
        }
      }
    }
  }
  return params
}

const checkIfUidReferencedByOthers = (uuid, items) => {
  for (let item of items) {
    item = stringFields2Object(item)
    let refProperties = schema.getSchemaRefProperties(item.category)
    for (let refProperty of refProperties) {
      let key = refProperty.attr
      let val = jp.query(item, `$.${key}`)[0]
      if (uuid === val || (_.isArray(val) && _.includes(val, uuid))) {
        throw new ScirichonError(`被类型为${item.category},id为${item.uuid}的节点引用，不允许删除`)
      }
    }
  }
}

const generateUniqueNameFieldAndCompoundModel = async (params, ctx) => {
  let schema_obj = schema.getAncestorSchema(params.category); let compound_obj = _.assign({ category: params.category }, params.fields)
  if (schema_obj.uniqueKeys && schema_obj.uniqueKeys.length) {
    params.fields.unique_name = params.fields[schema_obj.uniqueKeys[0]]
  } else if (schema_obj.compoundKeys && schema_obj.compoundKeys.length) {
    if (params.fields['name']) {
      compound_obj['name'] = params.fields['name']
    }
    for (let key of schema_obj.compoundKeys) {
      if (key !== 'name') {
        let category = _.capitalize(key)
        let result = await scirichon_cache.getItemByCategoryAndID(category, params.fields[key])
        if (!_.isEmpty(result)) {
          key = key + '_name'
          compound_obj[key] = result.name
        }
      }
    }
    let keyNames = _.map(schema_obj.compoundKeys, (key) => key !== 'name' ? key + '_name' : key)
    params.fields.unique_name = compound_obj.unique_name = common.buildCompoundKey(keyNames, compound_obj)
  }
  return compound_obj
}

const generateDynamicSeqField = async (params, ctx) => {
  let schema_obj = schema.getAncestorSchema(params.category)
  if (schema_obj && schema_obj.dynamicSeqField) {
    let result = await cypherInvoker.executeCypher(ctx, cypherBuilder.generateSequence(params.category), params)
    if (result && result.length) {
      params.fields[schema_obj.dynamicSeqField] = String(result[0])
    }
  }
}

const checkUniqueField = async (params, ctx) => {
  if (params.procedure && params.procedure.ignoreUniqueCheck) {
  } else {
    if (params.fields.unique_name) {
      let obj = await scirichon_cache.getItemByCategoryAndUniqueName(params.category, params.fields.unique_name)
      if (!_.isEmpty(obj)) {
        throw new ScirichonError(`${params.category}存在名为"${params.fields.unique_name}"的同名对象`)
      }
    }
  }
}

const generateFieldsForCreate = async (params, ctx) => {
  params.fields = legacyFormat(params) ? _.assign({}, params.data.fields) : _.assign({}, params)
  params.category = params.fields.category = legacyFormat(params) ? params.data.category : params.category
  params.uuid = params.fields.uuid = params.fields.uuid || uuid.v1()
  params.fields.created = params.fields.created || Date.now()
  params.fields.lastUpdated = params.fields.lastUpdated || Date.now()
  await generateDynamicSeqField(params, ctx)
  await generateUniqueNameFieldAndCompoundModel(params, ctx)
  await checkUniqueField(params, ctx)
}

const generateFieldsForUpdate = async (result, params, ctx) => {
  params.change = legacyFormat(params) ? _.assign({}, params.data.fields) : _.assign({}, params)
  params.fields_old = stringFields2Object(_.omit(result, 'id'))
  params.fields = _.assign({}, params.fields_old, params.change)
  params.fields.lastUpdated = params.change.lastUpdated || Date.now()
  await generateUniqueNameFieldAndCompoundModel(params, ctx)
}

const assignFields4CreateOrUpdate = async (params, ctx) => {
  params.category = legacyFormat(params) ? params.data.category : params.category
  if (ctx.method === 'POST') {
    await generateFieldsForCreate(params, ctx)
  } else if (ctx.method === 'PUT' || ctx.method === 'PATCH') {
    let result = await cypherInvoker.executeCypher(ctx, cypherBuilder.generateQueryNodeCypher(params), params)
    if (result && result[0]) {
      await generateFieldsForUpdate(result[0], params, ctx)
    } else {
      throw new ScirichonError('不存在该节点,更新失败')
    }
  }
  await checkReferenceAndSetNameField(params)
}

const assignFields4Delete = async (params, ctx) => {
  if (params.uuid) {
    params.category = params.category || getCategoryByUrl(ctx)
    let result = await cypherInvoker.executeCypher(ctx, cypherBuilder.generateQueryNodeWithRelationCypher(params), params)
    if (result && result[0]) {
      result = result[0]
      if (result.self) {
        params.fields_old = stringFields2Object(_.omit(result.self, 'id'))
        if (result.items && result.items.length && params.force_delete !== 'true') {
          checkIfUidReferencedByOthers(params.uuid, result.items)
        }
      }
    } else {
      throw new ScirichonError('不存在该节点,删除失败')
    }
  } else if (ctx.url.includes('/api/items') && ctx.method === 'DELETE') {
    ctx.deleteAll = true
  }
}

const legacyFormat = (params, ctx) => {
  return params.data && params.data.fields && params.data.category
}

const assignFields = async (params, ctx) => {
  if (ctx.method === 'POST' || ctx.method === 'PUT' || ctx.method === 'PATCH') {
    await assignFields4CreateOrUpdate(params, ctx)
  } else if (ctx.method === 'DELETE') {
    await assignFields4Delete(params, ctx)
  } else if (ctx.method === 'GET') {
    await assignFields4Query(params, ctx)
  }
}

const generateCypher = async (params, ctx) => {
  if (ctx.method === 'POST') {
    params.cypher = cypherBuilder.generateAddCyphers(params)
  } else if (ctx.method === 'PUT' || ctx.method === 'PATCH') {
    params.cypher = cypherBuilder.generateUpdateCyphers(params)
  } else if (ctx.method === 'DELETE') {
    params.cypher = cypherBuilder.generateDelNodeCyphers(params)
  } else if (ctx.method === 'GET') {
    if (params.uuid) {
      params.cypher = cypherBuilder.generateQueryNodeCypher(params)
    } else {
      params.cypher = cypherBuilder.generateQueryNodesCypher(params)
      if (params.tags || params.subcategory) {
        params.tags = (params.tags || params.subcategory).split(',')
        params.cypher = cypherBuilder.generateQueryItemByCategoryCypher(params)
      }
    }
  }
}

const handleRequest = async (params, ctx) => {
  await assignFields(params, ctx)
  await generateCypher(params, ctx)
  return params
}

module.exports = { getCategoryByUrl, handleRequest, getIndexByCategory, generateUniqueNameFieldAndCompoundModel, stringFields2Object, legacyFormat, objectFields2String }
