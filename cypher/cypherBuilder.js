/* eslint camelcase: 0 */
const _ = require('lodash')
const schema = require('scirichon-json-schema')
const jp = require('jsonpath')

/** *******************************************crud cyphers**************************************************************/

/**
 * common template
 */
const addNodeCypher = (labels) => `MERGE (n:${labels} {uuid: $uuid})
                                    ON CREATE SET n = $stringified_fields
                                    ON MATCH SET n = $stringified_fields`

const generateNodeCypher = (params) => {
  let labels = schema.getParentCategories(params.category)
  if (params.fields && params.fields.tags) { labels = [...labels, ...params.fields.tags] }
  labels = _.isArray(labels) ? labels.join(':') : params.category
  return addNodeCypher(labels)
}

const generateDelNodeCypher = (params) => {
  return `MATCH (n:${params.category})
    WHERE n.uuid = $uuid
    DETACH
    DELETE n
    return n`
}

const generateDelNodesByCategoryCypher = (category) =>
  `MATCH (n:${category})
    DETACH
    DELETE n`

const generateQueryNodeCypher = (params) =>
  `MATCH (n:${params.category})
    WHERE n.uuid = $uuid
    RETURN n`

const findNodesCypher = (label, condition, sort, order) =>
  `MATCH (n:${label}) 
    ${condition}
    RETURN n
    ORDER BY ${sort} ${order}
    `

const findPaginatedNodesCypher = (label, condition, sort, order) =>
  `MATCH (n:${label})
    ${condition}
    WITH
    count(n) AS cnt
    MATCH
    (n:${label})
    ${condition}
    WITH
    n as n, cnt
    ORDER BY ${sort} ${order}
    SKIP $skip LIMIT $limit
    RETURN { count: cnt, results:collect(n) }`

/**
 * sequence id generator
 */
const generateSequence = () =>
  `MERGE (s:Sequence {category:$category})
    ON CREATE set s.current = 1
    ON MATCH set s.current=s.current+1
    WITH s.current as seq return seq`

/**
 * query item with members
 */
const generateQueryItemWithMembersCypher = (label) => {
  return `MATCH (n:${label} {uuid:$uuid})
    OPTIONAL MATCH
        (n)<-[:MemberOf]-(m)
    where not exists(m.status) or m.status<>'deleted'          
    WITH { self: n, members:collect(distinct m) } as item
    RETURN item`
}

/**
 * query node and relations
 */
const generateQueryNodeWithRelationCypher = (params) => {
  return `MATCH (n:${params.category}{uuid: $uuid})
    OPTIONAL MATCH (n)-[]-(c)
    WITH n as self,collect(c) as items
    RETURN self,items`
}

const generateQueryItemByCategoryCypher = (params) => {
  let condition = _.map(params.tags, (tag) => {
    return `n:${tag}`
  }).join(' OR ')
  return `MATCH (n) WHERE ((not exists(n.status) or n.status<>'deleted') and (${condition}))
    return n`
}

const generateQueryInheritHierarchyCypher = `MATCH (base:CategoryLabel{category:$category})
    MATCH (child)-[:INHERIT]->(base)
    RETURN child`

const generateInheritRelCypher = `MERGE (base:CategoryLabel{category:$category})
    MERGE (child:CategoryLabel{category:$subtype})
    MERGE (child)-[:INHERIT]->(base)`

