FROM myoung34/github-runner:ubuntu-noble@sha256:f72002c1960a613a51f7a1e0b173ba17dfbf2ecc22ea098b3b09f8bf6331872a

USER root
RUN apt-get update && apt-get install -y --no-install-recommends python-is-python3 python3-yaml \
    && rm -rf /var/lib/apt/lists/*
