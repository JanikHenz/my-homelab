# Refactoring: Duplikate & unnötiger Code – 26.11.2026

Zweiter Durchgang nach [`CHANGELOG-cleanup-2026-11-26.md`](CHANGELOG-cleanup-2026-11-26.md).
**Nichts committet, gepusht oder im Cluster verändert.** Cluster-Zugriffe waren nur lesend
(`kubectl get/diff`, `kubectl apply --dry-run=server`).

Was du manuell tun musst (inkl. sicherer Übernahme durch das ApplicationSet):
[`MANUAL-STEPS-refactor-2026-11-26.md`](MANUAL-STEPS-refactor-2026-11-26.md).

## Ergebnis

| Bereich | vorher | nachher |
|---|---|---|
| `apps/` | 22 Dateien, 374 Zeilen | 2 Dateien, 87 Zeilen |
| `infrastructure/` | 12 Dateien, 700 Zeilen | Helm-Chart, 7 Dateien, 180 Zeilen |
| `manifests/` | 4230 Zeilen | 4162 Zeilen |
| **gesamt** | | **−1143 / +18 Zeilen** in 84 Dateien |

Tatsächliche Änderungen im Cluster nach dem Sync (per `kubectl diff` geprüft): **nur zwei** –
node-exporter ohne Scrape-Annotationen und Prometheus ohne `--web.enable-lifecycle`.
Alles andere ist inhaltlich identisch.

---

## 1. ApplicationSet statt 21 Application-Dateien

**Neu:** `apps/applicationset.yaml` (`homelab-apps`) – **gelöscht:** 21 Dateien `apps/<app>.yaml`.

- Eine Liste mit `name`, `path`, `namespace` pro App; eine gemeinsame Vorlage.
- In ArgoCD sieht alles gleich aus: Es entstehen dieselben 21 Applications (gleiche Namen
  → gleiche Kacheln). Geprüft: `project`, `source` und `destination` jeder erzeugten
  Application sind identisch mit den bisherigen Dateien.
- `apps/infrastructure.yaml` bleibt bewusst eine eigene Datei (kein Ziel-Namespace,
  immer manueller Sync ohne Prune).
- `preserveResourcesOnDeletion: true` als zusätzlicher Schutz.

**Entfallen (toter Code):**

| Was | Warum unnötig |
|---|---|
| `ignoreDifferences` für `librechat-secrets`, `nextcloud-secrets`, `pterodactyl-secrets` | Keine App synct ein Secret (die Secrets liegen nur als `.yaml.template` im Repo, die ArgoCD ignoriert). Die Regel bezog sich auf nichts. |
| `argocd.argoproj.io/sync-wave` (auch bei `infrastructure`) | Waves ordnen nur Ressourcen **innerhalb eines Syncs**. Die root-app legt nur Application-Objekte an (ohne auf deren Health zu warten), die Apps selbst werden einzeln von Hand gesynct → die Waves hatten keine Wirkung. |

## 2. `spec.replicas` wird nicht mehr von ArgoCD verwaltet

- In der ApplicationSet-Vorlage: `ignoreDifferences` für `/spec/replicas` (Deployments +
  StatefulSets) und `syncOptions: RespectIgnoreDifferences=true`.
- `replicas: 1` aus **26** Workloads entfernt (1 ist der Kubernetes-Standard).

**Wirkung:**
- Skalieren über dein Dashboard erzeugt kein OutOfSync mehr.
- Ein Sync startet eine bewusst gestoppte App **nicht** wieder (genau das ist heute
  passiert: alle auf 0 skalierten Apps liefen nach dem Sync wieder).
- Neue Deployments starten weiterhin mit 1 Replica.

## 3. Prometheus

**`manifests/monitoring/node-exporter-daemonset.yaml`:** Pod-Annotationen
`prometheus.io/scrape` und `prometheus.io/port` entfernt.

