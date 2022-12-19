"use strict";

/*
 * DOM Elements
 */
const connectionStatus = document.querySelector("h2#connectionStatusText");
const audio = document.querySelector("audio#audio");
/*
 * Buttons
 */
const serverButton = document.querySelector("button#startServerButton");
const clientButton = document.querySelector("button#startClientButton");
const hangupButton = document.querySelector("button#hangupButton");
const setRemoteButton = document.querySelector("button#setRemoteButton");
const setRemoteCandidatesButton = document.querySelector(
  "button#setRemoteCandidatesButton"
);
const makeCallButton = document.querySelector("button#makeCallButton");
const acceptIncomingCallButton = document.querySelector(
  "button#acceptIncomingCallButton"
);

const codecSelector = document.querySelector("select#codec");
const connectionConfiguration = document.querySelector(
  "textarea#connectionConfigurationData"
);
const serverIceOfferData = document.querySelector(
  "textarea#serverIceOfferData"
);
const remoteIceOfferData = document.querySelector(
  "textarea#remoteIceOfferData"
);

const remoteIceCandidatesData = document.querySelector(
  "textarea#remoteIceCandidates"
);
const localIceCandidatesData = document.querySelector(
  "textarea#localIceCandidates"
);
const localDescriptionData = document.querySelector(
  "textarea#localDescriptionData"
);

const serverNameData = document.querySelector("input#serverNameData");
const phoneNumberData = document.querySelector("input#phoneNumberData");
const accessTokenData = document.querySelector("input#accessTokenData");
const calleeData = document.querySelector("input#calleeData");
const callIdData = document.querySelector("input#callIdData");

const muteMicCheckbox = document.querySelector("input#muteMic");
muteMicCheckbox.addEventListener("click", (e) => {
  mute_unmute();
});

/*
 * Input box onblur event handlers
 */
connectionConfiguration.addEventListener("blur", (event) => {
  connectionConfiguration.value = prettifyJSON(connectionConfiguration.value);
});
serverIceOfferData.addEventListener("blur", (event) => {
  connectionConfiguration.value = prettifyJSON(connectionConfiguration.value);
});
remoteIceOfferData.addEventListener("blur", (event) => {
  connectionConfiguration.value = prettifyJSON(connectionConfiguration.value);
});

/*
 * Setup buttons
 */
// hangupButton.disabled = true;
serverButton.onclick = server_up;
clientButton.onclick = client_up;
hangupButton.onclick = hangup;
setRemoteButton.onclick = set_remote;
setRemoteCandidatesButton.onclick = set_remote_candidates;
makeCallButton.onclick = make_call_button;
acceptIncomingCallButton.oncall = accept_incoming_call;

/*
 * Setup initial variables
 */
let pc;
let isServer = false;
let localStream;
let localIceCandidates = new Set();

let bitrateGraph;
let bitrateSeries;
let targetBitrateSeries;
let headerrateSeries;

let rttGraph;
let rttSeries;
let totalrttSeries;

let packetGraph;
let packetSeries;

const audioLevels = [];
let audioLevelGraph;
let audioLevelSeries;

let lastResult;

let supportsSetCodecPreferences;

let intervalHandle;

let interval;

const offerOptions = {
  offerToReceiveAudio: 1,
  offerToReceiveVideo: 0,
  voiceActivityDetection: false,
};

connectionConfiguration.value = prettifyJSON(
  JSON.stringify({
    iceServers: [
      {
        url: "stun:stun.l.google.com:19302",
      },
    ],
  })
);

/*
 * Connection Status updater
 */
function updateConnectionStatus(status) {
  console.log("Connection State: ", status);
  connectionStatus.innerHTML = status;
}

/*
 * Setup Codec Preferences
 * - We only show one way of doing this
 */
setupInitalCodecPreferencesDisplay();

/*
 * Event Handlers
 */
function server_up() {
  isServer = true;
  shared_setup();
}

function client_up() {
  shared_setup();
}

function set_remote_candidates() {
  const remoteIceCandidate = remoteIceCandidatesData.value;
  remoteIceCandidate.split(",\n").map(function (c) {
    let parsedCandidate = JSON.parse(c);
    if (typeof parsedCandidate == "string") {
      parsedCandidate = JSON.parse(parsedCandidate);
    }
    console.log("adding ice candidate: ", parsedCandidate);
    pc.addIceCandidate(parsedCandidate);
  });
}

