#ifndef DIALOG_H
#define DIALOG_H

#include <napi.h>

namespace Adrenaline {

Napi::Value ShowOpenDialog(const Napi::CallbackInfo& info);
Napi::Value ShowSaveDialog(const Napi::CallbackInfo& info);
Napi::Value ShowMessageBox(const Napi::CallbackInfo& info);

} // namespace Adrenaline

#endif // DIALOG_H
