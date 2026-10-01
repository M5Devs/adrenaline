#ifndef ADRENALINE_CEF_APP_H_
#define ADRENALINE_CEF_APP_H_

#include "../features.h"

#if ADREN_FEATURE_CEF

#include "include/cef_app.h"

class AdrenalineApp : public CefApp, public CefBrowserProcessHandler {
public:
  AdrenalineApp();

  // CefApp methods:
  virtual CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() OVERRIDE {
    return this;
  }

  // CefBrowserProcessHandler methods:
  virtual void OnContextInitialized() OVERRIDE;

private:
  // Include the default reference counting implementation.
  IMPLEMENT_REFCOUNTING(AdrenalineApp);
  DISALLOW_COPY_AND_ASSIGN(AdrenalineApp);
};

#endif // ADREN_FEATURE_CEF

#endif // ADRENALINE_CEF_APP_H_
