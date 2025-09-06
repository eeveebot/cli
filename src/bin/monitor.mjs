#!/usr/bin/env node

"use strict";

import * as Nats from "nats";

const natsClients = [];

//
// Do whatever teardown is necessary before calling common handler
process.on("SIGINT", () => {
  ircClients.forEach((ircClient) => {
    ircClient.quit(`SIGINT received - ${ircClient.ident.quitMsg}`);
  });
  natsClients.forEach((natsClient) => {
    natsClient.drain();
  });
  handleSIG("SIGINT");
});

process.on("SIGTERM", () => {
  ircClients.forEach((ircClient) => {
    ircClient.quit(`SIGTERM received - ${ircClient.ident.quitMsg}`);
  });
  natsClients.forEach((natsClient) => {
    natsClient.drain();
  });
  handleSIG("SIGTERM");
});

//
// Setup NATS connection

// Get host and token
const natsHost = process.env.NATS_HOST || false;
if (!natsHost) {
  const msg = "environment variable NATS_HOST is not set.";
  log.error(msg, { producer: "natsClient" });
  throw new Error(msg);
}

const natsToken = process.env.NATS_TOKEN || false;
if (!natsToken) {
  const msg = "environment variable NATS_TOKEN is not set.";
  log.error(msg, { producer: "natsClient" });
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
    log.info(`[${message.subject}][${sub.getProcessed()}]: ${message.string()}`, { producer: "natsClient" });
    if (typeof callback == "function") {
      callback(subject, message);
    }
  }
  log.info("subscription closed", { producer: "natsClient" });
})();
