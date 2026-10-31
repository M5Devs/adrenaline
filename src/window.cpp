#include "window.h"
#include "features.h"
#include "vendor/webview.h"

#include <thread>
#include <mutex>
#include <unordered_map>
#include <memory>
#include <atomic>
#include <string>
#include <iostream>
#include <functional>
#include <future>
#include <deque>
#include <chrono>
#include <vector>

namespace Adrenaline {

struct WindowInstance {
    int id;
    std::string title;
    int width;
    int height;
    std::string url;
    std::string html;

    bool resizable{true};
    int minWidth{0};
    int minHeight{0};
    int maxWidth{0};
    int maxHeight{0};

    bool lowEndDeviceMode{true};
    bool privacyShield{true};

    // Owned by the engine thread and only ever touched from it. The JS thread
    // interacts with it exclusively by posting tasks to the engine queue.
    std::shared_ptr<webview::webview> wv;

    Napi::ThreadSafeFunction tsfn;
    bool has_tsfn{false};
    std::atomic<bool> tsfn_released{false};
};

static std::atomic<int> g_next_window_id{1};

// The registry is heap-allocated so it is never destroyed by a static
// destructor at process exit; teardown happens explicitly via shutdown().
static std::unordered_map<int, std::shared_ptr<WindowInstance>>& windows_map() {
    static auto* m = new std::unordered_map<int, std::shared_ptr<WindowInstance>>();
    return *m;
}
static std::mutex g_windows_mutex;

// Closed windows are parked here rather than destroyed: WebKit aborts when a
// webview is torn down, and the OS reclaims the memory at process exit.
static std::vector<std::shared_ptr<WindowInstance>>& closed_windows() {
    static auto* v = new std::vector<std::shared_ptr<WindowInstance>>();
    return *v;
}
static std::mutex g_closed_mutex;

// GTK/WebKit are single-threaded: every gtk_*/webkit_* call, and iteration of
// the default GMainContext, must happen on one thread. Running a main loop per
// window corrupts the heap, so all windows live on one dedicated engine thread
// and the JS thread only ever posts work to it.
namespace {
struct EngineState {
    std::thread thread;
    std::mutex mutex;
    std::deque<std::function<void()>> tasks;
    bool started{false};
    bool stop{false};
};

// Intentionally leaked: the engine thread must never be torn down by a static
// destructor at process exit (a joinable std::thread would call
// std::terminate, and destroying GTK state races with the still-running thread).
// The normal teardown path joins the thread via ShutdownWindows(); if the
// process exits without it, the OS reclaims everything.
EngineState& engine() {
    static EngineState* state = new EngineState();
    return *state;
}

void EngineThreadMain() {
    GMainContext* ctx = g_main_context_default();
    for (;;) {
        for (;;) {
            std::function<void()> task;
            {
                std::lock_guard<std::mutex> lock(engine().mutex);
                if (engine().tasks.empty()) {
                    break;
                }
                task = std::move(engine().tasks.front());
                engine().tasks.pop_front();
            }
            task();
        }

        {
            std::lock_guard<std::mutex> lock(engine().mutex);
            if (engine().stop && engine().tasks.empty()) {
                break;
            }
        }

        // Block until the next GTK/WebKit event or a wakeup from a new task.
        g_main_context_iteration(ctx, TRUE);
    }
}

void EnsureEngineThread() {
    std::lock_guard<std::mutex> lock(engine().mutex);
    if (engine().started) {
        return;
    }
    engine().started = true;
    engine().thread = std::thread(EngineThreadMain);
}

void PushEngineTask(std::function<void()> fn) {
    {
        std::lock_guard<std::mutex> lock(engine().mutex);
        engine().tasks.push_back(std::move(fn));
    }
    g_main_context_wakeup(g_main_context_default());
}

// Runs fn on the engine thread and waits for it to finish.
void RunOnEngine(const std::function<void()>& fn) {
    EnsureEngineThread();
    std::promise<void> done;
    std::future<void> finished = done.get_future();
    PushEngineTask([&fn, &done]() {
        try {
            fn();
        } catch (...) {
        }
        done.set_value();
    });
    finished.wait();
}

// Let pending GTK/WebKit work settle before tearing a webview down. Destroying a
// webview while WebKit is still loading leaves JSC state that aborts during
// process exit, so pump the loop until it goes quiet (or the budget expires).
void DrainEngine(int max_ms) {
    GMainContext* ctx = g_main_context_default();
    auto deadline = std::chrono::steady_clock::now() +
                    std::chrono::milliseconds(max_ms);
    while (std::chrono::steady_clock::now() < deadline) {
        if (!g_main_context_iteration(ctx, FALSE)) {
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }
    }
}
} // namespace


Napi::Value GetCompiledFeatures(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object feats = Napi::Object::New(env);

    feats.Set("devtools", Napi::Boolean::New(env, ADREN_FEATURE_DEVTOOLS != 0));
    feats.Set("localFiles", Napi::Boolean::New(env, ADREN_FEATURE_LOCAL_FILES != 0));
    feats.Set("pdf", Napi::Boolean::New(env, ADREN_FEATURE_PDF != 0));
    feats.Set("webrtc", Napi::Boolean::New(env, ADREN_FEATURE_WEBRTC != 0));
    feats.Set("cleanPrivacy", Napi::Boolean::New(env, ADREN_FEATURE_CLEAN_PRIVACY != 0));
    feats.Set("cef", Napi::Boolean::New(env, ADREN_FEATURE_CEF != 0));
    feats.Set("webview", Napi::Boolean::New(env, ADREN_FEATURE_WEBVIEW != 0));

    return feats;
}

Napi::Value CreateWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    std::string title = "Adrenaline Window";
    int width = 800;
    int height = 600;
    std::string url = "";
    std::string html = "";
    bool resizable = true;
    int minWidth = 0;
    int minHeight = 0;
    int maxWidth = 0;
    int maxHeight = 0;
    bool lowEndDeviceMode = true;
    bool privacyShield = true;

