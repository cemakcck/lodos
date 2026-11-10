import Fastify from "fastify";

const app = Fastify({ logger: true });
await app.listen({ port: Number(process.env.PORT ?? 4100), host: "0.0.0.0" });
