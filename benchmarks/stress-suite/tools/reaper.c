/*
 * reaper - a minimal process-subreaper wrapper.
 *
 * Why this exists: the benchmark runner and its descendants are killed with
 * SIGKILL, which is uncatchable. Any grandchild killed while its parent is
 * already dead gets re-parented to the nearest ancestor marked as a "child
 * subreaper". In a container PID 1 is usually the agent server, which does not
 * call wait(), so those re-parented processes stay as zombies forever.
 *
 * This wrapper marks itself as a subreaper, forks/execs the real command, then
 * waits for *every* descendant until there are none left. Orphans are therefore
 * re-parented to this process instead of PID 1 and are reaped immediately, so
 * `ps` shows zero leftover or zombie processes after a run.
 *
 * Build:  cc -O2 -o reaper reaper.c
 * Usage:  ./reaper <command> [args...]
 */

#define _GNU_SOURCE
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/wait.h>
#include <unistd.h>

static volatile pid_t g_child = -1;

static void forward_signal(int sig) {
    if (g_child > 0) {
        kill(g_child, sig);
    }
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: reaper <command> [args...]\n");
        return 2;
    }

    if (prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0) {
        perror("prctl(PR_SET_CHILD_SUBREAPER)");
        /* Not fatal: we still exec and forward signals, we just may not reap. */
    }

    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = forward_signal;
    sigemptyset(&sa.sa_mask);
    sigaction(SIGTERM, &sa, NULL);
    sigaction(SIGINT, &sa, NULL);
    sa.sa_handler = SIG_IGN;
    sigaction(SIGHUP, &sa, NULL);

    pid_t pid = fork();
    if (pid < 0) {
        perror("fork");
        return 1;
    }

    if (pid == 0) {
        execvp(argv[1], &argv[1]);
        perror("execvp");
        _exit(127);
    }

    g_child = pid;

    /* Reap every descendant, including ones re-parented to us, until none are
     * left. This is what drains the zombie backlog.
     *
     * Note the linger: when the main child dies, its own children are not
     * re-parented to us instantly - there is a short window in which we have no
     * children at all and waitpid() returns ECHILD. Exiting on that first ECHILD
     * would send the in-flight orphans to PID 1 (which, in a container, does not
     * reap them, leaving zombies). So after the main child is gone we keep
     * polling for a grace period and only exit once nothing has appeared. */
    int status = 0;
    int main_reaped = 0;
    int idle_polls = 0;
    const int IDLE_POLL_LIMIT = 100; /* 100 * 20ms = 2s of continuous silence */
    for (;;) {
        pid_t w = waitpid(-1, &status, WNOHANG);
        if (w > 0) {
            idle_polls = 0;
            if (w == pid) {
                main_reaped = 1;
                g_child = -1;
            }
            continue;
        }
        if (w < 0 && errno == EINTR) continue;
        if (w < 0 && errno != ECHILD) continue;
        if (main_reaped) {
            if (++idle_polls >= IDLE_POLL_LIMIT) break;
        }
        usleep(20000); /* 20ms */
    }

    return 0;
}
