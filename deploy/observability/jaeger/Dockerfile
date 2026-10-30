FROM jaegertracing/jaeger:2.20.0
USER root
RUN mkdir -p /badger && chown 10001:10001 /badger
USER 10001
COPY config.yaml /etc/jaeger/config.yaml
CMD ["--config", "/etc/jaeger/config.yaml"]
