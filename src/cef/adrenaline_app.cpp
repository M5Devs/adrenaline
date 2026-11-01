#include "adrenaline_app.h"

#if ADREN_FEATURE_CEF

#include <string>

#include "include/cef_browser.h"
#include "include/cef_command_line.h"
#include "include/cef_frame.h"
#include "include/cef_process_message.h"
#include "include/cef_values.h"
#include "include/wrapper/cef_helpers.h"

const char kAdrenalineIpcMessage[] = "adrenaline_ipc";

// The `send` helper is backed by a native function so the payload is delivered
// as a structured process message rather than a stringly-typed JS bridge.
const char kAdrenalineBridgeScript[] = R"JS(
(function() {
  window.adrenaline = window.adrenaline || {};
  window.adrenaline.send = function(channel, data) {
    return window.__adrenaline_ipc_send(channel, data);
  };
  window.adrenaline._listeners = window.adrenaline._listeners || {};
  window.adrenaline.on = function(channel, cb) {
    window.adrenaline._listeners[channel] = window.adrenaline._listeners[channel] || [];
    window.adrenaline._listeners[channel].push(cb);
  };
  window.adrenaline._onMessage = function(channel, data) {
    var cbs = window.adrenaline._listeners[channel];
    if (cbs) {
      cbs.slice().forEach(function(cb) { cb(data); });
    }
  };
  window.__adrenaline_callbacks = window.__adrenaline_callbacks || {};
  window.__adrenaline_ipc_reply = function(reqId, err, result) {
    if (window.__adrenaline_callbacks[reqId]) {
      if (err) window.__adrenaline_callbacks[reqId].reject(new Error(err));
      else window.__adrenaline_callbacks[reqId].resolve(result);
      delete window.__adrenaline_callbacks[reqId];
    }
  };
  window.adrenaline.invoke = function(channel, data) {
    return new Promise(function(resolve, reject) {
      var reqId = Math.random().toString(36).substring(2) + Date.now();
      window.__adrenaline_callbacks[reqId] = { resolve: resolve, reject: reject };
      window.adrenaline.send('__adrenaline_ipc_invoke', { reqId: reqId, channel: channel, data: data });
    });
  };
})();
)JS";

namespace {

// Marshals `window.adrenaline.send(channel, data)` into a process message.
class AdrenalineV8Handler : public CefV8Handler {
public:
  bool Execute(const CefString& name,
               CefRefPtr<CefV8Value> /*object*/,
               const CefV8ValueList& arguments,
               CefRefPtr<CefV8Value>& retval,
               CefString& exception) override {
    if (name != "__adrenaline_ipc_send") {
      return false;
    }

    CefRefPtr<CefV8Context> context = CefV8Context::GetCurrentContext();
    CefRefPtr<CefFrame> frame = context ? context->GetFrame() : nullptr;
    if (!frame) {
      exception = "no frame";
      return true;
    }

    // Serialize the payload in the renderer so the browser side only has to
    // hand the JSON string back to JS via JSON.parse.
    CefRefPtr<CefV8Value> json = context->GetGlobal()->GetValue("JSON");
    if (!json || !json->IsObject()) {
      exception = "no JSON";
      return true;
    }
    CefRefPtr<CefV8Value> stringify = json->GetValue("stringify");
    CefRefPtr<CefV8Value> channel = arguments.size() > 0 ? arguments[0] : CefV8Value::CreateNull();
    CefRefPtr<CefV8Value> payload = arguments.size() > 1 ? arguments[1] : CefV8Value::CreateNull();

    std::string channel_json = "null";
    std::string data_json = "null";
    if (stringify && stringify->IsFunction()) {
      CefV8ValueList cargs;
      cargs.push_back(channel);
      CefRefPtr<CefV8Value> cresult = stringify->ExecuteFunction(nullptr, cargs);
      if (cresult && cresult->IsString()) channel_json = cresult->GetStringValue().ToString();

      CefV8ValueList dargs;
      dargs.push_back(payload);
      CefRefPtr<CefV8Value> dresult = stringify->ExecuteFunction(nullptr, dargs);
      if (dresult && dresult->IsString()) data_json = dresult->GetStringValue().ToString();
      else if (dresult && dresult->IsNull()) data_json = "null";
    }

    CefRefPtr<CefProcessMessage> message =
        CefProcessMessage::Create(kAdrenalineIpcMessage);
    CefRefPtr<CefListValue> list = message->GetArgumentList();
    list->SetSize(2);
    list->SetString(0, channel_json);
    list->SetString(1, data_json);
    frame->SendProcessMessage(PID_BROWSER, message);

    retval = CefV8Value::CreateNull();
    return true;
  }

private:
  IMPLEMENT_REFCOUNTING(AdrenalineV8Handler);
};

} // namespace

AdrenalineApp::AdrenalineApp() {}

void AdrenalineApp::OnBeforeCommandLineProcessing(
    const CefString& process_type,
    CefRefPtr<CefCommandLine> command_line) {
  if (!command_line.get()) {
    return;
  }

  // A Node addon is loaded into an already-running process, so CEF cannot fork
  // the browser/renderer as separate executables (there is no CEF helper
  // binary). Run everything in-process instead.
  command_line->AppendSwitch("single-process");
  command_line->AppendSwitch("no-sandbox");
  command_line->AppendSwitch("disable-gpu");
  command_line->AppendSwitch("disable-dev-shm-usage");

  // Modular Feature Elimination Engine: switches are compiled in only when the
  // corresponding module is requested in adrenaline.config.js.
#if ADREN_FEATURE_CLEAN_PRIVACY
  // Ungoogled / performance optimizations.
  command_line->AppendSwitch("enable-low-end-device-mode");
  command_line->AppendSwitch("no-pings");
  command_line->AppendSwitch("disable-background-networking");
  command_line->AppendSwitch("hide-crashed-bubble");
#endif

#if ADREN_FEATURE_WEBRTC == 0
  // WebRTC physically disabled and isolated onto non-proxied UDP only.
  command_line->AppendSwitch("disable-webrtc");
  command_line->AppendSwitchWithValue("webrtc-ip-handling-policy", "disable_non_proxied_udp");
#endif

#if ADREN_FEATURE_PDF == 0
  command_line->AppendSwitch("disable-pdf-extension");
#endif
}

void AdrenalineApp::OnContextInitialized() {
  // Browser creation is driven by `Adrenaline::CreateWindow` on the engine
  // thread; there is no implicit startup browser. This hook only exists so the
  // app satisfies CefBrowserProcessHandler.
}

void AdrenalineApp::OnContextCreated(CefRefPtr<CefBrowser> browser,
                                     CefRefPtr<CefFrame> frame,
                                     CefRefPtr<CefV8Context> context) {
  if (!frame->IsMain()) {
    return;
  }

  CefRefPtr<CefV8Value> global = context->GetGlobal();
  global->SetValue("__adrenaline_ipc_send",
                   CefV8Value::CreateFunction("__adrenaline_ipc_send",
                                              new AdrenalineV8Handler()),
                   V8_PROPERTY_ATTRIBUTE_NONE);
  frame->ExecuteJavaScript(kAdrenalineBridgeScript, frame->GetURL(), 0);
}

#endif // ADREN_FEATURE_CEF
