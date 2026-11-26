# Cleanup & Optimierungen – 26.11.2026

Dieses Dokument beschreibt **alle Änderungen**, die im Repo vorgenommen wurden.
Es wurde **nichts committet, gepusht oder im Cluster verändert** – alle Cluster-Zugriffe
waren rein lesend (`kubectl get/describe`, `kubectl apply --dry-run=server`).

Was du danach manuell erledigen musst, steht in
[`MANUAL-STEPS-cleanup-2026-11-26.md`](MANUAL-STEPS-cleanup-2026-11-26.md).

---

## Übersicht

| # | Bereich | Änderung | Wirkung im Cluster |
|---|---------|----------|--------------------|
| 1 | LibreChat, Ollama | IngressRoute `websecure` → `web` | Routen werden über Port 80 (Cloudflare Tunnel) erreichbar |
| 2 | Grafana | Admin-Passwort aus Secret statt Klartext | **Secret muss vorher existieren** |
| 3 | Plex | `TZ` `Europe/Berlin` → `Europe/Zurich` | Pod-Neustart, gleiche Zeitzone (Offset identisch) |
| 4 | Apps | `CreateNamespace=true` entfernt | keine – Namespaces kommen aus `infrastructure/namespaces.yaml` |
| 5 | Infrastruktur | Ordner `infrastrucure/` → `infrastructure/` + neue ArgoCD-App | neue App „infrastructure“ (manueller Sync) |
| 6 | Namespaces | `fitness` entfernt, Lösch-Schutz-Annotation | keine (Live-Namespace bleibt bestehen) |
| 7 | Pterodactyl Panel | wirkungslose Init-Befehle entfernt | Pod-Neustart, gleiches Verhalten |
| 8 | Pterodactyl Wings | redundante Capabilities + Kommentare entfernt | Pod-Neustart, gleiche Rechte |
| 9 | Jellyseerr | ungenutzte Env-Variable + KI-Kommentar entfernt | Pod-Neustart |
| 10 | Diverse | Default-Werte entfernt | keine |
| 11 | Prometheus RBAC | ungenutzte Ingress-Regel entfernt | keine |
| 12 | 6 Deployments | `namespace:` explizit gesetzt | keine (verhindert Fehl-Deployments) |
| 13 | LibreChat | `wait-for-mongodb` mit `busybox` statt `mongo`-Image | Pod-Start ohne mehrere hundert MB Image-Pull |
| 14 | MariaDB (2×) | Probes ohne Passwort in der Kommandozeile | Pod-Neustart |
| 15 | Init-Container | `busybox:latest` → `busybox:1.37.0` | reproduzierbar |
| 16 | Dashboard RBAC | ClusterRole/Binding `…-reader` → `…-manager` | neue Rolle, alte per Prune löschen |
| 17 | README | Pfad `infrastructure/` korrigiert | – |

---

## Details

### 1. LibreChat & Ollama: Entry-Point `websecure` → `web`

**Dateien:** `manifests/jarvis/librechat/librechat-ingressroute.yaml`, `manifests/jarvis/ollama/ollama-ingressroute.yaml`

**Warum:** Alle anderen Routen hängen am Entry-Point `web` (Traefik Port 80). Laut README
schickt der Cloudflare Tunnel den Traffic auf Port 80. Live geprüft:

```
--entryPoints.web.address=:8000/tcp
--entryPoints.websecure.address=:8443/tcp
--entryPoints.websecure.http.tls=true
```

Eine Route auf `websecure` greift also nur bei TLS-Traffic auf 443 – über den Tunnel
auf Port 80 waren `chat.` und `ollama.janikhenz.ch` damit nicht erreichbar.

**Zusätzlich gefunden (nicht im Git, nur live):**

| IngressRoute | Entry-Point | Problem |
|---|---|---|
| `jarvis/openwebui-ingressroute` | `web` | Überbleibsel der gelöschten App „openwebui“. Fängt `chat.janikhenz.ch` ab und zeigt auf den nicht mehr existierenden `openwebui-service`. |
| `jarvis/librechat-ingressroute-secure` | `websecure` | Manuell angelegt, `certResolver: letsencrypt`, dupliziert die LibreChat-Route. |