function set_remote() {
  let offer;

  if (remoteIceOfferData.value[0] == '"') {
    offer = JSON.parse(remoteIceOfferData.value);
    if (typeof offer == "string") {
      offer = JSON.parse(offer);
    }
  } else {
    let data = remoteIceOfferData.value;
    data = data.replaceAll("\\\\r\\\\n", "\\r\\n");
    offer = JSON.parse(data);
  }

  console.log("SET_REMOTE called with: ", offer);

  pc.setRemoteDescription(offer)
    .then(() => {
      console.log("Setting remote description: ", offer);

      if (!isServer) {
        pc.createAnswer()
          .then((answer) => {
            console.log("LOCAL_ANSWER created: ", answer);
            serverIceOfferData.value = JSON.stringify(JSON.stringify(answer));
            pc.setLocalDescription(answer);

            setRemoteButton.disabled = true;
          })
          .catch((error) => {
            console.error(error);
            setRemoteButton.disabled = false;
          });
      } else {
        setRemoteButton.disabled = true;
      }
    })
    .catch((error) => {
      console.error(error);
      setRemoteButton.disabled = false;
    });
}

function hangup() {
  console.log("Ending call");

  clearInterval(interval);

  callingCallTerminate(callIdData.value).then((resp) => {
    updateConnectionStatus("disconnected");
  });

  localStream.getTracks().forEach((track) => track.stop());
  localStream = null;
  pc.close();
  pc = null;

  hangupButton.disabled = true;
  codecSelector.disabled = false;
  serverButton.disabled = false;
  clientButton.disabled = false;
  setRemoteButton.disabled = false;
}

function mute_unmute() {
  if (muteMicCheckbox.checked) {
    console.log("mute mic");
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
  } else {
    console.log("un mute mic");
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });
  }
}

async function shared_setup() {
  codecSelector.disabled = true;
  serverButton.disabled = true;
  clientButton.disabled = true;
  hangupButton.disabled = false;

  console.log("Starting call");
  const servers = JSON.parse(connectionConfiguration.value);
  pc = new RTCPeerConnection(servers);
  console.log("Created local peer connection object pc with: ", servers);

  localStream = await navigator.mediaDevices.getUserMedia({
    video: false,
    audio: true,
  });
  setupAudio();

  pc.onicecandidate = (event) => {
    if (event && event.candidate) {
      console.log("Got Local Ice Candidate:", event.candidate);

      localIceCandidates.add(event.candidate);

      const result = Array.from(localIceCandidates)
        .map(function (c) {
          return JSON.stringify(JSON.stringify(c));
        })
        .join(",\n");

      localIceCandidatesData.value = result;
    }

    console.log("Updated LOCAL_DESCRIPTION: ", pc.localDescription);
    localDescriptionData.value = JSON.stringify(
      JSON.stringify(pc.localDescription)
    );
  };

  pc.onconnectionstatechange = (e) =>
    updateConnectionStatus(pc.connectionState);

  if (isServer) {
    pc.createOffer(offerOptions).then(
      (offer) => {
        console.log("Got local Offer: ", offer);
        serverIceOfferData.value = JSON.stringify(JSON.stringify(offer));
        pc.setLocalDescription(offer);
      },
      (error) =>
        console.log(`Failed to create session description: ${error.toString()}`)
    );
  }
}

function setupAudio() {
  hangupButton.disabled = false;

  const audioTracks = localStream.getAudioTracks();
  console.log("Found total %d Local Audio Tracks", audioTracks.length);
  if (audioTracks.length > 0) {
    console.log(`Using Audio device: ${audioTracks[0].label}`);
  }

  console.log("Adding Local Stream to peer connection");
  localStream.getTracks().forEach((track) => {
    if (muteMicCheckbox.checked) {
      console.log(`Muting the track ${track.label} before adding it`);
      track.enabled = false;
    }

    console.log(
      `Added track: ${track.label} (ID: ${track.id}) to peer connection`
    );
    pc.addTrack(track, localStream);
  });

  pc.ontrack = (event) => {
    console.log(
      "Received remote streams %d. Hooking up track ID: %s",
      event.streams.length,
      event.streams[0].id
    );
    audio.srcObject = event.streams[0];
  };

  setCodecPreferences();
  setupGraphs();
}

/*
 * SDP Utils
 */
