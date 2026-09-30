#include <napi.h>
#include <iostream>
#include "vendor/webview.h"

Napi::String Ping(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::String::New(env, "Adrenaline Core v0.1.0 is Alive!");
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "ping"), Napi::Function::New(env, Ping));
    return exports;
}

NODE_API_MODULE(adrenaline, Init)
