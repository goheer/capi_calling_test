"use strict";

const express = require("express");
const bodyParser = require("body-parser");
const request = require("request");
const xhub = require("express-x-hub");
const app = express();
var https = require("node:https");

const PORT = process.env.PORT || 8080;

app.use(xhub({ algorithm: "sha1", secret: process.env.APP_SECRET }));
app.use(bodyParser.json());

// Add static path for /calling path.
app.use(express.static("public"));
app.use(express.static("calling"));

var received_updates = [];
var calling_updates = [];

function storeEvents(event) {
  var json_string = JSON.stringify(event);
  if (json_string.indexOf('"call"') > -1) {
    var call_json = event["entry"][0]["changes"][0]["value"]["call"];

    calling_updates.unshift(call_json);
  } else {
    received_updates.unshift(event);
  }
}

app.get("/", function (req, res) {
  res.send(JSON.stringify(received_updates, null, 2));
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
  console.log(JSON.stringify(req.body, null, 2));
  storeEvents(req.body);
  res.sendStatus(200);
});

app.get("/poll_calling_events", function (req, res) {
  if (calling_updates.length > 0) {
    let item = calling_updates[0];
    calling_updates.shift();
    res.send(item);
    return;
  }
  res.send(null);
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
