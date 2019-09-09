const assert = require('chai').assert
const uuid = require('uuid')
const _ = require('lodash')
const supertest = require('supertest')
const common = require('scirichon-common')
const crudHandler = require('../index')
const config = require('config')
const scirichonCache = require('scirichon-cache')

describe('scirichon-crud-handler', () => {
  let app, request, it_service, os, physicalServer, physicalServers
  const tokenHeaderName = common.getConfigWithDefaultValue('auth.tokenFieldName', 'token')

  const internalToken = common.getConfigWithDefaultValue('auth.internalUsedToken', 'internal')


  before(async () => {
    app = await crudHandler.initApp()
    app.router.post('/upload', async(ctx, next) => {
      console.log('files: ', ctx.request.files);
      ctx.body = {}
    })
    await new Promise((resolve, reject) => {
      app.server.listen(config.get(`${process.env['NODE_NAME']}.port`),() => {
        request = supertest(app.server)
        request.del(`/hidden/clean`).set(tokenHeaderName, internalToken).then(resolve)
      })
    })
  })

  after(async () => {
    await app.server.close()
  })

  beforeEach(async () => {
    request = supertest(app.server)
  })

  it('add itservice', async () => {
    it_service = { name: 'email' }
    it_service.uuid = uuid.v1()
    it_service.unique_name = it_service.name
    it_service.category = 'ITService'
    const response = await request.post(`/api/it_services/service`).send(it_service).set(tokenHeaderName, internalToken)
    assert.equal(response.statusCode, 200)
  })

  it('add os', async () => {
    os = { name: 'ubuntu' }
    os.uuid = uuid.v1()
    os.unique_name = os.name
    os.category = 'Software'
    const response = await request.post(`/api/cfgItems`).send(os).set(tokenHeaderName, internalToken)
    assert.equal(response.statusCode, 200)
  })

  it('add physicalServer', async () => {
    physicalServer = {
      'name': 'server',
      'ip_address': ['192.168.0.108'],
      'technical_support_info': '010-123456',
      'storage_info': 'hp-disk1',
      'model': 'b10',
      'product_date': '2016-10-11',
      'warranty_expiration_date': '2016-11-11',
      'retirement_date': '2017-02-11',
      'management_ip': ['192.168.0.108'],
      'monitored': true,
      'asset_id': 'test',
      'test_date': 1511936480773
    }
    physicalServer.uuid = uuid.v1()
    physicalServer.unique_name = physicalServer.name
    physicalServer.category = 'PhysicalServer'
    physicalServer.operating_system = os.uuid
    physicalServer.it_service = [it_service.uuid]
    const response = await request.post(`/api/cfgItems`).send(physicalServer).set(tokenHeaderName, internalToken)
    assert.equal(response.statusCode, 200)
  })

  it('get physicalServer', async () => {
    await scirichonCache.flushAll()
    const response = await request.get(`/api/cfgItems/${physicalServer.uuid}`).set(tokenHeaderName, internalToken)
    assert.equal(response.body.data.model, 'b10')
    assert.equal(response.body.data.it_service[0].name, 'email')
    assert.equal(response.body.data.operating_system.name, 'ubuntu')
  })

  it('update physicalServer', async () => {
    const patch_obj = { model: 'b11', category: 'PhysicalServer' }
    let response = await request.put(`/api/cfgItems/${physicalServer.uuid}`).send(patch_obj).set(tokenHeaderName, internalToken)
    assert.equal(response.statusCode, 200)
  })

  it('physicalServer model changed', async () => {
    let response = await request.get(`/api/cfgItems/${physicalServer.uuid}`).set(tokenHeaderName, internalToken)
    assert.equal(response.statusCode, 200)
    assert.equal(response.body.data.model, 'b11')
  })

  it('delete physicalServer', async () => {
    let response = await request.del(`/api/cfgItems/${physicalServer.uuid}`).set(tokenHeaderName, internalToken)
    assert.equal(response.statusCode, 200)
    await request.get(`/api/cfgItems/${physicalServer.uuid}`).set(tokenHeaderName, internalToken)
    response = await request.get(`/api/cfgItems/${physicalServer.uuid}`).set(tokenHeaderName, internalToken)
    assert.deepEqual(response.body, {})
  })

  it('add physicalServer with wrong parameter test_date(must be timestamp not empty) failed', async () => {
    let bakServer = Object.assign({}, physicalServer, { model: 'b12', test_date: '', name: 'bak', uuid: uuid.v1(), ip_address: ['192.168.0.107'] })
    let response = await request.post(`/api/cfgItems`).send(bakServer).set(tokenHeaderName, internalToken)
    assert.equal(response.statusCode, 501)
    response = await request.get(`/api/cfgItems/${bakServer.uuid}`).set(tokenHeaderName, internalToken)
    assert.deepEqual(response.body, {})
  })

  it('batch add physicalServer', async () => {
    physicalServers = [{
      'name': 'AS-2285-1',
      'ip_address': ['192.168.0.109'],
      'model': 'b10',
      'product_date': '2016-10-11',
      'warranty_expiration_date': '2016-11-11',
      'retirement_date': '2017-02-11',
      'management_ip': ['192.168.0.108'],
      'monitored': true,
      'asset_id': 'test',
      'operating_system': os.uuid,
      'it_service': [it_service.uuid],
      'uuid': uuid.v1()
    }, {
      'name': 'AS-2285-2',
      'ip_address': ['192.168.0.110'],
      'model': 'b12',
      'product_date': '2016-10-11',
      'warranty_expiration_date': '2016-11-11',
      'retirement_date': '2017-02-11',
      'management_ip': ['192.168.0.108'],
      'monitored': true,
      'asset_id': 'test',
      'operating_system': os.uuid,
      'it_service': [it_service.uuid],
      'uuid': uuid.v1()
    }]
    const data = { data: { category: 'PhysicalServer', fields: physicalServers } }
    const response = await request.post(`/batch/api/cfgItems`).send(data).set(tokenHeaderName, internalToken)
    assert.equal(response.statusCode, 200)
    assert.equal(response.body.data.length, 2)
  })

  it('batch update physicalServer', async () => {
    const patch_obj = { model: 'b15' }
    const data = { data: { category: 'PhysicalServer', uuids: _.map(physicalServers, (physicalServer) => physicalServer.uuid), fields: patch_obj } }
    let response = await request.put(`/batch/api/cfgItems`).send(data).set(tokenHeaderName, internalToken)
    assert.equal(response.statusCode, 200)
    response = await request.get(`/api/cfgItems/${physicalServers[0].uuid}`).set(tokenHeaderName, internalToken)
    assert.equal(response.body.data.model, 'b15')
  })

  it('batch delete physicalServer', async () => {
    const data = { data: { category: 'PhysicalServer', uuids: _.map(physicalServers, (physicalServer) => physicalServer.uuid) } }
    let response = await request.del(`/batch/api/cfgItems`).send(data).set(tokenHeaderName, internalToken)
    assert.equal(response.statusCode, 200)
  })

  it('upload file', async () => {
    const data = { data: { category: 'PhysicalServer', uuids: _.map(physicalServers, (physicalServer) => physicalServer.uuid) } }
    let response = await request.post(`/upload`).set(tokenHeaderName, internalToken).attach('file', 'package.json')
    assert.equal(response.statusCode, 200)
  })
})
