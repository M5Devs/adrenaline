#ifndef ADRENALINE_CEF_CLIENT_H_
#define ADRENALINE_CEF_CLIENT_H_

#include "../features.h"
#include <string>

#if ADREN_FEATURE_CEF

#include <functional>

#include "include/cef_client.h"

// Per-window CEF client. One instance is created for each `BrowserWindow`; it
// forwards renderer IPC to a C++ callback and tracks the browser/window
// lifecycle so the engine thread can tear the window down cleanly.
class AdrenalineClient : public CefClient,
                         public CefDisplayHandler,
                         public CefLifeSpanHandler,
                         public CefLoadHandler {
public:
  // `on_ipc` receives `(channel_json, data_json)` exactly as emitted by the
  // renderer bridge; it is invoked on the CEF UI thread. `initial_url` is
  // loaded as soon as the browser is created (window.cpp already resolves
  // `html` options into a `data:` URI).
  AdrenalineClient(std::function<void(const std::string&, const std::string&)> on_ipc,
                   std::string initial_url);
  virtual ~AdrenalineClient();

  // CefClient methods:
  virtual CefRefPtr<CefDisplayHandler> GetDisplayHandler() override {
    return this;
  }
  virtual CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override {
    return this;
  }
  virtual CefRefPtr<CefLoadHandler> GetLoadHandler() override {
    return this;
  }
  virtual bool OnProcessMessageReceived(CefRefPtr<CefBrowser> browser,
                                        CefRefPtr<CefFrame> frame,
                                        CefProcessId source_process,
                                        CefRefPtr<CefProcessMessage> message) override;

  // CefLifeSpanHandler methods:
  virtual void OnAfterCreated(CefRefPtr<CefBrowser> browser) override;
  virtual bool DoClose(CefRefPtr<CefBrowser> browser) override;
  virtual void OnBeforeClose(CefRefPtr<CefBrowser> browser) override;

  // CefDisplayHandler methods:
  virtual void OnTitleChange(CefRefPtr<CefBrowser> browser,
                             const CefString& title) override;

  // CefLoadHandler methods:
  virtual void OnLoadEnd(CefRefPtr<CefBrowser> browser,
                         CefRefPtr<CefFrame> frame,
                         int httpStatusCode) override;
  virtual void OnLoadError(CefRefPtr<CefBrowser> browser,
                           CefRefPtr<CefFrame> frame,
                           ErrorCode errorCode,
                           const CefString& errorText,
                           const CefString& failedUrl) override;

  bool IsClosing() const { return is_closing_; }
  bool IsReady() const { return is_ready_; }
  bool IsLoaded() const { return is_loaded_; }
  std::string GetTitle() const { return current_title_; }
  CefRefPtr<CefBrowser> GetBrowser() const { return browser_; }

private:
  CefRefPtr<CefBrowser> browser_;
  bool is_closing_;
  bool is_ready_;
  bool is_loaded_;
  std::string current_title_;
  std::string initial_url_;
  std::function<void(const std::string&, const std::string&)> on_ipc_;

  // Include the default reference counting implementation.
  IMPLEMENT_REFCOUNTING(AdrenalineClient);
  DISALLOW_COPY_AND_ASSIGN(AdrenalineClient);
};

#else

// Mock/stub implementation for lightweight build (ADREN_FEATURE_CEF == 0)
class AdrenalineClient {
public:
  AdrenalineClient() : is_closing_(false), is_ready_(false), is_loaded_(false) {}
  ~AdrenalineClient() = default;

  bool IsClosing() const { return is_closing_; }
  bool IsReady() const { return is_ready_; }
  bool IsLoaded() const { return is_loaded_; }
  std::string GetTitle() const { return current_title_; }

private:
  bool is_closing_{false};
  bool is_ready_{false};
  bool is_loaded_{false};
  std::string current_title_{""};
};

#endif // ADREN_FEATURE_CEF

#endif // ADRENALINE_CEF_CLIENT_H_
