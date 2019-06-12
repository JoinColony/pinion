FROM node:10.16-alpine AS builder

ADD . / pinion/

RUN apk add --no-cache python build-base

RUN cd /pinion && yarn && yarn build && rm -rf node_modules && yarn --production

FROM node:10.16-alpine

COPY --from=builder /pinion /pinion

RUN cd /pinion

ENTRYPOINT /pinion/bin/index.js
