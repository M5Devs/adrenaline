#include <napi.h>
#include "window.h"

Napi::String Ping(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::String::New(env, "Adrenaline Core v0.1.0 is Alive!");
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "ping"), Napi::Function::New(env, Ping));
    exports.Set(Napi::String::New(env, "createWindow"), Napi::Function::New(env, Adrenaline::CreateWindow));
    exports.Set(Napi::String::New(env, "closeWindow"), Napi::Function::New(env, Adrenaline::CloseWindow));
    exports.Set(Napi::String::New(env, "evalWindow"), Napi::Function::New(env, Adrenaline::EvalWindow));
    return exports;
}

NODE_API_MODULE(adrenaline, Init)
