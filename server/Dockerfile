FROM golang:1.26-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

FROM alpine:3.22

RUN apk add --no-cache ca-certificates \
    && adduser -D -H -u 10001 app \
    && mkdir -p /data \
    && chown app:app /data

USER app
COPY --from=build /out/server /usr/local/bin/server

VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/server"]
