"""Run the frontend API service: `python -m t_gnn.api`.

Mirrors this repo's other `python -m t_gnn.*` CLI convention
(`docs/cli-reference.md`) -- ensures `.env` is loaded (via `t_gnn.db`'s
import side effect, pulled in transitively through `t_gnn.api.deps`)
before uvicorn starts.
"""

from __future__ import annotations

import argparse

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true", help="auto-reload on source changes (local dev only)")
    args = parser.parse_args()

    uvicorn.run("t_gnn.api.app:app", host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
