var DEBUG = false;
function logDebug() {
  if (DEBUG && typeof console !== 'undefined') {
    console.log.apply(console, arguments);
  }
}
(function () {
  if (window.__globoVideoPageInstalled) return;
  window.__globoVideoPageInstalled = true;
  try { logDebug('Video page receiver active'); } catch (e) { }

  var MESSAGE_TYPE = window.__globoVideoMessageType || "globo-video-signal";
  var acceptListenerInstalled = false;

  function extractPayload(json) {
    if (!json || typeof json !== "object") return null;
    var accepted = json.accepted_video_call;
    var outbound = json.outbound_video_call;

    function deepFindCompanyName(obj) {
      if (!obj || typeof obj !== "object") return "";

      if (obj.company && typeof obj.company === "object" && typeof obj.company.name === "string" && obj.company.name) {
        return obj.company.name;
      }
      if (typeof obj.company_name === "string" && obj.company_name) return obj.company_name;
      if (typeof obj.client_name === "string" && obj.client_name) return obj.client_name;
      if (typeof obj.customer_name === "string" && obj.customer_name) return obj.customer_name;
      if (typeof obj.organization_name === "string" && obj.organization_name) return obj.organization_name;

      for (var key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          var found = deepFindCompanyName(obj[key]);
          if (found) return found;
        }
      }
      return "";
    }

    var companyName =
      (accepted &&
        accepted.globo_video_info &&
        accepted.globo_video_info.company &&
        accepted.globo_video_info.company.name) ||
      (outbound &&
        outbound.parent &&
        outbound.parent.globo_video_info &&
        outbound.parent.globo_video_info.company &&
        outbound.parent.globo_video_info.company.name) ||
      deepFindCompanyName(json);

    var uniqueId =
      (accepted && accepted.unique_identifier) ||
      (outbound && outbound.parent && outbound.parent.unique_identifier) ||
      "";

    var numericId =
      (accepted && accepted.id) ||
      (outbound && outbound.parent && outbound.parent.id) ||
      "";

    var roomName =
      (accepted && accepted.room_name) ||
      (outbound && outbound.room_name) ||
      "";

    if (!companyName) {
      companyName = "Unknown Client";
    }

    return {
      companyName: companyName,
      uniqueId: uniqueId,
      numericId: numericId ? String(numericId) : "",
      roomName: roomName
    };
  }

  function extractAssignmentPayload(json) {
    if (!Array.isArray(json)) return null;
    for (var i = 0; i < json.length; i++) {
      var item = json[i];
      if (item && item.status === "Started" && item.assignment_id) {
        return {
          companyName: item.company || "Unknown Client",
          uniqueId: item.assignment_id || "",
          numericId: item.id ? String(item.id) : "",
          startTimeStr: item.assignment_start_at
        };
      }
    }
    return null;
  }

  function post(payload, typeOverride) {
    if (!payload) return;
    window.postMessage({ type: typeOverride || MESSAGE_TYPE, payload: payload }, "*");
  }

  function tryInstallAcceptListener() {
    if (acceptListenerInstalled) return true;
    if (!window.VideoInterpreterIndex || typeof window.VideoInterpreterIndex.onVideoCallAcceptSuccess !== "function") {
      return false;
    }
    try {
      var original = window.VideoInterpreterIndex.onVideoCallAcceptSuccess;
      window.VideoInterpreterIndex.onVideoCallAcceptSuccess = function () {
        try {
          var payload = extractPayload(arguments[0]);
          if (payload) {
            try { logDebug("[VideoBridge] payload captured"); } catch (e) { }
          }
          post(payload);
        } catch (e) { }
        return original.apply(this, arguments);
      };
      acceptListenerInstalled = true;
      try { logDebug("[VideoBridge] accept listener installed"); } catch (e) { }
      return true;
    } catch (e) {
      return false;
    }
  }

  var installAttempts = 0;
  var installTimer = setInterval(function () {
    installAttempts += 1;
    if (tryInstallAcceptListener() || installAttempts > 60) {
      clearInterval(installTimer);
    }
  }, 500);

  function shouldLogUrl(url) {
    if (!url || typeof url !== "string") return false;
    var lower = url.toLowerCase();
    return lower.indexOf("video") !== -1 || lower.indexOf("vri") !== -1;
  }

  var dashboardLogCount = 0;
  var DASHBOARD_LOG_LIMIT = 20;

  function shouldLogDashboard(url) {
    if (!url || typeof url !== "string") return false;
    return url.indexOf("/linguist_dashboard/") !== -1;
  }

  function logDashboard(prefix, url) {
    if (dashboardLogCount >= DASHBOARD_LOG_LIMIT) return;
    if (!shouldLogDashboard(url)) return;
    dashboardLogCount += 1;
    try {
      logDebug(prefix + " " + url);
    } catch (e) { }
  }

  function logUrl(prefix, url) {
    if (!shouldLogUrl(url)) return;
    try {
      logDebug(prefix + " " + url);
    } catch (e) { }
  }

  function parseJsonText(text) {
    if (!text || typeof text !== "string") return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  function parseXhrJson(xhr) {
    if (!xhr) return null;
    if (xhr.responseType === "json") return xhr.response || null;
    if (xhr.responseType && xhr.responseType !== "text" && xhr.responseType !== "") {
      if (typeof xhr.response === "string") {
        return parseJsonText(xhr.response);
      }
      return null;
    }
    if (typeof xhr.responseText === "string") {
      return parseJsonText(xhr.responseText);
    }
    return null;
  }

  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function () {
      return origFetch.apply(this, arguments).then(function (response) {
        try {
          var url = response && response.url ? response.url : "";
          logUrl("[VideoBridge fetch]", url);
          logDashboard("[VideoBridge dashboard fetch]", url);
          if (url && url.indexOf("/linguist_dashboard/video_call_accept") !== -1) {
            response
              .clone()
              .json()
              .then(function (json) {
                var payload = extractPayload(json);
                if (payload) {
                  try { logDebug("[VideoBridge] payload captured"); } catch (e) { }
                }
                post(payload);
              })
              .catch(function () {
                response
                  .clone()
                  .text()
                  .then(function (text) {
                    var json = parseJsonText(text);
                    var payload = extractPayload(json);
                    if (payload) {
                      try { logDebug("[VideoBridge] payload captured (text)"); } catch (e) { }
                    }
                    post(payload);
                  })
                  .catch(function () { });
              });
          } else if (url && url.indexOf("assignments.json") !== -1) {
            response.clone().json().then(function (json) {
              var payload = extractAssignmentPayload(json);
              if (payload) {
                try { logDebug("[VideoBridge fetch] assignment payload captured"); } catch (e) {}
                post(payload, "globo-assignment-start");
              }
            }).catch(function() {});
          }
        } catch (e) { }
        return response;
      });
    };
  }

  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      this.__globoUrl = String(url);
    } catch (e) { }
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    var self = this;
    var handled = false;

    function handleXhrEnd() {
      if (handled) return;
      try {
        var url = self.responseURL || self.__globoUrl || "";
        if (!url || typeof url !== "string") return;
        
        var isVideoAccept = url.indexOf("video_call_accept") !== -1;
        if (isVideoAccept) {
          logDebug("[VideoBridge xhr] Intercepted video_call_accept XHR!", url);
          var json = parseXhrJson(self);
          var payload = extractPayload(json);
          if (payload) {
            logDebug("[VideoBridge xhr] payload successfully extracted:", payload);
            handled = true;
            post(payload);
          } else {
            logDebug("[VideoBridge xhr] payload extraction failed. JSON:", json);
          }
        } else if (url.indexOf("assignments.json") !== -1) {
          var json = parseXhrJson(self);
          var payload = extractAssignmentPayload(json);
          if (payload) {
            logDebug("[VideoBridge xhr] assignment payload extracted:", payload);
            handled = true;
            post(payload, "globo-assignment-start");
          }
        }
      } catch (e) {
        logDebug("[VideoBridge xhr error]", e);
      }
    }

    this.addEventListener("load", handleXhrEnd);
    this.addEventListener("readystatechange", function () {
      if (self.readyState === 4) handleXhrEnd();
    });

    return origSend.apply(this, arguments);
  };
})();
