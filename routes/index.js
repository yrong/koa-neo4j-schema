const compose = require('koa-compose')
const route = require('../route')

module.exports = {
  load: (app) => {
    route(app)
  }
}