function setupInitalCodecPreferencesDisplay() {
  const codecPreferences = document.querySelector("#codecPreferences");
  supportsSetCodecPreferences =
    window.RTCRtpTransceiver &&
    "setCodecPreferences" in window.RTCRtpTransceiver.prototype;
  if (supportsSetCodecPreferences) {
    codecSelector.style.display = "none";

    const { codecs } = RTCRtpSender.getCapabilities("audio");
    codecs.forEach((codec) => {
      if (["audio/CN", "audio/telephone-event"].includes(codec.mimeType)) {
        return;
      }
      const option = document.createElement("option");
      option.value = (
        codec.mimeType +
        " " +
        codec.clockRate +
        " " +
        (codec.sdpFmtpLine || "")
      ).trim();
      option.innerText = option.value;
      codecPreferences.appendChild(option);
    });
    codecPreferences.disabled = false;
  } else {
    codecPreferences.style.display = "none";
  }
}

function setCodecPreferences() {
  if (supportsSetCodecPreferences) {
    console.log("Setting supportsSetCodecPreferences");
    const preferredCodec =
      codecPreferences.options[codecPreferences.selectedIndex];
    if (preferredCodec.value !== "") {
      const [mimeType, clockRate, sdpFmtpLine] =
        preferredCodec.value.split(" ");
      const { codecs } = RTCRtpSender.getCapabilities("audio");
      console.log(mimeType, clockRate, sdpFmtpLine);
      console.log(JSON.stringify(codecs, null, " "));
      const selectedCodecIndex = codecs.findIndex(
        (c) =>
          c.mimeType === mimeType &&
          c.clockRate === parseInt(clockRate, 10) &&
          c.sdpFmtpLine === sdpFmtpLine
      );
      const selectedCodec = codecs[selectedCodecIndex];
      codecs.splice(selectedCodecIndex, 1);
      codecs.unshift(selectedCodec);
      const transceiver = pc
        .getTransceivers()
        .find(
          (t) => t.sender && t.sender.track === localStream.getAudioTracks()[0]
        );
      transceiver.setCodecPreferences(codecs);
      console.log("Preferred video codec", selectedCodec);
    }
  }
}

// Copied from AppRTC's sdputils.js:
//  - Sets |codec| as the default |type| codec if it's present
//  - The format of |codec| is 'NAME/RATE', e.g. 'opus/48000'
function maybePreferCodec(sdp, type, dir, codec) {
  const str = `${type} ${dir} codec`;
  if (codec === "") {
    console.log(`No preference on ${str}.`);
    return sdp;
  }

  console.log(`Prefer ${str}: ${codec}`);

  const sdpLines = sdp.split("\r\n");

  // Search for m line.
  const mLineIndex = findLine(sdpLines, "m=", type);
  if (mLineIndex === null) {
    return sdp;
  }

  // If the codec is available, set it as the default in m line.
  const codecIndex = findLine(sdpLines, "a=rtpmap", codec);
  console.log("codecIndex", codecIndex);
  if (codecIndex) {
    const payload = getCodecPayloadType(sdpLines[codecIndex]);
    if (payload) {
      sdpLines[mLineIndex] = setDefaultCodec(sdpLines[mLineIndex], payload);
    }
  }

  sdp = sdpLines.join("\r\n");
  return sdp;
}

// Find the line in sdpLines that starts with |prefix|, and, if specified,
// contains |substr| (case-insensitive search).
function findLine(sdpLines, prefix, substr) {
  return findLineInRange(sdpLines, 0, -1, prefix, substr);
}

// Find the line in sdpLines[startLine...endLine - 1] that starts with |prefix|
// and, if specified, contains |substr| (case-insensitive search).
function findLineInRange(sdpLines, startLine, endLine, prefix, substr) {
  const realEndLine = endLine !== -1 ? endLine : sdpLines.length;
  for (let i = startLine; i < realEndLine; ++i) {
    if (sdpLines[i].indexOf(prefix) === 0) {
      if (
        !substr ||
        sdpLines[i].toLowerCase().indexOf(substr.toLowerCase()) !== -1
      ) {
        return i;
      }
    }
  }
  return null;
}

// Gets the codec payload type from an a=rtpmap:X line.
function getCodecPayloadType(sdpLine) {
  const pattern = new RegExp("a=rtpmap:(\\d+) \\w+\\/\\d+");
  const result = sdpLine.match(pattern);
  return result && result.length === 2 ? result[1] : null;
}

// Returns a new m= line with the specified codec as the first one.
function setDefaultCodec(mLine, payload) {
  const elements = mLine.split(" ");

  // Just copy the first three parameters; codec order starts on fourth.
  const newLine = elements.slice(0, 3);

  // Put target payload first and copy in the rest.
  newLine.push(payload);
  for (let i = 3; i < elements.length; i++) {
    if (elements[i] !== payload) {
      newLine.push(elements[i]);
    }
  }
  return newLine.join(" ");
}

