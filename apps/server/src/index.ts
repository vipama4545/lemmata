// The server: Better Auth on /api/auth, oRPC on /rpc, and nothing else.
//
// The one subtlety is the body. oRPC wants to parse requests itself, so it needs Fastify to
// hand it the raw stream; Better Auth's handler wants a parsed body. Those are incompatible
// as a global setting, so the oRPC routes live inside their own plugin — Fastify keeps
// content-type parsers to the scope they were registered in, and the auth routes outside it
// keep the ordinary JSON parser.

import compress from '@fastify/compress';
import cors from '@fastify/cors';
import { RPCHandler } from '@orpc/server/fastify';
import { onError } from '@orpc/server';
import Fastify from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from './auth.ts';
import { env, isProduction } from './env.ts';
import { assertMailConfigured, mailEnabled } from './mail/mailgun.ts';
import { router } from './router/index.ts';
import { registerTtsRoutes } from './tts/routes.ts';
import { sql } from './db/index.ts';

assertMailConfigured();

const app = Fastify({
  logger: isProduction
    ? true
    : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } },
  // Behind a proxy in production, so that the session cookie's Secure flag and the client
  // IP recorded against a session both reflect the connection the browser actually made.
  trustProxy: isProduction,
});

await app.register(cors, {
  origin: env.WEB_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  // Without this the session cookie is neither sent nor accepted cross-origin.
  credentials: true,
  maxAge: 86_400,
});

// The snapshot is around four megabytes of JSON and compresses to well under a tenth of
// that. This is the single highest-value line in the file.
await app.register(compress, { global: true, threshold: 1024, encodings: ['br', 'gzip', 'deflate'] });

/* ------------------------------------------------------------------- auth */

app.route({
  method: ['GET', 'POST'],
  url: '/api/auth/*',
  async handler(request, reply) {
    const url = new URL(request.url, env.BETTER_AUTH_URL);
    const response = await auth.handler(
      new Request(url, {
        method: request.method,
        headers: fromNodeHeaders(request.headers),
        body: request.body ? JSON.stringify(request.body) : undefined,
      }),
    );

    reply.status(response.status);

    // Set-Cookie has to be lifted out separately. Headers.forEach folds repeated headers
    // into one comma-joined string, which is right for every header except this one — a
    // sign-in that sets both a session cookie and a CSRF cookie would arrive as a single
    // malformed cookie and the browser would keep neither.
    const cookies = response.headers.getSetCookie();
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'set-cookie') reply.header(key, value);
    });
    if (cookies.length > 0) reply.header('set-cookie', cookies);

    return reply.send(response.body ? await response.text() : null);
  },
});

/* -------------------------------------------------------------------- rpc */

const handler = new RPCHandler(router, {
  interceptors: [
    onError(error => {
      app.log.error({ err: error }, 'rpc');
    }),
  ],
});

await app.register(async instance => {
  // Scoped to this plugin: let oRPC read the body itself, whatever the content type.
  instance.addContentTypeParser('*', (_request, _payload, done) => done(null, undefined));

  instance.all('/rpc/*', async (request, reply) => {
    // Resolved once here rather than inside each procedure, so a call that touches three
    // procedures still costs one session lookup.
    const headers = fromNodeHeaders(request.headers);
    const session = await auth.api.getSession({ headers });

    const { matched } = await handler.handle(request, reply, {
      prefix: '/rpc',
      context: { session, headers },
    });

    if (!matched) reply.status(404).send({ error: 'No such procedure' });
  });
});

/* ------------------------------------------------------------------ audio */

// Outside the oRPC plugin, so these keep the ordinary body parser and stay plain URLs a
// browser can hand to an <audio> element. See tts/routes.ts.
registerTtsRoutes(app);

/* ----------------------------------------------------------------- health */

app.get('/health', async () => {
  await sql`select 1`;
  return { ok: true, mail: mailEnabled ? 'mailgun' : 'console' };
});

/* -------------------------------------------------------------- lifecycle */

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.log.info(`${signal} received, closing`);
    void app.close().then(() => sql.end({ timeout: 5 })).then(() => process.exit(0));
  });
}

await app.listen({ host: env.HOST, port: env.PORT });

if (!mailEnabled) {
  app.log.warn('No Mailgun credentials: mail will be printed to this terminal, not sent.');
}
