# Linear Referencing Toolset

**Version 1.0** lives in **[js-version](js-version/)** — a browser-only HTML + JavaScript app. Open that folder.

Industry notes and older plans: [doc/](doc/).

| Folder | What it is |
|---|---|
| **[js-version](js-version/)** | Current tool. Validate → Overlay → Dissolve → Locate → Display, plus Create LRS and Extract / combine. |
| **[python-version](python-version/)** | Original Python / FastAPI app. Optional reference. |

## Use the JS tool

Double-click `js-version\run_lrs_app.bat`, or from `js-version` run `python -m http.server 8765` and open `http://127.0.0.1:8765/`.

See [js-version/README.md](js-version/README.md) for the workflow, map, Advanced mode, and formats.
