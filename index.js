"use strict";

const express = require("express");
const bodyParser = require("body-parser");
const request = require("request");
const xhub = require("express-x-hub");
const cors = require("cors");
var https = require("node:https");
const app = express();

const PORT = process.env.PORT || 8080;

app.use(xhub({ algorithm: "sha1", secret: process.env.APP_SECRET }));
app.use(bodyParser.json());
app.use(cors({ origin: "*" }));
app.use(express.static("public"));
app.use(express.static("calling"));

var received_updates = {};

function getWamidFromWebhook(change) {
  console.log("getWamidFromWebhook from ");
  console.log(change);

  if ("value" in change) {
    if ("call" in change.value) {
      return change["value"]["call"];
    }
  }

  return null;
}

app.get("/", function (req, res) {
  if (req.query.dequeue === "true") {
    // if dequeue is set then dequeue everything
    var updates = received_updates;
    received_updates = {};
    res.send(updates);

  } else if (req.query.wamid !== undefined) {
    // if user is asking for particular wamid then only return webhooks related to that
    const wamid = req.query.wamid;
    if (wamid in received_updates) {
      const result = received_updates[wamid];
      received_updates[wamid] = [];
      res.send(result);
    } else {
      res.send([]);
    }

  } else if (req.query.wamid !== undefined) {
    // if user is asking for particular wamid then only return webhooks related to that
    const wamid = req.query.wamid;
    if (wamid in received_updates) {
      const result = received_updates[wamid];
      received_updates[wamid] = [];
      res.send(result);
    } else {
      res.send([]);
    }

  } else {
    // Otherwise dump all webhooks received so far
    res.send(received_updates);
  }
});

app.get("/webhooks", function (req, res) {
  if (
    req.param("hub.mode") != "subscribe" ||
    req.param("hub.verify_token") != process.env.VERIFY_TOKEN
  ) {
    res.sendStatus(401);
    return;
  }

  res.send(req.param("hub.challenge"));
});

app.post("/webhooks", function (req, res) {
  if (!req.isXHubValid()) {
    console.log("Received webhooks update with invalid X-Hub-Signature");
    res.sendStatus(401);
    return;
  }

  const payload = req.body;

  // Log the webhook
  console.log(JSON.stringify(payload, null, 2));

  // Store the changes in the dict
  payload.entry.forEach((entry) => {
    entry.changes.forEach((change) => {
      const wamid = change["value"]["call"]["call_id"];

      console.log(`Got webhook for wamid: ${wamid}`);

      if (wamid !== null) {
        if (wamid in received_updates === false) {
          received_updates[wamid] = [];
        }
        received_updates[wamid].unshift(change);
      } else {
        console.error(`Unable to get wamid from webhook ${entry}`);
      }
    });
  });

  res.sendStatus(200);
});

app.post("/calling/invoke", function (req, res) {
  console.log(`Calling invoke with: `, req.body);

  const post_data = JSON.stringify(req.body["payload"]);
  const host = req.body["host"];
  const token = req.body["token"];
  const phone_number_id = req.body["phone_number_id"];
  const action = req.body["action"];

  const post_options = {
    host: host,
    port: 443,
    path: `/v14.0/${phone_number_id}/${action}`,
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Content-Length": Buffer.byteLength(post_data),
      Authorization: `Bearer ${token}`,
    },
  };

  var post_request = https.request(post_options, (post_response) => {
    post_response.on("data", (d) => {
      console.log(`BODY: ${d}`);
      res.send(d);
    });

    post_request.on("error", (e) => {
      res.sendStatus(400);
    });
  });

  post_request.write(post_data);
  post_request.end();
});

app.listen(PORT, function () {
  console.log("Starting webhooks server listening on port:" + PORT);
});
