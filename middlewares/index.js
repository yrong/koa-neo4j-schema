const middleware = require('../middleware')

module.exports = {
  load: (app) => {
    middleware(app)
  }
}
