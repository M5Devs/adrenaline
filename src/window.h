#ifndef WINDOW_H
#define WINDOW_H

#include <napi.h>
#include "features.h"

namespace Adrenaline {

Napi::Value CreateWindow(const Napi::CallbackInfo& info);
Napi::Value CloseWindow(const Napi::CallbackInfo& info);
Napi::Value EvalWindow(const Napi::CallbackInfo& info);
Napi::Value NavigateWindow(const Napi::CallbackInfo& info);
Napi::Value GetCompiledFeatures(const Napi::CallbackInfo& info);

} // namespace Adrenaline

#endif // WINDOW_H