/*
 * Graph Utils
 */
function setupGraphs() {
  bitrateSeries = new TimelineDataSeries();
  bitrateGraph = new TimelineGraphView("bitrateGraph", "bitrateCanvas");
  bitrateGraph.updateEndDate();

  targetBitrateSeries = new TimelineDataSeries();
  targetBitrateSeries.setColor("blue");

  headerrateSeries = new TimelineDataSeries();
  headerrateSeries.setColor("green");

  packetSeries = new TimelineDataSeries();
  packetGraph = new TimelineGraphView("packetGraph", "packetCanvas");
  packetGraph.updateEndDate();

  rttSeries = new TimelineDataSeries();
  rttSeries.setColor("green");
  totalrttSeries = new TimelineDataSeries();
  totalrttSeries.setColor("blue");
  rttGraph = new TimelineGraphView("rttGraph", "rttCanvas");
  rttGraph.updateEndDate();

  audioLevelSeries = new TimelineDataSeries();
  audioLevelGraph = new TimelineGraphView(
    "audioLevelGraph",
    "audioLevelCanvas"
  );
  audioLevelGraph.updateEndDate();
}

// query getStats every second
window.setInterval(() => {
  if (!pc) {
    return;
  }
  const sender = pc.getSenders()[0];
  if (!sender) {
    return;
  }
  sender.getStats().then((res) => {
    res.forEach((report) => {
      let bytes;
      let headerBytes;
      let packets;
      if (report.type == "candidate-pair") {
        const now = report.timestamp;

        totalrttSeries.addPoint(
          now,
          (report.totalRoundTripTime / report.responsesReceived) * 1000
        );
        rttSeries.addPoint(now, report.currentRoundTripTime * 1000);
        rttGraph.setDataSeries([rttSeries, totalrttSeries]);
        rttGraph.updateEndDate();
      } else if (report.type === "outbound-rtp") {
        if (report.isRemote) {
          return;
        }
        const now = report.timestamp;
        bytes = report.bytesSent;
        headerBytes = report.headerBytesSent;

        packets = report.packetsSent;
        if (lastResult && lastResult.has(report.id)) {
          const deltaT = (now - lastResult.get(report.id).timestamp) / 1000;
          // calculate bitrate
          const bitrate =
            (8 * (bytes - lastResult.get(report.id).bytesSent)) / deltaT;
          const headerrate =
            (8 * (headerBytes - lastResult.get(report.id).headerBytesSent)) /
            deltaT;

          // append to chart
          bitrateSeries.addPoint(now, bitrate);
          headerrateSeries.addPoint(now, headerrate);
          targetBitrateSeries.addPoint(now, report.targetBitrate);
          bitrateGraph.setDataSeries([
            bitrateSeries,
            headerrateSeries,
            targetBitrateSeries,
          ]);
          bitrateGraph.updateEndDate();

          // calculate number of packets and append to chart
          packetSeries.addPoint(
            now,
            (packets - lastResult.get(report.id).packetsSent) / deltaT
          );
          packetGraph.setDataSeries([packetSeries]);
          packetGraph.updateEndDate();
        }
      }
    });
    lastResult = res;
  });
}, 1000);

if (
  window.RTCRtpReceiver &&
  "getSynchronizationSources" in window.RTCRtpReceiver.prototype
) {
  let lastTime;
  const getAudioLevel = (timestamp) => {
    window.requestAnimationFrame(getAudioLevel);
    if (!pc) {
      return;
    }
    const receiver = pc.getReceivers().find((r) => r.track.kind === "audio");
    if (!receiver) {
      return;
    }
    const sources = receiver.getSynchronizationSources();
    sources.forEach((source) => {
      audioLevels.push(source.audioLevel);
    });
    if (!lastTime) {
      lastTime = timestamp;
    } else if (timestamp - lastTime > 500 && audioLevels.length > 0) {
      // Update graph every 500ms.
      const maxAudioLevel = Math.max.apply(null, audioLevels);
      audioLevelSeries.addPoint(Date.now(), maxAudioLevel);
      audioLevelGraph.setDataSeries([audioLevelSeries]);
      audioLevelGraph.updateEndDate();
      audioLevels.length = 0;
      lastTime = timestamp;
    }
  };
  window.requestAnimationFrame(getAudioLevel);
}

/*
 * Utils
 */
function prettifyJSON(input) {
  try {
    return JSON.stringify(JSON.parse(input), undefined, 2);
  } catch (e) {
    return input;
  }
}

function getBearerToken() {
  return accessTokenData.value;
}