Diese beiden müssen **manuell gelöscht** werden, sonst konkurrieren zwei Routen um denselben
Host (→ siehe Manual Steps).

### 2. Grafana-Admin-Passwort aus Secret

**Dateien:** `manifests/monitoring/grafana-deployment.yaml`, neu: `manifests/monitoring/grafana-secrets.yaml.template`

```yaml
# vorher
- name: GF_SECURITY_ADMIN_PASSWORD
  value: "changeme"
# nachher
- name: GF_SECURITY_ADMIN_PASSWORD
  valueFrom:
    secretKeyRef:
      name: grafana-secrets
      key: admin-password
```

Das Template folgt dem gleichen Muster wie `nextcloud-secrets.yaml.template`
(`.template`-Dateien werden von ArgoCD nicht gesynct).

> ⚠️ Grafana liest diese Variable **nur beim allerersten Start** (wenn die DB angelegt wird).
> Bei deiner bestehenden Installation ändert sich das echte Passwort dadurch **nicht** –
> siehe Manual Steps.

### 3. Plex Zeitzone

`manifests/media-stack/plex/plex.yaml`: `Europe/Berlin` → `Europe/Zurich`, einheitlich mit allen anderen Apps.

### 4. `CreateNamespace=true` aus allen Apps entfernt

**Dateien:** alle 21 Dateien in `apps/` (der komplette `syncPolicy`-Block, da er nur diese Option enthielt).

**Warum:** Doppelt gemoppelt – die Namespaces werden bereits in
`infrastructure/namespaces.yaml` definiert, und dieser Ordner wird ohnehin vor den Apps
benötigt (PVCs liegen dort). Eine einzige Quelle für Namespaces ist übersichtlicher.

Verhalten: Da alle Namespaces existieren, ändert sich nichts. Bei einer **neuen** App mit
**neuem** Namespace muss der Namespace in `infrastructure/namespaces.yaml` ergänzt werden –
sonst schlägt der Sync mit einer klaren Fehlermeldung fehl.

### 5. `infrastrucure/` → `infrastructure/` + ArgoCD-App

- Ordner umbenannt (Tippfehler). Inhalt identisch, ausser den Punkten 6 und 10.
  Umbenennung per `mv` (nicht `git mv`), d. h. der Git-Index wurde nicht angefasst.
- Neu: `apps/infrastructure.yaml` – der Ordner wurde bisher von **keiner** ArgoCD-App
  gesynct, sondern von Hand mit `kubectl apply` angewendet.
- Die App hat **bewusst kein `automated`-Sync**: Änderungen an Storage/Namespaces
  sollen immer im Diff angeschaut und manuell gesynct werden.
- Sync-Wave `-1`, damit sie vor allen anderen Apps kommt.
- Kein `resources-finalizer` → Löschen der App mit `kubectl delete` löscht keine Ressourcen.

Server-Dry-Run gegen den Live-Cluster: alle PVs/PVCs/Namespaces/DaemonSet ohne Fehler
(keine Konflikte mit unveränderlichen Feldern).

### 6. Namespaces

**Datei:** `infrastructure/namespaces.yaml`

- `fitness` entfernt – live leer, von keiner App genutzt. (In der README-TODO steht eine
  geplante Fitness-App – dann einfach wieder hinzufügen.) Der Live-Namespace wird dadurch
  **nicht** gelöscht.
- Jeder Namespace hat jetzt:
  ```yaml
  annotations:
    argocd.argoproj.io/sync-options: Delete=false,Prune=false
  ```
  Schutz: Wird die App „infrastructure“ versehentlich mit Kaskade gelöscht, würden sonst
  alle Namespaces samt **Secrets (die nicht im Git liegen!)** gelöscht.

### 7. Pterodactyl Panel: wirkungslose Init-Befehle

**Datei:** `manifests/gaming/pterodactyl/pterodactyl-panel-deployment.yaml`

