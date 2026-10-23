# tasks.md Backlog B.1: Flink image that can run the PyFlink decay/baseline
# job (src/t_gnn/flink/decay_job.py). Both the jobmanager (submits the job)
# and the taskmanager (runs its Python operators) use it.
#
# Why a container rather than the host: PyFlink 1.18 only supports Python
# 3.8-3.10 and the dev machine runs 3.12. The stock image is Ubuntu 22.04,
# whose system python3 is 3.10, so the job runs here and the host stays
# untouched.
#
# flink-python goes in lib/ (the parent classloader) rather than being loaded
# per job: otherwise every submission leaves another copy of its classes in
# Metaspace and the taskmanager eventually dies with an OOM (it did, after a
# dozen test-job submissions).
#
# The job imports the real decay/baseline modules rather than copies, so
# src/t_gnn is baked in -- but only that package's light dependencies
# (pyyaml, jsonschema). A full `pip install -e .` would pull torch/PyG,
# which the job never imports.
FROM flink:1.18.1-scala_2.12-java11

ARG KAFKA_CONNECTOR_VERSION=3.1.0-1.18

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-dev \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/bin/python \
    && pip3 install --no-cache-dir apache-flink==1.18.1 "pyyaml>=6.0" "jsonschema>=4.0" \
    && cp /opt/flink/opt/flink-python-1.18.1.jar /opt/flink/lib/ \
    && wget -q -P /opt/flink/lib \
       "https://repo1.maven.org/maven2/org/apache/flink/flink-sql-connector-kafka/${KAFKA_CONNECTOR_VERSION}/flink-sql-connector-kafka-${KAFKA_CONNECTOR_VERSION}.jar"

# Same layout as the source tree (protocol_registry.py/schema.py resolve
# config/ as parents[2] of the module), so /opt/t_gnn/src + /opt/t_gnn/config.
COPY src/t_gnn /opt/t_gnn/src/t_gnn
COPY config /opt/t_gnn/config
ENV PYTHONPATH=/opt/t_gnn/src
