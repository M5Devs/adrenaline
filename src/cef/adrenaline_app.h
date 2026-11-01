#ifndef ADRENALINE_CEF_APP_H_
#define ADRENALINE_CEF_APP_H_

#include "../features.h"

#if ADREN_FEATURE_CEF

#include "include/cef_app.h"
#include "include/cef_render_process_handler.h"
#include "include/cef_v8.h"

// Process-message name carrying a `[channel, data]` JSON payload from the
// renderer's `window.adrenaline.send` bridge to the browser process.
extern const char kAdrenalineIpcMessage[];

// Script installing the `window.adrenaline` bridge in every frame. Shared by
// the CEF and webview engines so both expose an identical API.
extern const char kAdrenalineBridgeScript[];

class AdrenalineApp : public CefApp,
                      public CefBrowserProcessHandler,
                      public CefRenderProcessHandler {
public:
  AdrenalineApp();

  // CefApp methods:
  virtual CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override {
    return this;
  }
  virtual CefRefPtr<CefRenderProcessHandler> GetRenderProcessHandler() override {
    return this;
  }

  virtual void OnBeforeCommandLineProcessing(
      const CefString& process_type,
      CefRefPtr<CefCommandLine> command_line) override;

  // CefBrowserProcessHandler methods:
  virtual void OnContextInitialized() override;

  // CefRenderProcessHandler methods:
  virtual void OnContextCreated(CefRefPtr<CefBrowser> browser,
                                CefRefPtr<CefFrame> frame,
                                CefRefPtr<CefV8Context> context) override;

private:
  // Include the default reference counting implementation.
  IMPLEMENT_REFCOUNTING(AdrenalineApp);
  DISALLOW_COPY_AND_ASSIGN(AdrenalineApp);
};

#else

#include <string>

// Mock/stub implementation for lightweight build (ADREN_FEATURE_CEF == 0)
class AdrenalineApp {
public:
  AdrenalineApp() = default;
  ~AdrenalineApp() = default;

  void OnBeforeCommandLineProcessing(const std::string& process_type, void* command_line) {}
  void OnContextInitialized() {}
};

#endif // ADREN_FEATURE_CEF

#endif // ADRENALINE_CEF_APP_H_
