FROM grafana/grafana:13.2.4
ARG VICTORIALOGS_PLUGIN_VERSION=0.33.1
ENV GF_PATHS_PLUGINS=/usr/share/grafana/ars-plugins \
    GF_PLUGINS_PREINSTALL_DISABLED=true \
    GF_ANALYTICS_REPORTING_ENABLED=false \
    GF_ANALYTICS_CHECK_FOR_UPDATES=false \
    GF_ANALYTICS_CHECK_FOR_PLUGIN_UPDATES=false \
    GF_NEWS_NEWS_FEED_ENABLED=false \
    GF_USERS_ALLOW_SIGN_UP=false \
    GF_AUTH_ANONYMOUS_ENABLED=false \
    GF_SECURITY_DISABLE_GRAVATAR=true \
    GF_SERVER_SERVE_FROM_SUB_PATH=true \
    GF_LOG_LEVEL=warn \
    GF_LOG_CONSOLE_FORMAT=json \
    GF_UNIFIED_ALERTING_ENABLED=true
USER root
RUN mkdir -p "$GF_PATHS_PLUGINS" \
    && if [ -n "$VICTORIALOGS_PLUGIN_VERSION" ]; then \
         grafana cli --pluginsDir "$GF_PATHS_PLUGINS" plugins install victoriametrics-logs-datasource "$VICTORIALOGS_PLUGIN_VERSION"; \
       fi \
    && chown -R 472:0 "$GF_PATHS_PLUGINS"
USER 472
COPY provisioning /etc/grafana/provisioning
COPY dashboards /var/lib/grafana-dashboards
