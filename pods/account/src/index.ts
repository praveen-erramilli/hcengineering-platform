//
// Copyright © 2020, 2021 Anticrm Platform Contributors.
// Copyright © 2021 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import account, { ACCOUNT_DB, type AccountMethod, accountId, cleanInProgressWorkspaces } from '@hcengineering/account'
import accountEn from '@hcengineering/account/lang/en.json'
import accountRu from '@hcengineering/account/lang/ru.json'
import { registerProviders } from '@hcengineering/auth-providers'
import { type MeasureContext } from '@hcengineering/core'
import platform, { Severity, Status, addStringsLoader, setMetadata } from '@hcengineering/platform'
import serverToken from '@hcengineering/server-token'
import toolPlugin from '@hcengineering/server-tool'
import cors from '@koa/cors'
import { type IncomingHttpHeaders } from 'http'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import Router from 'koa-router'
import { MongoClient } from 'mongodb'

/**
 * @public
 */
export function serveAccount (measureCtx: MeasureContext, methods: Record<string, AccountMethod>, productId = ''): void {
  const ACCOUNT_PORT = parseInt(process.env.ACCOUNT_PORT ?? '3000')
  const dbUri = process.env.MONGO_URL
  if (dbUri === undefined) {
    console.log('Please provide mongodb url')
    process.exit(1)
  }

  const transactorUri = process.env.TRANSACTOR_URL
  if (transactorUri === undefined) {
    console.log('Please provide transactor url')
    process.exit(1)
  }

  const endpointUri = process.env.ENDPOINT_URL ?? transactorUri

  const serverSecret = process.env.SERVER_SECRET
  if (serverSecret === undefined) {
    console.log('Please provide server secret')
    process.exit(1)
  }

  addStringsLoader(accountId, async (lang: string) => {
    switch (lang) {
      case 'en':
        return accountEn
      case 'ru':
        return accountRu
      default:
        return accountEn
    }
  })

  const ses = process.env.SES_URL
  const frontURL = process.env.FRONT_URL
  const productName = process.env.PRODUCT_NAME
  const lang = process.env.LANGUAGE ?? 'en'

  setMetadata(platform.metadata.locale, lang)
  setMetadata(account.metadata.ProductName, productName)
  setMetadata(account.metadata.SES_URL, ses)
  setMetadata(account.metadata.FrontURL, frontURL)

  setMetadata(serverToken.metadata.Secret, serverSecret)

  const initWS = process.env.INIT_WORKSPACE
  if (initWS !== undefined) {
    setMetadata(toolPlugin.metadata.InitWorkspace, initWS)
  }
  setMetadata(toolPlugin.metadata.Endpoint, endpointUri)
  setMetadata(toolPlugin.metadata.Transactor, transactorUri)
  setMetadata(toolPlugin.metadata.UserAgent, 'AccountService')

  let client: MongoClient | Promise<MongoClient> = MongoClient.connect(dbUri)

  const app = new Koa()
  const router = new Router()

  void client.then((p: MongoClient) => {
    const db = p.db(ACCOUNT_DB)
    registerProviders(measureCtx, app, router, db, productId, serverSecret, frontURL)

    // We need to clean workspace with creating === true, since server is restarted.
    void cleanInProgressWorkspaces(db, productId)
  })

  const extractToken = (header: IncomingHttpHeaders): string | undefined => {
    try {
      return header.authorization?.slice(7) ?? undefined
    } catch {
      return undefined
    }
  }

  router.post('rpc', '/', async (ctx) => {
    const token = extractToken(ctx.request.headers)

    const request = ctx.request.body as any
    const method = methods[request.method]
    if (method === undefined) {
      const response = {
        id: request.id,
        error: new Status(Severity.ERROR, platform.status.UnknownMethod, { method: request.method })
      }

      ctx.body = JSON.stringify(response)
    }

    if (client instanceof Promise) {
      client = await client
    }
    const db = client.db(ACCOUNT_DB)
    const result = await method(measureCtx, db, productId, request, token)
    ctx.body = result
  })

  app.use(
    cors({
      credentials: true
    })
  )
  app.use(bodyParser())
  app.use(router.routes()).use(router.allowedMethods())

  const server = app.listen(ACCOUNT_PORT, () => {
    console.log(`server started on port ${ACCOUNT_PORT}`)
  })

  const close = (): void => {
    if (client instanceof Promise) {
      void client.then((c) => c.close())
    } else {
      void client.close()
    }
    server.close()
  }

  process.on('uncaughtException', (e) => {
    console.error(e)
  })

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  })

  process.on('SIGINT', close)
  process.on('SIGTERM', close)
  process.on('exit', close)
}