    Napi::Function ipc_cb;
    bool has_ipc_cb = false;

    if (info.Length() > 0 && info[0].IsObject()) {
        Napi::Object opts = info[0].As<Napi::Object>();

        if (opts.Has("title") && opts.Get("title").IsString()) {
            title = opts.Get("title").As<Napi::String>().Utf8Value();
        }
        if (opts.Has("width") && opts.Get("width").IsNumber()) {
            width = opts.Get("width").As<Napi::Number>().Int32Value();
        }
        if (opts.Has("height") && opts.Get("height").IsNumber()) {
            height = opts.Get("height").As<Napi::Number>().Int32Value();
        }
        if (opts.Has("url") && opts.Get("url").IsString()) {
            url = opts.Get("url").As<Napi::String>().Utf8Value();
        }
        if (opts.Has("html") && opts.Get("html").IsString()) {
            html = opts.Get("html").As<Napi::String>().Utf8Value();
        }
        if (opts.Has("resizable") && opts.Get("resizable").IsBoolean()) {
            resizable = opts.Get("resizable").As<Napi::Boolean>().Value();
        }
        if (opts.Has("minWidth") && opts.Get("minWidth").IsNumber()) {
            minWidth = opts.Get("minWidth").As<Napi::Number>().Int32Value();
        }
        if (opts.Has("minHeight") && opts.Get("minHeight").IsNumber()) {
            minHeight = opts.Get("minHeight").As<Napi::Number>().Int32Value();
        }
        if (opts.Has("maxWidth") && opts.Get("maxWidth").IsNumber()) {
            maxWidth = opts.Get("maxWidth").As<Napi::Number>().Int32Value();
        }
        if (opts.Has("maxHeight") && opts.Get("maxHeight").IsNumber()) {
            maxHeight = opts.Get("maxHeight").As<Napi::Number>().Int32Value();
        }
        if (opts.Has("lowEndDeviceMode") && opts.Get("lowEndDeviceMode").IsBoolean()) {
            lowEndDeviceMode = opts.Get("lowEndDeviceMode").As<Napi::Boolean>().Value();
        }
        if (opts.Has("privacyShield") && opts.Get("privacyShield").IsBoolean()) {
            privacyShield = opts.Get("privacyShield").As<Napi::Boolean>().Value();
        }
        if (opts.Has("onIpc") && opts.Get("onIpc").IsFunction()) {
            ipc_cb = opts.Get("onIpc").As<Napi::Function>();
            has_ipc_cb = true;
        }
    }

