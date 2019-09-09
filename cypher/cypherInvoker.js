const { parse } = require('parse-neo4j')

const executeCypher = async (ctx, cypher, params) => {
  let result = await ctx.app.neo4jConnection.executeCypher(cypher, params, true)
  return result
}

const batchExecuteCypher = async (ctx, cyphers, params) => {
  const session = ctx.app.neo4jConnection.driver.session()
  let results = []; let result
  try {
    const tx = session.beginTransaction()
    for (let cypher of cyphers) {
      result = await tx.run(cypher, params)
      result = parse(result)
      results.push(result)
    }
    await tx.commit()
    session.close()
  } catch (error) {
    session.close()
    throw new Error(`error while executing Cypher: ${error}`)
  }
  return results
}

module.exports = { executeCypher, batchExecuteCypher }
