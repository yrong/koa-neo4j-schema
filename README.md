An easy to use framework to build rest api service with [koa-neo4j](https://github.com/assister-ai/koa-neo4j-starter-kit),data models are fully declarative by [json-schema](http://json-schema.org/)

## features

* fully declarative koa routes,relationship in neo4j　by json schema

## data modeling based on json schema extension attributes

### basic model

```
{
  "id": "User",
  "type": "object",
  "properties": {
    "alias": {
      "type": "string"
    },
    "name": {
      "type": "string"
    },
    "lang": {
      "type": "string"
    },
    "userid":{
      "type":"integer"
    },
    "passwd":{
      "type":"string"
    }
  },
  "route":"/users"
}
```

* first each data model is a valid json schema,so model 'User' will be validated with [ajv](https://github.com/epoberezkin/ajv) as json object with fields and related data types as above

* data model with attribute `"route":"/users"`  will generate restful api interface with route `/users`

```
POST /users

PUT  /users/:uuid

DELETE /users/:uuid

GET /users/:uuid

GET /users
```

* `"id":"User"` is not only the id of the json schema but also the label of the node stored in neo4j

### model reference others

```
{
  "id": "ConfigurationItem",
  "type": "object",
  "properties": {
    "name": {
      "type": "string"
    },
    "responsibility":{
        "type": "integer",
        "schema":"User",
        "relationship":{"name":"RESPONSIBLE_FOR","reverse":true}
    },
    ...
  },
  "required": ["name"],
  "route": "/cfgItems",
  "search":{"index":"cmdb"}
}
```

* `schema` means field `responsibility` in model `ConfigurationItem` reference model `User` and will generate relationship in neo4j as following

    (:ConfigurationItem)<-[:RESPONSIBLE_FOR]-(:User)

* `search` means instance of `ConfigurationItem` will also stored in elasticsearch with `cmdb` as index name

## Search

* query interfaces which use cypher and elasticsearch dsl(will I called eql) directly

```cypher
api/searchByCypher
{
	"category":"ITService",
	"search":["email","pop3"],
	"cypher":"OPTIONAL MATCH (s1:ITService) WHERE s1.uuid IN {search} or s1.group IN {search} WITH COLLECT(distinct(s1.uuid)) as services_byIds UNWIND {search} as keyword OPTIONAL MATCH (s1:ITService)-[:BelongsTo]->(sg:ITServiceGroup) WHERE s1.name = keyword or sg.name = keyword WITH services_byIds+collect(distinct(s1.uuid)) as services UNWIND services AS service RETURN COLLECT(distinct service)"
}
```

`category` is id of the model,`cypher` is the raw cypher query, other fields are required parameters in cypher query

```eql
api/searchByEql
{
  "category":"ConfigurationItem",
  "body":
  {
      "query": {
      	"bool":{
      		"must":[
      			{"match": {"category": "Router"}},
      			{"match":{"status.status":"In_Use"}},
      			{"match":{"it_service":"{{service_email_id}}"}}
      		]
      	}

      },
      "sort" : [
          { "product_date" : {"order" : "desc"}}]
  }
}
```

`category` is id of the model,`body` is the raw eql


## Deploy

1. install db server

 [neo4j](http://neo4j.com/docs/operations-manual/current/installation/)

 [elasticsearch](https://www.elastic.co/guide/en/elasticsearch/reference/master/_installation.html)

 [redis](https://redis.io/topics/quickstart)

2. install npm dependencies

    npm install

3. configuration

    modify value in config/default.json to match db configuration

    ```
      "neo4j": {
        "host": "localhost",
        "port": 7687,
        "http_port":7474,
        "user": "neo4j",
        "password": "neo4j"
      },
      "elasticsearch":{
        "host": "localhost",
        "port": 9200,
        "requestTimeout":3000,
        "mode": "strict"
      },
      "redis": {
        "host": "localhost",
        "port": 6379
      },
    ```


4. init Schema

    npm run init

5. start

    npm start
    

6. run integration test cases with [postman](https://www.getpostman.com/docs/)

    npm test

