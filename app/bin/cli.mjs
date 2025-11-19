#!/usr/bin/env node

"use strict";

import { NatsClient } from "../lib/nats-client.mjs";
import { log } from "../lib/log.mjs";

const natsClients = [];
const natsSubscriptions = [];

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

const nats = new NatsClient({
  natsHost: natsHost,
  natsToken: natsToken,
});
natsClients.push(nats);
await nats.connect();

const sub = nats.subscribe('control.connectors.irc.>', (subject, message) => {
  log.info(subject, message);
});
natsSubscriptions.push(sub);
