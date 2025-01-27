/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

'use strict'

const { test } = require('tap')
const { errors } = require('../../index')
const {
  Client,
  buildServer,
  connection: { MockConnection }
} = require('../utils')

test('Should create a child client (headers check)', t => {
  t.plan(4)

  let count = 0
  function handler (req, res) {
    if (count++ === 0) {
      t.match(req.headers, { 'x-foo': 'bar' })
    } else {
      t.match(req.headers, { 'x-baz': 'faz' })
    }
    res.setHeader('Content-Type', 'application/json;utf=8')
    res.end(JSON.stringify({ hello: 'world' }))
  }

  buildServer(handler, ({ port }, server) => {
    const client = new Client({
      node: `http://localhost:${port}`,
      headers: { 'x-foo': 'bar' }
    })
    const child = client.child({
      headers: { 'x-baz': 'faz' }
    })

    client.info((err, res) => {
      t.error(err)
      child.info((err, res) => {
        t.error(err)
        server.stop()
      })
    })
  })
})

test('Should create a child client (timeout check)', t => {
  t.plan(2)

  function handler (req, res) {
    setTimeout(() => {
      res.setHeader('Content-Type', 'application/json;utf=8')
      res.end(JSON.stringify({ hello: 'world' }))
    }, 50)
  }

  buildServer(handler, ({ port }, server) => {
    const client = new Client({ node: `http://localhost:${port}` })
    const child = client.child({ requestTimeout: 25, maxRetries: 0 })

    client.info((err, res) => {
      t.error(err)
      child.info((err, res) => {
        t.ok(err instanceof errors.TimeoutError)
        server.stop()
      })
    })
  })
})

test('Client extensions', t => {
  t.test('One level', t => {
    t.plan(1)

    const client = new Client({ node: 'http://localhost:9200' })
    client.extend('utility.index', () => {
      return () => t.ok('called')
    })

    const child = client.child()
    child.utility.index()
  })

  t.test('Two levels', t => {
    t.plan(2)

    const client = new Client({ node: 'http://localhost:9200' })
    client.extend('utility.index', () => {
      return () => t.ok('called')
    })

    const child = client.child()
    child.extend('utility.search', () => {
      return () => t.ok('called')
    })

    const grandchild = child.child()
    grandchild.utility.index()
    grandchild.utility.search()
  })

  t.test('The child should not extend the parent', t => {
    t.plan(1)

    const client = new Client({ node: 'http://localhost:9200' })
    const child = client.child()

    child.extend('utility.index', () => {
      return () => t.fail('Should not be called')
    })

    try {
      client.utility.index()
    } catch (err) {
      t.ok(err)
    }
  })

  t.end()
})

test('Should share the event emitter', t => {
  t.test('One level', t => {
    t.plan(2)

    const client = new Client({
      node: 'http://localhost:9200',
      Connection: MockConnection
    })
    const child = client.child()

    client.on('response', (err, meta) => {
      t.error(err)
    })

    child.info((err, res) => {
      t.error(err)
    })
  })

  t.test('Two levels', t => {
    t.plan(2)

    const client = new Client({
      node: 'http://localhost:9200',
      Connection: MockConnection
    })
    const child = client.child()
    const grandchild = child.child()

    client.on('response', (err, meta) => {
      t.error(err)
    })

    grandchild.info((err, res) => {
      t.error(err)
    })
  })

  t.test('Child listener - one level', t => {
    t.plan(2)

    const client = new Client({
      node: 'http://localhost:9200',
      Connection: MockConnection
    })
    const child = client.child()

    child.on('response', (err, meta) => {
      t.error(err)
    })

    child.info((err, res) => {
      t.error(err)
    })
  })

  t.test('Child listener - two levels', t => {
    t.plan(2)

    const client = new Client({
      node: 'http://localhost:9200',
      Connection: MockConnection
    })
    const child = client.child()
    const grandchild = child.child()

    child.on('response', (err, meta) => {
      t.error(err)
    })

    grandchild.info((err, res) => {
      t.error(err)
    })
  })

  t.end()
})

test('Should create a child client (generateRequestId check)', t => {
  t.plan(6)

  function generateRequestId1 () {
    let id = 0
    return () => `trace-1-${id++}`
  }

  function generateRequestId2 () {
    let id = 0
    return () => `trace-2-${id++}`
  }

  const client = new Client({
    node: 'http://localhost:9200',
    Connection: MockConnection,
    generateRequestId: generateRequestId1()
  })
  const child = client.child({
    Connection: MockConnection,
    generateRequestId: generateRequestId2()
  })

  let count = 0
  client.on('request', (err, { meta }) => {
    t.error(err)
    t.equal(
      meta.request.id,
      count++ === 0 ? 'trace-1-0' : 'trace-2-0'
    )
  })

  client.info(err => {
    t.error(err)
    child.info(t.error)
  })
})

test('Should create a child client (name check)', t => {
  t.plan(8)

  const client = new Client({
    node: 'http://localhost:9200',
    Connection: MockConnection,
    name: 'parent'
  })
  const child = client.child({
    Connection: MockConnection,
    name: 'child'
  })

  t.equal(client.name, 'parent')
  t.equal(child.name, 'child')

  let count = 0
  client.on('request', (err, { meta }) => {
    t.error(err)
    t.equal(
      meta.name,
      count++ === 0 ? 'parent' : 'child'
    )
  })

  client.info(err => {
    t.error(err)
    child.info(t.error)
  })
})

test('Should create a child client (auth check)', t => {
  t.plan(4)

  let count = 0
  function handler (req, res) {
    if (count++ === 0) {
      t.match(req.headers, { authorization: 'Basic Zm9vOmJhcg==' })
    } else {
      t.match(req.headers, { authorization: 'ApiKey foobar' })
    }
    res.setHeader('Content-Type', 'application/json;utf=8')
    res.end(JSON.stringify({ hello: 'world' }))
  }

  buildServer(handler, ({ port }, server) => {
    const client = new Client({
      node: `http://localhost:${port}`,
      auth: {
        username: 'foo',
        password: 'bar'
      }
    })
    const child = client.child({
      auth: {
        apiKey: 'foobar'
      }
    })

    client.info((err, res) => {
      t.error(err)
      child.info((err, res) => {
        t.error(err)
        server.stop()
      })
    })
  })
})
