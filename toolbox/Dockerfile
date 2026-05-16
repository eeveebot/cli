FROM docker.io/node:24-alpine

ARG TARGETPLATFORM

RUN set -exu \
  && apk add --no-cache \
    bash \
    curl \
    iproute2-minimal \
    bind-tools \
    unzip

RUN set -exu \
  && case $(echo $TARGETPLATFORM | cut -d '/' -f2) in \
    amd64) \
      curl -L https://github.com/nats-io/natscli/releases/download/v0.4.0/nats-0.4.0-linux-amd64.zip -o /tmp/nats-cli.zip ;; \
    arm64) \
      curl -L https://github.com/nats-io/natscli/releases/download/v0.4.0/nats-0.4.0-linux-arm64.zip -o /tmp/nats-cli.zip ;; \
    *) \
      echo "Unsupported architecture: ${TARGETPLATFORM}" \
      exit 1 ;; \
    esac \
  && cd /tmp/ && unzip nats-cli.zip \
  && mv /tmp/nats-*/nats /usr/local/bin/ \
  && rm -rf /tmp/nats-cli.zip /tmp/nats-0.4.0

COPY --chown=node:node ./target/. /.

USER node

ENV HOME /home/node
WORKDIR /home/node

RUN --mount=type=secret,id=GITHUB_TOKEN,env=GITHUB_TOKEN \
  set -exu \
  && echo "@eeveebot:registry=https://npm.pkg.github.com/" > $HOME/.npmrc \
  && echo "//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}" >> $HOME/.npmrc \
  && mkdir -p $HOME/.npm-global \
  && npm config set prefix $HOME/.npm-global \
  && npm install -g @eeveebot/cli \
  && rm $HOME/.npmrc \
  && echo "export PATH=\"$HOME/.npm-global/bin:\$PATH\"" >> $HOME/.bashrc

ENTRYPOINT [ "/entrypoint.sh" ]
CMD [ "eevee", "monitor", "--follow" ]
