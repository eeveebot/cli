#!/usr/bin/env node

"use strict";

import * as Nats from "nats";

const natsClients = [];
const subscriptions = [];

//
// Do whatever teardown is necessary before calling common handler
process.on("SIGINT", () => {
  natsClients.forEach((natsClient) => {
    natsClient.drain();
  });
});

process.on("SIGTERM", () => {
  natsClients.forEach((natsClient) => {
    natsClient.drain();
  });
});

//
// Setup NATS connection

// Get host and token
const natsHost = process.env.NATS_HOST || false;
if (!natsHost) {
  const msg = "environment variable NATS_HOST is not set.";
  throw new Error(msg);
}

const natsToken = process.env.NATS_TOKEN || false;
if (!natsToken) {
  const msg = "environment variable NATS_TOKEN is not set.";
  throw new Error(msg);
}

const nats = await Nats.connect({
  servers: natsHost,
  token: natsToken,
  port: 4222,
});
natsClients.push(nats);

const sub = nats.subscribe('>');
subscriptions.push(sub);
(async () => {
  for await (const message of sub) {
    // eslint-disable-next-line no-console
    console.log(`[${message.subject}][${sub.getProcessed()}]: ${message.string()}`, { producer: "natsClient" });
  }
})();
