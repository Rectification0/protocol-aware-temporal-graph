"""Frontend backend API layer (tasks.md Milestone F0).

A thin FastAPI service wrapping the existing engine objects/stores -- it
does not reimplement any detection logic, only expose it over HTTP. See
`t_gnn.api.app` for the application factory and `t_gnn.api_state` for the
Postgres-backed bridge between this (deliberately stateless, decoupled)
process and whatever process is actually running the detection pipeline
(`scripts/run_pipeline.py`).
"""