    if (!has_ipc_cb && info.Length() > 1 && info[1].IsFunction()) {
        ipc_cb = info[1].As<Napi::Function>();
        has_ipc_cb = true;
    }

    int window_id = g_next_window_id++;
    auto instance = std::make_shared<WindowInstance>();
    instance->id = window_id;
    instance->title = title;
    instance->width = width;
    instance->height = height;
    instance->url = url;
    instance->html = html;
    instance->resizable = resizable;
    instance->minWidth = minWidth;
    instance->minHeight = minHeight;
    instance->maxWidth = maxWidth;
    instance->maxHeight = maxHeight;
    instance->lowEndDeviceMode = lowEndDeviceMode;
    instance->privacyShield = privacyShield;

    if (has_ipc_cb) {
        instance->tsfn = Napi::ThreadSafeFunction::New(
            env,
            ipc_cb,
            "Adrenaline IPC TSFN",
            0,
            1
        );
        instance->has_tsfn = true;
    }

    {
        std::lock_guard<std::mutex> lock(g_windows_mutex);
        windows_map()[window_id] = instance;
    }

    // The webview is created on the shared engine thread; the JS thread only
    // posts this setup task and returns the window id immediately.
    EnsureEngineThread();
    PushEngineTask([instance]() {
        try {
            bool debug_flag = false;
#if ADREN_FEATURE_DEVTOOLS
            debug_flag = true;
#endif
            auto wv = std::make_shared<webview::webview>(debug_flag, nullptr);
            wv->set_title(instance->title.c_str());

            webview_hint_t hint = instance->resizable ? WEBVIEW_HINT_NONE : WEBVIEW_HINT_FIXED;
            wv->set_size(instance->width, instance->height, hint);
            if (instance->minWidth > 0 || instance->minHeight > 0) {
                wv->set_size(instance->minWidth, instance->minHeight, WEBVIEW_HINT_MIN);
            }
            if (instance->maxWidth > 0 || instance->maxHeight > 0) {
                wv->set_size(instance->maxWidth, instance->maxHeight, WEBVIEW_HINT_MAX);
            }

            wv->bind("__adrenaline_ipc_send", [instance](const std::string& seq, const std::string& req, void* /*arg*/) {
                if (instance->wv) {
                    instance->wv->resolve(seq, 0, "null");
                }
                if (instance->has_tsfn && !instance->tsfn_released) {
                    std::string* raw_req = new std::string(req);
                    napi_status status = instance->tsfn.NonBlockingCall(raw_req, [](Napi::Env env, Napi::Function jsCallback, std::string* data) {
                        if (env != nullptr && jsCallback != nullptr && data != nullptr) {
                            Napi::HandleScope scope(env);

                            Napi::Object global = env.Global();
                            Napi::Object jsonObj = global.Get("JSON").As<Napi::Object>();
                            Napi::Function parseFn = jsonObj.Get("parse").As<Napi::Function>();

                            Napi::Value parsedReqVal;
                            try {
                                parsedReqVal = parseFn.Call(jsonObj, { Napi::String::New(env, *data) });
                            } catch (...) {
                                parsedReqVal = env.Null();
                            }

                            Napi::Value channelVal = env.Undefined();
                            Napi::Value dataVal = env.Undefined();

                            if (parsedReqVal.IsArray()) {
                                Napi::Array arr = parsedReqVal.As<Napi::Array>();
                                if (arr.Length() > 0) {
                                    channelVal = arr.Get((uint32_t)0);
                                }
                                if (arr.Length() > 1) {
                                    dataVal = arr.Get((uint32_t)1);
                                }
                            }

                            jsCallback.Call({ channelVal, dataVal });
                        }
                        delete data;
                    });
                    if (status != napi_ok) {
                        delete raw_req;
                    }
                }
            }, nullptr);

            std::string init_script = R"raw(
                window.adrenaline = window.adrenaline || {};
                window.adrenaline.send = function(channel, data) { return window.__adrenaline_ipc_send(channel, data); };
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
            )raw";

            if (instance->privacyShield) {
                init_script += R"raw(
                    if (navigator && navigator.sendBeacon) {
                        navigator.sendBeacon = function() { return true; };
                    }
                )raw";
            }

            wv->init(init_script.c_str());

            if (!instance->html.empty()) {
                wv->set_html(instance->html.c_str());
            } else if (!instance->url.empty()) {
                wv->navigate(instance->url.c_str());
            }

            instance->wv = std::move(wv);
        } catch (const std::exception& e) {
            std::cerr << "Adrenaline Window Exception: " << e.what() << std::endl;
            instance->wv.reset();
        } catch (...) {
            std::cerr << "Adrenaline Window Unknown Exception" << std::endl;
            instance->wv.reset();
        }
    });

    return Napi::Number::New(env, window_id);
}

