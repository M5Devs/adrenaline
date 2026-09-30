#include "window.h"
#include "vendor/webview.h"

#include <thread>
#include <mutex>
#include <unordered_map>
#include <memory>
#include <atomic>
#include <string>
#include <iostream>

namespace Adrenaline {

struct WindowInstance {
    int id;
    std::string title;
    int width;
    int height;
    std::string url;
    std::string html;

    webview::webview* wv{nullptr};
    std::thread th;
    std::atomic<bool> is_running{false};

    Napi::ThreadSafeFunction tsfn;
    bool has_tsfn{false};
    std::atomic<bool> tsfn_released{false};
};

static std::atomic<int> g_next_window_id{1};
static std::unordered_map<int, std::shared_ptr<WindowInstance>> g_windows;
static std::mutex g_windows_mutex;

Napi::Value CreateWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    std::string title = "Adrenaline Window";
    int width = 800;
    int height = 600;
    std::string url = "";
    std::string html = "";

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
        g_windows[window_id] = instance;
    }

    instance->th = std::thread([instance]() {
        try {
            webview::webview wv(false, nullptr);
            instance->wv = &wv;
            wv.set_title(instance->title.c_str());
            wv.set_size(instance->width, instance->height, WEBVIEW_HINT_NONE);

            wv.bind("__adrenaline_ipc_send", [instance](const std::string& seq, const std::string& req, void* /*arg*/) {
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

            wv.init("window.adrenaline = { send: function(channel, data) { return window.__adrenaline_ipc_send(channel, data); } };");

            if (!instance->html.empty()) {
                wv.set_html(instance->html.c_str());
            } else if (!instance->url.empty()) {
                wv.navigate(instance->url.c_str());
            }

            instance->is_running = true;
            wv.run();
            instance->is_running = false;
            instance->wv = nullptr;
        } catch (const std::exception& e) {
            std::cerr << "Adrenaline Window Exception: " << e.what() << std::endl;
            instance->is_running = false;
            instance->wv = nullptr;
        } catch (...) {
            std::cerr << "Adrenaline Window Unknown Exception" << std::endl;
            instance->is_running = false;
            instance->wv = nullptr;
        }

        if (instance->has_tsfn && !instance->tsfn_released.exchange(true)) {
            instance->tsfn.Release();
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
        auto it = g_windows.find(window_id);
        if (it != g_windows.end()) {
            instance = it->second;
            g_windows.erase(it);
        }
    }

    if (instance) {
        if (instance->wv) {
            instance->wv->dispatch([instance]() {
                if (instance->wv) {
                    instance->wv->terminate();
                }
            });
        }
        if (instance->has_tsfn && !instance->tsfn_released.exchange(true)) {
            instance->tsfn.Release();
        }
        if (instance->th.joinable()) {
            instance->th.join();
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
        auto it = g_windows.find(window_id);
        if (it != g_windows.end()) {
            instance = it->second;
        }
    }

    if (instance) {
        if (instance->wv) {
            std::string script_copy = script;
            instance->wv->dispatch([instance, script_copy]() {
                if (instance->wv) {
                    instance->wv->eval(script_copy);
                }
            });
            return Napi::Boolean::New(env, true);
        }
    }

    return Napi::Boolean::New(env, false);
}

} // namespace Adrenaline
