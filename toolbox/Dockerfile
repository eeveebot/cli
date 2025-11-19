FROM docker.io/alpine:3.22

ARG TARGETPLATFORM

RUN set -exu \
  && addgroup \
      --gid 1000 \
      eevee \
  && adduser \
      --disabled-password \
      --gecos "" \
      --ingroup eevee \
      --uid 1000 \
      eevee

RUN set -exu \
  && apk add --no-cache \
    bash \
    curl \
    iproute2-minimal \
    bind-tools \
    nodejs \
    npm

RUN set -exu \
  && case $(echo $TARGETPLATFORM | cut -d '/' -f2) in \
    amd64) \
      curl -L https://github.com/nats-io/natscli/releases/download/v0.3.0/nats-0.3.0-linux-amd64.zip -o /tmp/nats-cli.zip ;; \
    arm64) \
      curl -L https://github.com/nats-io/natscli/releases/download/v0.3.0/nats-0.3.0-linux-arm64.zip -o /tmp/nats-cli.zip ;; \
    *) \
      echo "Unsupported architecture: ${TARGETPLATFORM}" \
      exit 1 ;; \
    esac \
  && cd /tmp/ && unzip nats-cli.zip \
  && mv /tmp/nats-*/nats /usr/local/bin/

COPY --chown=eevee:eevee ./target/. /.

USER eevee

RUN --mount=type=secret,id=GITHUB_TOKEN,env=GITHUB_TOKEN \
  set -exu \
  && echo "//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}" | tee -a $HOME/.npmrc \
  && echo "@eeveebot:registry=https://npm.pkg.github.com/" | tee -a $HOME/.npmrc \
  && mkdir -p $HOME/.npm-global \
  && npm config set prefix $HOME/.npm-global \
  && npm install -g "@eeveebot/cli" \
  && rm $HOME/.npmrc \
  && echo "export PATH=\"$HOME/.npm-global/bin:\$PATH\"" | tee -a $HOME/.bashrc

WORKDIR $HOME

ENTRYPOINT [ "/bin/bash" ]
CMD [ "/entrypoint.sh" ]