const addRelCypher = (params, ref) => {
  let cypher = `MATCH (node:${params.category}{uuid:$uuid})
                MATCH (ref_node:${ref.schema}{uuid:$fields.${ref.attr}})`

  let rel_attr = ref.attr.split('.'); let relType = ref.relationship.name
  if (rel_attr.length === 1) {
    if (ref.type === 'array') {
      cypher = `UNWIND $fields.${ref.attr} as ref_id
                MATCH (node:${params.category} {uuid:$uuid})
                MATCH (ref_node:${ref.schema}{uuid:ref_id})`
    }
  } else if (rel_attr.length === 2) {
    cypher = `MATCH (node:${params.category}{uuid:$uuid})
                    MATCH (ref_node:${ref.schema}{uuid:$fields.${rel_attr[0]}.${rel_attr[1]}})`
  } else if (rel_attr.length === 3) {
    cypher = `UNWIND $fields.${rel_attr[0]} as ref_item
                    MATCH (node:${params.category} {uuid:$uuid})
                    MATCH (ref_node:${ref.schema}{uuid:ref_item.${rel_attr[2]}})`
  } else {
    throw new Error(`${ref.attr} not support`)
  }
  if (ref.relationship.reverse) { cypher = cypher + ` MERGE (node)<-[r:${relType}]-(ref_node)` } else { cypher = cypher + ` MERGE (node)-[r:${relType}]->(ref_node)` }
  if (ref.relationship.parentObjectAsRelProperty) {
    if (rel_attr.length === 2) {
      cypher = cypher + ` ON CREATE SET r=$fields.${rel_attr[0]} ON MATCH SET r=$fields.${rel_attr[0]}`
    } else if (rel_attr.length === 3) {
      cypher = cypher + ` ON CREATE SET r=ref_item ON MATCH SET r=ref_item`
    } else {
      throw new Error(`${ref.attr} not support for parentObjectAsRelProperty`)
    }
  }
  return cypher
}

const delRelCypher = (params, ref) => {
  return `MATCH (n:${params.category}{uuid:$uuid})-[r:${ref.relationship.name}]-() delete r`
}

const generateDeleteRelationCypher = (params) => {
  let refProperties = schema.getSchemaRefProperties(params.category); let val; let cypher; let cyphers = []
  for (let ref of refProperties) {
    val = jp.query(params.change, `$.${ref.attr}`)[0]
    if (val && ref.relationship) {
      cypher = delRelCypher(params, ref)
      cyphers.push(cypher)
    }
  }
  return cyphers
}

const generateAddRelationCypher = (params) => {
  let refProperties = schema.getSchemaRefProperties(params.category); let val; let cypher; let cyphers = []
  for (let ref of refProperties) {
    val = jp.query(params.fields, `$.${ref.attr}`)[0]
    if (val && ref.relationship) {
      cypher = addRelCypher(params, ref)
      cyphers.push(cypher)
    }
  }
  return cyphers
}

module.exports = {
  generateNodeCypher,
  generateAddRelationCypher,
  generateDeleteRelationCypher,
  generateAddCyphers: (params) => {
    let cyphers = [generateNodeCypher(params), ...generateAddRelationCypher(params)]
    return cyphers
  },
  generateUpdateCyphers: (params) => {
    let cyphers = [generateNodeCypher(params), ...generateDeleteRelationCypher(params), ...generateAddRelationCypher(params)]
    return cyphers
  },
  generateDelNodeCypher,
  generateQueryNodesCypher: (params) => {
    let condition = `where not exists(n.status) or n.status<>'deleted'`; let cypher

    let label = params.category; let sort = params.sort ? `n.${params.sort}` : `n.lastUpdated`

    let order = params.order ? params.order : 'DESC'
    if (params.status_filter) {
      params.status_filter = params.status_filter.split(',')
      condition = 'where '
      condition += _.map(params.status_filter, (status) => {
        return `n.status='${status}'`
      }).join(' or ')
    }
    if (params.pagination) {
      cypher = findPaginatedNodesCypher(label, condition, sort, order)
    } else {
      cypher = findNodesCypher(label, condition, sort, order)
    }
    return cypher
  },
  generateQueryNodeCypher,
  generateSequence,
  generateDelNodesByCategoryCypher,
  generateQueryNodeWithRelationCypher,
  generateQueryItemByCategoryCypher,
  generateQueryInheritHierarchyCypher,
  generateQueryItemWithMembersCypher,
  generateInheritRelCypher
}