function getPhoneNumberId() {
  return phoneNumberData.value;
}

function getServerName() {
  return serverNameData.value;
}

/*
 * GraphAPI Functions to start/terminate/accept calls
 */
function startNewCallRequest(to) {
  console.log("Starting NewCall");

  return makeGraphAPICall("new_call", {
    messaging_product: "whatsapp",
    callee: to,
    type: "audio",
  });
}

async function callingCallTerminate(callId) {
  console.log("Terminating Call");

  const response = await makeGraphAPICall("call_terminate", {
    call_id: callId,
  });

  return response;
}

async function callingAcceptCallAction(callId, sdp, iceCandidates) {
  console.log("Accept Call Action");

  const response = await makeGraphAPICall("call_action", {
    call_id: callId,
    action: "accept",
    sdp: sdp,
    ice_candidates: iceCandidates,
  });

  return response;
}

/*
 * Webhook Functions to handle incoming data
 */
function handleWebhookCallConnect(webhook) {
  //
  const call_id = webhook["call_id"];
  const sdp = webhook["sdp"];
  const ice_candidates = webhook["ice_candidates"];

  if (callIdData.value != call_id) {
    console.warn("Call ID does not match the ID in this webhook: ", webhook);
    return;
  }

  if (sdp === undefined) {
    const candidates = Array.from(localIceCandidates).map((item) =>
      JSON.stringify(item)
    );
    callingAcceptCallAction(
      call_id,
      JSON.parse(JSON.parse(serverIceOfferData.value)),
      candidates
    ).then((res) => {
      console.log("callingAcceptCallAction returned: ", res);
    });
    return;
  }

  remoteIceOfferData.value = sdp;
  if (ice_candidates !== undefined) {
    remoteIceCandidatesData.value = ice_candidates;
  }

  set_remote();
}

function handleWebhookCallTerminate(webhook) {
  const call_id = webhook["call_id"];
  if (callIdData.value != call_id) {
    console.error("Call ID does not match for webhook: ", webhook);
    return;
  }

  hangup();
}

function processWebhooks(payload) {
  console.log(`Processing webhooks: ${payload.length}`);

  payload.forEach((change) => {
    console.log(JSON.stringify(change));

    const call_payload = change["value"]["call"];

    const webhook_type = call_payload["type"];
    switch (webhook_type) {
      case "call_connect":
        handleWebhookCallConnect(call_payload);
        break;
      case "call_terminate":
        handleWebhookCallTerminate(call_payload);
        break;
      default:
        console.log(`Unhandled webhook_type: ${webhook_type}`);
    }
  });
}

/*
 * Functions to make GraphAPI Call or read from Webhook
 */
async function makeGraphAPICall(action, payload) {
  const data = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      host: getServerName(),
      token: getBearerToken(),
      phone_number_id: getPhoneNumberId(),
      action: action,
      payload: payload,
    }),
  };
  const response = await fetch("/calling/invoke", data);
  return await response.json();
}

function pollWebhooks() {
  const wamid = callIdData.value;
  fetch("https://capi-calling-test.herokuapp.com/?wamid=" + wamid, {
    method: "GET",
    cors: "no-cors",
  })
    .then((response) => {
      response
        .json()
        .then((data) => {
          processWebhooks(data);
        })
        .catch((e) => {
          console.error("pollWebhooks json parsing error: ", e, data);
        });
    })
    .catch((e) => {
      console.error("pollWebhooks GET error: ", e);
    });
}

function make_call_button() {
  onStartCall();
  server_up();
  startNewCallRequest(calleeData.value)
    .then((resp) => {
      console.log("callingNewCallRequest: ", resp);
      if (resp["error"] === undefined) {
        callIdData.value =
          resp["whatsapp_business_api_data"]["call"]["call_id"];

          // Poll for webhooks
          interval = setInterval(pollWebhooks, 1000);
      } else {
        hangup();
        alert("Error Starting New Call");
      }
    })
    .catch((err) => console.error(err));
}

function accept_incoming_call() {
  interval = setInterval(pollWebhooks, 1000);
}

var coll = document.getElementsByClassName("collapsible");
var i;

for (i = 0; i < coll.length; i++) {
  coll[i].addEventListener("click", function () {
    this.classList.toggle("active");
    var content = this.nextElementSibling;
    if (content.style.display === "block") {
      content.style.display = "none";
    } else {
      content.style.display = "block";
    }
  });
}

function onStartCall() {
  updateConnectionStatus("starting");
}

function onEndCall() {}

function onTransferCall() {}
