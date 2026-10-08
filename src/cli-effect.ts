/**
 * Effect/cli program
 *
 */
import { Effect, pipe, Schema } from "effect"
import { OAuth2ApiService } from './api/oauth2.js'
import { type ParseError } from "./fp/errors.js"

const uuidRegexp = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i
const ClientIdV = pipe(
  Schema.NonEmptyString,
  Schema.pattern(uuidRegexp)
)


type ClientIdV = Schema.Schema.Type<typeof ClientIdV>
const parseClientId = (clientId:string): Effect.Effect<string, ParseError, never> => {
  return Schema.decode(ClientIdV)(clientId)
}

// class CliService extends Context.Tag("CliService")<
//   CliService,
//   { readonly getClient(clientId: string): Effect.Effect<OAuth2ApiService, >,
//     readonly createClient(clientId: string): Effect.Effect<OAuth2ApiService>,
//     readonly listClients(): Effect.Effect<OAuth2ApiService>
//     readonly deleteClient(clientId:string): Effect.Effect<OAuth2ApiService>
//    }
//   >() {}

export const getClient = (clientId: string) => {
  Effect.gen(function* () {
    yield* parseClientId(clientId)
    const client = yield* OAuth2ApiService
    yield* client.getClient(clientId)
  })
}

// export const createClient = (clientName: string) => {
//   Effect.gen(function* () {
//     const client = yield* OAuth2ApiService
//     client.createClient()
//   })
// }


/**
 * there is a layer and a program
 */
// const runEffect = async <A, E>(
//   program: Effect.Effect<A, E, OAuth2ApiService>
// ): Promise<Exit.Exit<A, E>> => {
//   const layer = setupLayer()
//   const runnable = Effect.provide(program, layer)
//   return Effect.runPromiseExit(runnable)
// }

// export const getClient = Effect.gen(function* () {
//     const client = yield* OAuth2ApiService
//     const parsed = yield* parseClientId(clientId)
//     yield* logger.info(`Validated clientId ${parsed}`)
//     const clientData = yield* client.getClient(clientId)
//     clientData
//   })

// Effect.runPromise(getClient)
