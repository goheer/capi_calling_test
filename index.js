"use strict";

const express = require("express");
const bodyParser = require("body-parser");
const request = require("request");
const xhub = require("express-x-hub");
const cors = require("cors");
const app = express();

const PORT = process.env.PORT || 8080;

app.use(xhub({ algorithm: "sha1", secret: process.env.APP_SECRET }));
app.use(bodyParser.json());
app.use(cors({ origin: "*" }));
app.use(express.static("public"));
app.use(express.static("calling"));

var received_updates = [];

app.get("/", function (req, res) {
  if (req.query.dequeue === "true") {
    var updates = received_updates;
    received_updates = [];
    res.send(updates);
  } else {
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
  console.log(JSON.stringify(req.body, null, 2));
  received_updates.unshift(req.body);
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