Napi::Value CloseWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Window ID expected").ThrowAsJavaScriptException();
        return env.Null();
    }

    int window_id = info[0].As<Napi::Number>().Int32Value();
    std::shared_ptr<WindowInstance> instance;

    {
        std::lock_guard<std::mutex> lock(g_windows_mutex);
        auto it = windows_map().find(window_id);
        if (it != windows_map().end()) {
            instance = it->second;
            windows_map().erase(it);
        }
    }

    if (instance) {
        if (instance->has_tsfn && !instance->tsfn_released.exchange(true)) {
            instance->tsfn.Release();
        }
        // WebKit aborts when a webview is torn down, even after draining, so a
        // closed window's instance is parked here instead of destroyed. The OS
        // reclaims it at process exit; this keeps close() crash-free.
        {
            std::lock_guard<std::mutex> lock(g_closed_mutex);
            closed_windows().push_back(instance);
        }
        return Napi::Boolean::New(env, true);
    }

    return Napi::Boolean::New(env, false);
}

Napi::Value EvalWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Expected window ID (number) and script (string)").ThrowAsJavaScriptException();
        return env.Null();
    }

    int window_id = info[0].As<Napi::Number>().Int32Value();
    std::string script = info[1].As<Napi::String>().Utf8Value();

    std::shared_ptr<WindowInstance> instance;
    {
        std::lock_guard<std::mutex> lock(g_windows_mutex);
        auto it = windows_map().find(window_id);
        if (it != windows_map().end()) {
            instance = it->second;
        }
    }

    if (instance) {
        RunOnEngine([instance, script]() {
            if (instance->wv) {
                instance->wv->eval(script);
            }
        });
        return Napi::Boolean::New(env, true);
    }

    return Napi::Boolean::New(env, false);
}

Napi::Value NavigateWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Expected window ID (number) and URL (string)").ThrowAsJavaScriptException();
        return env.Null();
    }

    int window_id = info[0].As<Napi::Number>().Int32Value();
    std::string url = info[1].As<Napi::String>().Utf8Value();

    std::shared_ptr<WindowInstance> instance;
    {
        std::lock_guard<std::mutex> lock(g_windows_mutex);
        auto it = windows_map().find(window_id);
        if (it != windows_map().end()) {
            instance = it->second;
        }
    }

    if (instance) {
        instance->url = url;
        RunOnEngine([instance, url]() {
            if (instance->wv) {
                instance->wv->navigate(url);
            }
        });
        return Napi::Boolean::New(env, true);
    }

    return Napi::Boolean::New(env, false);
}

Napi::Value ShutdownCallback(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    ShutdownWindows();
    return env.Undefined();
}

void ShutdownWindows() {
    if (!engine().started) {
        return;
    }

    // Runs from the JS process 'exit' hook (index.js), which blocks until it
    // returns. Exiting while WebKit is still loading leaves JSC state that
    // segfaults during node's own teardown, so let pending loads settle first.
    // Windows still open here are deliberately not destroyed: tearing a webview
    // down at exit aborts even after draining, and the OS reclaims it anyway.
    RunOnEngine([]() { DrainEngine(500); });

    // Stop and join the engine thread so it cannot outlive the process.
    {
        std::lock_guard<std::mutex> lock(engine().mutex);
        engine().stop = true;
    }
    g_main_context_wakeup(g_main_context_default());
    if (engine().thread.joinable()) {
        engine().thread.join();
    }
    engine().started = false;
}

} // namespace Adrenaline
