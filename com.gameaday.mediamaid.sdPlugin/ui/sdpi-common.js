/**
 * MediaMaid – Shared Property Inspector utilities
 *
 * Provides a consistent WebSocket connection pattern, settings persistence,
 * path validation, and helper functions used by all PI panels.
 * Import via <script src="sdpi-common.js"></script> in each PI HTML.
 */

/* global WebSocket */

/**
 * Shared PI state object.
 * @type {{ websocket: WebSocket|null, uuid: string, actionInfo: object|null }}
 */
const $MM = {
  websocket: null,
  uuid: "",
  actionInfo: null
};

/**
 * Validate an absolute path and update a status element.
 * Works for both Unix (/media/...) and Windows (C:\...) paths.
 *
 * @param {HTMLInputElement} inputEl   – the path input element
 * @param {HTMLElement}      statusEl  – the element to show status messages in
 * @param {string}           [readyMsg] – custom "ready" message (default: "Ready.")
 */
function validatePath(inputEl, statusEl, readyMsg) {
  var path = inputEl.value.trim();
  if (!path) {
    statusEl.className = "";
    statusEl.textContent = "";
  } else if (!path.startsWith("/") && !path.match(/^[A-Za-z]:\\/)) {
    statusEl.className = "sdpi-warning";
    statusEl.textContent = "Path should be absolute (e.g., /media/tv or C:\\Media\\TV).";
  } else {
    statusEl.className = "sdpi-success";
    statusEl.textContent = readyMsg || "Ready.";
  }
}

/**
 * Save settings to the Stream Deck via WebSocket.
 * @param {object} payload – the settings object to save
 */
function saveSettings(payload) {
  if ($MM.websocket && $MM.websocket.readyState === WebSocket.OPEN) {
    $MM.websocket.send(JSON.stringify({
      event: "setSettings",
      context: $MM.uuid,
      payload: payload
    }));
  }
}

/**
 * Standard Stream Deck PI connection function.
 * Called automatically by the Stream Deck application.
 *
 * @param {string} inPort
 * @param {string} inPropertyInspectorUUID
 * @param {string} inRegisterEvent
 * @param {string} inInfo
 * @param {string} inActionInfo
 */
function connectElgatoStreamDeckSocket(inPort, inPropertyInspectorUUID, inRegisterEvent, inInfo, inActionInfo) {
  $MM.uuid = inPropertyInspectorUUID;
  $MM.actionInfo = JSON.parse(inActionInfo);

  var settings = ($MM.actionInfo.payload && $MM.actionInfo.payload.settings) || {};

  // Call the PI-specific loadSettings if defined
  if (typeof onSettingsLoaded === "function") {
    onSettingsLoaded(settings);
  }

  $MM.websocket = new WebSocket("ws://127.0.0.1:" + inPort);

  $MM.websocket.onopen = function () {
    $MM.websocket.send(JSON.stringify({
      event: inRegisterEvent,
      uuid: $MM.uuid
    }));
  };

  $MM.websocket.onmessage = function (evt) {
    var msg = JSON.parse(evt.data);
    if (msg.event === "didReceiveSettings") {
      if (typeof onSettingsLoaded === "function") {
        onSettingsLoaded(msg.payload.settings || {});
      }
    }
  };

  // Call the PI-specific init function if defined
  if (typeof onPiConnected === "function") {
    onPiConnected();
  }
}