Im Init-Container `setup-directories` ist **nur** `/app/storage` gemountet. Entfernt:

```sh
mkdir -p /app/bootstrap/cache
mkdir -p /app/var
mkdir -p /var/log/panel/logs
chmod -R 777 /app/bootstrap/cache
chmod -R 777 /app/var
```

Diese Pfade existierten nur im kurzlebigen Dateisystem des Init-Containers und waren für
den Panel-Container nie sichtbar (dort sind es `emptyDir`-Volumes, die ohnehin `777` sind).
Alles, was `/app/storage` betrifft, bleibt unverändert.

### 8. Pterodactyl Wings

**Datei:** `manifests/gaming/pterodactyl/pterodactyl-wings-deployment.yaml`

- `capabilities.add: [SYS_ADMIN, NET_ADMIN]` entfernt – `privileged: true` gewährt bereits
  **alle** Capabilities. Die Rechte bleiben exakt gleich.
- Zwei Kommentarzeilen zu Game-Server-Ports ohne zugehörigen Code entfernt.

### 9. Jellyseerr

**Datei:** `manifests/media-stack/jellyseerr/jellyseerr-deployment.yaml`

- `JELLYFIN_SERVER` entfernt – keine von Seerr ausgewertete Variable; der Jellyfin-Server
  wird in der Seerr-UI konfiguriert und in `/app/config/settings.json` (PVC) gespeichert.
- Kommentar `# Hier ist dein Wissen von eben!` entfernt.

### 10. Default-Werte entfernt

| Datei | Entfernt | Default von Kubernetes/ArgoCD |
|---|---|---|
| `manifests/dashboard/nginx-dashboard.yaml` | `volumes: []` | keine Volumes |
| `bootstrap/root-app.yaml` | `directory.recurse: false` | `false` |
| `manifests/jarvis/chromadb/chromadb-statefulset.yaml` | `updateStrategy: RollingUpdate` | `RollingUpdate` |
| `infrastructure/daemonset.yaml` | `updateStrategy: RollingUpdate` | `RollingUpdate` |
| `manifests/monitoring/dcgm-exporter.yaml` | `runAsNonRoot: false` | `false` (`runAsUser: 0` bleibt) |

**Bewusst NICHT entfernt:** `targetPort` (= `port`) und `protocol: TCP` in Services.
Grund: In `qbittorrent-torrent-service` und `syncthing-sync` gibt es denselben Port mit
TCP **und** UDP. Bei solchen Services gibt es bekannte Probleme mit dem Strategic-Merge-Patch
von `kubectl apply`, wenn Felder entfernt werden – kein Nutzen, aber Risiko.

### 11. Prometheus RBAC

**Datei:** `manifests/monitoring/prometheus-rbac.yaml`

Regel für `ingresses` (API-Gruppen `extensions`, `networking.k8s.io`) entfernt.
`extensions` ist seit Kubernetes 1.22 für Ingress abgeschafft, und keine Scrape-Config nutzt
`role: ingress`.

### 12. Explizite Namespaces in Deployments

`namespace:` ergänzt in: `nginx-dashboard` (default), `home-assistant`, `jellyfin` (media),
`plex` (media), `nextcloud`, `vaultwarden`.

**Warum das wichtig ist – live gefunden:** Im Namespace `default` existiert ein verirrtes
Deployment `nextcloud` (19 Tage alt, `kubectl.kubernetes.io/last-applied-configuration`
→ wurde von Hand mit `kubectl apply` ohne `-n` angelegt). Es hängt seit 19 Tagen auf
`Pending`, weil die PVC im Namespace `default` nicht existiert. Mit explizitem Namespace
kann das nicht mehr passieren. Löschen → Manual Steps.

### 13. LibreChat: leichtgewichtiger MongoDB-Wartecheck

**Datei:** `manifests/jarvis/librechat/librechat-deployment.yaml`

```sh
# vorher (Image mongo:8.0.20, mehrere hundert MB)
until mongosh --host librechat-mongodb --eval "db.adminCommand('ping')" ...
# nachher (Image busybox:1.37.0, ~2 MB) – wie bei Pterodactyl
until nc -z librechat-mongodb 27017; do
```

