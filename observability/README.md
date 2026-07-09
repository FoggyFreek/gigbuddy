# Observability (Grafana Cloud)

The `alloy` service in `docker-compose.yml` runs [Grafana Alloy](https://grafana.com/docs/alloy/)
(pinned `v1.16.1`) on the VPS and ships three things to Grafana Cloud:

| Signal | Source | Sink |
| --- | --- | --- |
| Application metrics | Node app `GET /metrics` (prom-client) scraped every 60s | Grafana Cloud Prometheus (remote-write) |
| Docker container metrics | in-process cAdvisor exporter | Grafana Cloud Prometheus (remote-write) |
| Container logs | Docker log discovery (all services except Alloy) | Grafana Cloud Loki |

Every series/stream carries `deployment="gigbuddy"`, `environment="production"`, and a
stable `service_name` (the Compose service). App log lines are shipped byte-for-byte
(one JSON object per line) so LogQL `| json` works.

The pipeline is defined in [`config.alloy`](./config.alloy). It is **not** started by
local `docker compose up` — it lives under the `observability` Compose profile and is
started explicitly on the VPS (the deploy workflow does this).

## What to configure in GitHub Actions

The deploy workflow (`.github/workflows/deploy.yml`) writes these into the VPS `.env`
from repository secrets. Add them under **Settings → Secrets and variables → Actions →
Repository secrets**:

| Secret name | Value | Secret? |
| --- | --- | --- |
| `GCLOUD_RW_API_KEY` | Grafana Cloud **write token** (access-policy token) | **Yes — treat as a credential** |
| `GCLOUD_HOSTED_METRICS_URL` | Prometheus remote-write URL, e.g. `https://prometheus-prod-XX-…grafana.net/api/prom/push` | No (identifier) |
| `GCLOUD_HOSTED_METRICS_ID` | Prometheus instance/user id (numeric) | No (identifier) |
| `GCLOUD_HOSTED_LOGS_URL` | Loki push URL, e.g. `https://logs-prod-XXX.grafana.net/loki/api/v1/push` | No (identifier) |
| `GCLOUD_HOSTED_LOGS_ID` | Loki instance/user id (numeric) | No (identifier) |

`GCLOUD_SCRAPE_INTERVAL` is set to `60s` in the workflow, not a secret.

### Creating the write token in Grafana Cloud

1. Grafana Cloud → **Administration → Access Policies → Create access policy**.
2. Grant realms/scopes: **`metrics:write`** and **`logs:write`** (this token only writes).
3. Create a **token** under that policy → copy it → store as the `GCLOUD_RW_API_KEY`
   GitHub secret. It is shown once.
4. Find the URLs and instance IDs under **Connections / “Details”** for your
   Prometheus and Loki stacks (the "Sending data" panels list the remote-write /
   push URL and the numeric instance id used as the basic-auth username).

> ⚠️ If a write token is ever pasted into a message, a PR, or a shell command, treat it
> as exposed: **revoke it in Grafana Cloud and issue a new one.** The token belongs only
> in the GitHub secret — never commit it or bake it into an install command.

## Security notes

- **`/metrics` is unauthenticated.** The app port is bound to `127.0.0.1:3002` on the
  host and Alloy scrapes it over the internal Docker network. **The public reverse
  proxy must not route `/metrics`** — verify your nginx/Caddy config excludes it.
- Metric labels are deliberately bounded: `method`, normalized `route` template
  (or `unmatched`), and `status`. No tenant ids, user ids, raw paths, or request data.
- The Alloy container is `privileged` and mounts the Docker socket + host paths — this
  is required by the cAdvisor exporter and equals host-root reach. That trust boundary
  is inherent to container resource monitoring; a host install would not reduce it.

## Local validation (no secrets needed)

```
docker run --rm -v "$PWD/observability/config.alloy:/c.alloy:ro" \
  grafana/alloy:v1.16.1 validate /c.alloy
```

To smoke-test the whole compose file (YAML only) with dummy values:

```
GCLOUD_HOSTED_METRICS_URL=x GCLOUD_HOSTED_METRICS_ID=x GCLOUD_HOSTED_LOGS_URL=x \
GCLOUD_HOSTED_LOGS_ID=x GCLOUD_RW_API_KEY=x GCLOUD_SCRAPE_INTERVAL=60s \
docker compose --profile observability config >/dev/null
```

## Verifying after deploy

In Grafana Cloud:

- **Metrics** — `Explore` the Prometheus datasource: `http_requests_total`,
  `process_cpu_seconds_total` (app), and `container_cpu_usage_seconds_total`
  (Docker resources) should return series labelled `deployment="gigbuddy"`.
- **Logs** — `Explore` the Loki datasource: `{deployment="gigbuddy"}` should stream
  logs, filterable by `service_name` (e.g. `{service_name="app"} | json`). Alloy's own
  logs should be absent.
