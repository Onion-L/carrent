# Multi-window macOS smoke pass

Run from the repository root:

```sh
bun run dev:desktop
```

Verify with two Carrent Windows showing the same Thread:

1. Edit the Composer in one window and confirm the other window updates.
2. Start a Run and confirm streaming, Stop, and an Approval Request or user question appear in both windows.
3. Change an Interface setting in one window and confirm the other window updates while keeping its own route.
4. Open the Integrated Terminal in both windows. Confirm the same Tabs and output appear, then focus and resize each viewport in turn.
5. Close one window and confirm the Run and Terminal remain active in the other.
6. Quit and restart. Confirm open window routes and geometry restore, while Terminal panel state, Tabs, and output do not.
7. Open a Thread in a new window from normal and maximized sources and confirm the peer uses cascaded normal bounds.

To exercise the non-blocking BrowserWindow failure path once:

```sh
CARRENT_SMOKE_FAIL_WINDOW_CREATION=1 bun run dev:desktop
```

Use `Open in new window` once. Confirm the source window shows an error toast and remains unchanged. A second attempt creates the peer normally.
