#!/usr/bin/env node

/* eslint eqeqeq: 0 */
require('dotenv').config()
const config = require('config')
const scirichonCache = require('scirichon-cache')
const apiHandler = require('./index')

apiHandler.initApp().then((app) => {
  if (!process.env['NODE_NAME'] || !process.env['SCHEMA_TYPE']) {
    console.log('missing env config')
    process.exit(1)
  }
  app.server.listen(config.get(`${process.env['NODE_NAME']}.port`), async function () {
    console.log('server started')
    if (process.env['INIT_CACHE'] == 1) {
      await scirichonCache.loadAll()
    }
  })
}).catch(err => console.log(err.stack || err))