node-exporter wurde doppelt gescraped – vom Job `node-exporter` **und** vom generischen
Job `kubernetes-pods` (wegen der Annotation). Jede Host-Metrik existierte zweimal
(live geprüft: `count by (job) (node_load1)` → je 2 Serien in beiden Jobs). Folge: Summen
waren doppelt, z. B. `sum(rate(node_rapl_package_joules_total[5m]))` im Dashboard
(Stromverbrauch). Grafana und das Dashboard fragen `job="node-exporter"` ab → dieser Job bleibt.
dcgm-exporter behält seine Annotation (wird nur über `kubernetes-pods` erfasst).

**`manifests/monitoring/prometheus-deployment.yaml`:** `--web.enable-lifecycle` entfernt.
Das Flag aktiviert `POST /-/quit` und `POST /-/reload`. Nichts im Repo oder Dashboard nutzt
das. Eine geänderte `prometheus-config` wird nun durch einen Pod-Neustart übernommen.

## 4. Services: Standardwerte entfernt

In **27 Dateien** (alle Services mit nur TCP):
- `targetPort`, wenn gleich `port` (Kubernetes setzt `targetPort` standardmässig = `port`)
- `protocol: TCP` (Standard)

**Nicht angefasst:** `qbittorrent-torrent-service` und `syncthing-sync` (gleicher Port mit
TCP **und** UDP – dort bleibt alles explizit), sowie `nginx-dashboard-service`
(`targetPort: 8080` ≠ `port: 80`).
Jede geänderte Service-Definition wurde automatisch mit dem Original verglichen (inkl.
Standardwerte) → identisch. CRLF-Zeilenenden (Jellyfin, Plex) beibehalten.

## 5. `infrastructure/` als Helm-Chart

```
infrastructure/
├── Chart.yaml
├── values.yaml                # Namespaces + Volumes als Liste
└── templates/
    ├── namespaces.yaml        # 1 Namespace pro Eintrag (mit Lösch-Schutz)
    ├── storage.yaml           # PV "<name>-pv" + PVC "<name>-pvc" pro Eintrag
    ├── nvidia-device-plugin.yaml   # unverändert (vorher daemonset.yaml)
    ├── nvidia-plugin-config.yaml   # unverändert
    └── nvidia-runtimeclass.yaml    # unverändert
```

- ArgoCD erkennt das Chart an `Chart.yaml` und rendert es selbst – `apps/infrastructure.yaml`
  braucht dafür keine Änderung (gleicher `path`).
- Neuer Speicher = eine Zeile in `values.yaml`.
- **Verifikation:**
  - Vorab geprüft: alle 24 PV/PVC-Paare folgen exakt demselben Schema (einzige Ausnahme
    `nextcloud-mariadb-pv` mit `hostPath.type: DirectoryOrCreate` → Feld `hostPathType`).
  - Die aus `values.yaml` erzeugten Objekte wurden mit den 59 Original-Objekten verglichen:
    **0 fehlend, 0 zusätzlich, 0 abweichend.**
  - `kubectl diff` der Originale gegen den Cluster: keine inhaltlichen Unterschiede.
  - ⚠️ Ein echter `helm template`-Lauf war lokal nicht möglich (Helm nicht installiert,
    Container-Lauf wurde blockiert). Die Template-Logik wurde nachgebildet. **ArgoCD rendert
    das Chart beim ersten Refresh selbst** – steht `infrastructure` danach auf *Synced*, ist
    der Render bestätigt identisch (siehe Manual Steps).

## 6. README

- Verzeichnisstruktur (`apps/`, `infrastructure/`) aktualisiert.
- Abschnitt *Sync-Policy* korrigiert (stimmte vorher nicht: nur die root-app hat automated Sync).
- Mermaid-Diagramm: `apps/*.yaml` → `apps/applicationset.yaml`, `apps/dashboard.yaml` → Application `dashboard`.

## Hinweis zu älteren Dokumenten

`MANUAL-STEPS-cleanup-2026-11-26.md` nennt noch `infrastructure/namespaces.yaml`. Neue
Namespaces werden jetzt in `infrastructure/values.yaml` unter `namespaces:` eingetragen.
