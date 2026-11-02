#ifndef ADRENALINE_CEF_WAKEUP_H_
#define ADRENALINE_CEF_WAKEUP_H_

#include <atomic>
#include <chrono>
#include <cstdint>

#if defined(__linux__)
#include <sys/eventfd.h>
#include <unistd.h>
#endif

// Process-wide wake channel for the engine thread.
//
// The engine thread owns CEF's external message pump and must block when there
// is nothing to do. Blocking on a fixed sleep would add that sleep to every IPC
// round trip, so it blocks in poll() on this fd instead and pumps the moment it
// becomes readable. The fd is signalled by:
//   - the JS thread, right after queuing an engine task;
//   - CEF itself, from CefBrowserProcessHandler::OnScheduleMessagePumpWork;
//   - the shutdown path, to break the loop out of poll().
//
// A function-local static keeps a single fd for the whole process regardless of
// how many translation units include this header.
namespace adrenaline {

inline int& EngineWakeFd() {
#if defined(__linux__)
    static int fd = eventfd(0, EFD_NONBLOCK | EFD_CLOEXEC);
    return fd;
#else
    static int fd = -1;  // poll() ignores negative descriptors and just times out.
    return fd;
#endif
}

// Signal the engine thread. Safe from any thread and before the thread exists:
// the pending eventfd count makes the first poll() return immediately. Returns
// the fd so the caller can poll() on it.
inline int SignalEngineWakeup() {
    int fd = EngineWakeFd();
#if defined(__linux__)
    if (fd >= 0) {
        uint64_t one = 1;
        ssize_t written = write(fd, &one, sizeof(one));
        (void)written;
    }
#endif
    return fd;
}

// Drain a pending eventfd count. Called by the engine thread after poll()
// reports the fd readable so the next wait blocks again.
inline void DrainEngineWakeup(int fd) {
#if defined(__linux__)
    if (fd >= 0) {
        uint64_t drained = 0;
        ssize_t n = read(fd, &drained, sizeof(drained));
        (void)n;
    }
#else
    (void)fd;
#endif
}

// Should the external pump be serviced now? Returns true immediately while
// `active` (a window is up and interactive), and otherwise at most once per
// `idle_period` so an idle app does not burn a core on empty pumps.
inline bool ShouldPumpNow(const std::atomic<bool>& active,
                          std::chrono::steady_clock::time_point& last_pump,
                          std::chrono::milliseconds idle_period) {
    if (active.load(std::memory_order_relaxed)) {
        return true;
    }
    auto now = std::chrono::steady_clock::now();
    if (now - last_pump >= idle_period) {
        last_pump = now;
        return true;
    }
    return false;
}

}  // namespace adrenaline

#endif  // ADRENALINE_CEF_WAKEUP_H_
