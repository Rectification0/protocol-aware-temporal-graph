# tasks.md F17.2: container image for the frontend API (`python -m t_gnn.api`,
# Milestone F0). Build context is the repo root:
#   docker build -f docker/api.Dockerfile -t t-gnn-api .
#
# The API is a stateless reader (CLAUDE.md, F0): it needs Postgres, Neo4j and
# Redis reachable, plus read access to the pipeline's audit log -- all
# supplied via environment/volumes (see docker-compose.yml's `api` service).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Editable install on purpose: protocol_registry.py/motifs.py resolve
# config/ as `Path(__file__).parents[2]`, i.e. relative to the *source
# tree*. A regular install into site-packages would break that, so the
# source stays at /app/src with /app/config beside it. The API process
# imports torch transitively (api_state -> tgnn), so it's installed from
# PyTorch's CPU-only index -- the CUDA wheels would add gigabytes for a
# process that never runs a model.
COPY pyproject.toml ./
COPY src ./src
COPY config ./config
RUN pip install --extra-index-url https://download.pytorch.org/whl/cpu -e . \
    && useradd --system --uid 10001 --no-create-home t-gnn

USER t-gnn
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)" || exit 1

CMD ["python", "-m", "t_gnn.api", "--host", "0.0.0.0", "--port", "8000"]