MongoDB hat zusätzlich eine eigene readinessProbe (`mongosh ping`). Der Service bekommt
erst Endpoints, wenn MongoDB ready ist – `nc -z` wartet also effektiv auf dasselbe.

Lokal getestet: `busybox:1.37.0` → `nc -z` gibt 0 bei offenem und 1 bei geschlossenem Port.

### 14. MariaDB-Probes ohne Passwort

**Dateien:** `manifests/nextcloud/nextcloud-mariadb.yaml`, `manifests/gaming/pterodactyl/pterodactyl-mariadb-deployment.yaml`

```yaml
# vorher
command: [sh, -c, "mysqladmin ping -h localhost -u root -p$MYSQL_ROOT_PASSWORD"]
# nachher
command: ["mysqladmin", "ping", "-h", "localhost"]
```

Das Root-Passwort stand bisher alle 5–10 s in der Prozessliste.
Lokal mit `mariadb:10.11` (gleiches Image) getestet:

| Situation | Exit-Code |
|---|---|
| Server läuft, ohne Passwort | `0` („mysqld is alive“) |
| Server läuft, falscher User („Access denied“) | `0` |
| Server läuft nicht | `1` |

`mysqladmin ping` liefert per Definition 0, sobald der Server antwortet – genau das, was die
Probe prüfen soll.

### 15. `busybox:latest` → `busybox:1.37.0`

In allen Init-Containern (Grafana, Prometheus, qBittorrent, Pterodactyl ×2, LibreChat ×2).
Stateless, daher kein Downgrade-Risiko.

Die übrigen `:latest`-Images wurden **nicht** gepinnt (→ Manual Steps): Der Homeserver ist
aktuell `NotReady`, die laufenden Versionen konnten nicht sicher bestimmt werden, und ein
Pin auf eine ältere Version als die laufende kann bei Apps mit Datenbank-Migrationen
(Home Assistant, *arr, Jellyfin, Grafana …) Daten unbrauchbar machen.

### 16. Dashboard-ClusterRole umbenannt

**Datei:** `manifests/dashboard/nginx-dashboard-rbac.yaml`

`dashboard-deployments-reader` → `dashboard-deployments-manager` (ClusterRole + ClusterRoleBinding).
Die Rolle darf `patch`/`update` auf Deployments/StatefulSets – das Dashboard nutzt das
offensichtlich (mehrere Apps sind live auf 0 Replicas skaliert). „reader“ war irreführend.
Rechte unverändert. Der ServiceAccount `dashboard-reader` wurde **nicht** umbenannt
(wäre ein Eingriff ins Deployment ohne Nutzen).

### 17. README

Pfad in der Verzeichnisstruktur auf `infrastructure/` korrigiert.

---

## Bewusst nicht umgesetzt

| Vorschlag | Grund |
|---|---|
| ApplicationSet | Auf deinen Wunsch offen gelassen – Erklärung in den Manual Steps |
| NodePort → ClusterIP | Dein Dashboard nutzt `http://<PC_IP>:30090` (Prometheus-NodePort) als Fallback; möglicherweise nutzen Tunnel/LAN-Geräte weitere NodePorts. Ohne Kenntnis der cloudflared-Config zu riskant. |
| qBittorrent-Torrent-Port | Hängt von deiner Router-Portweiterleitung ab – Optionen in den Manual Steps |
| `:latest`-Pins | siehe Punkt 15 |
| `targetPort`/`protocol` | siehe Punkt 10 |

## Validierung

- Alle YAML-Dateien parsen fehlerfrei (`python yaml.safe_load_all`).
- `kubectl apply --dry-run=server -R -f manifests -f infrastructure -f apps -f bootstrap`:
  alle 170 Objekte vom API-Server akzeptiert, **0 Fehler** (nichts gespeichert).
- Ursprüngliche CRLF-Zeilenenden in `jellyfin.yaml` und `plex.yaml` beibehalten,
  damit der Diff nur die echten Änderungen zeigt.
