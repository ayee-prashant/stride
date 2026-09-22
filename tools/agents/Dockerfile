# One image per agent CLI, built from the same base so they behave alike.
#   docker build --build-arg CLI=@anthropic-ai/claude-code -t stride-agent-claude .
FROM node:24-slim

ARG CLI
ARG CLI_VERSION=latest

RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl ripgrep less \
 && rm -rf /var/lib/apt/lists/*

# A non-root user so credentials written into the mounted home are not root-owned.
RUN useradd -m -u 1001 -s /bin/bash agent

RUN npm install -g "${CLI}@${CLI_VERSION}" && npm cache clean --force

# Record what this image actually is, so a running container can be identified.
RUN printf '%s\n' "${CLI}" > /etc/agent-cli

USER agent
WORKDIR /work
ENV HOME=/home/agent
# Some CLIs probe these; set them so a headless container does not guess.
ENV TERM=xterm-256color
ENV NO_COLOR=1

CMD ["bash"]
