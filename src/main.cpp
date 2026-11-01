#include <napi.h>
#include "features.h"
#include "window.h"
#include "dialog.h"

#if defined(__linux__)
#include <X11/Xlib.h>
#endif

Napi::String Ping(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::String::New(env, "Adrenaline Core v0.1.0 is Alive!");
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
#if defined(__linux__)
    // Each window runs its own GTK main loop on a dedicated thread. libX11 is
    // not thread-safe unless XInitThreads() runs before any other X call, and
    // concurrent gtk_init() calls otherwise corrupt the heap. Do it once here,
    // before the first window is created.
    static const bool x_threads_initialized = XInitThreads();
    (void)x_threads_initialized;
#endif

    exports.Set(Napi::String::New(env, "ping"), Napi::Function::New(env, Ping));
    exports.Set(Napi::String::New(env, "createWindow"), Napi::Function::New(env, Adrenaline::CreateWindow));
    exports.Set(Napi::String::New(env, "closeWindow"), Napi::Function::New(env, Adrenaline::CloseWindow));
    exports.Set(Napi::String::New(env, "evalWindow"), Napi::Function::New(env, Adrenaline::EvalWindow));
    exports.Set(Napi::String::New(env, "navigateWindow"), Napi::Function::New(env, Adrenaline::NavigateWindow));
    exports.Set(Napi::String::New(env, "getCompiledFeatures"), Napi::Function::New(env, Adrenaline::GetCompiledFeatures));
    exports.Set(Napi::String::New(env, "showOpenDialog"), Napi::Function::New(env, Adrenaline::ShowOpenDialog));
    exports.Set(Napi::String::New(env, "showSaveDialog"), Napi::Function::New(env, Adrenaline::ShowSaveDialog));
    exports.Set(Napi::String::New(env, "showMessageBox"), Napi::Function::New(env, Adrenaline::ShowMessageBox));
    exports.Set(Napi::String::New(env, "shutdown"), Napi::Function::New(env, Adrenaline::ShutdownCallback));

    // Env cleanup hooks do not run for process.exit(); index.js installs a
    // process 'exit' hook that calls the exported shutdown() instead.
    return exports;
}

NODE_API_MODULE(adrenaline, Init)
