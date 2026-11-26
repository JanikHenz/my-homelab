# Manuelle Schritte nach dem Cleanup – 26.11.2026

Begleitdokument zu [`CHANGELOG-cleanup-2026-11-26.md`](CHANGELOG-cleanup-2026-11-26.md).
Die Schritte sind **in der Reihenfolge** sortiert, in der du sie ausführen solltest.

Legende: 🔴 Pflicht vor dem Push · 🟠 Pflicht nach dem Push · 🟢 optional / Entscheidung

---

## 0. 🔴 Homeserver ist `NotReady`

Beim Prüfen am 26.11.2026 meldete der Node `homeserver` seit **01:55 Uhr** keinen Status mehr:

```
homeserver    NotReady   <none>          265d   v1.34.4+k3s1
Ready  Unknown  NodeStatusUnknown  Kubelet stopped posting node status.
```

Folge: Fast alle Pods gibt es doppelt – einer „Running“ (veraltet, auf dem toten Node), einer
`Pending`. **Bring den Homeserver zuerst wieder hoch**, bevor du irgendetwas syncst. Sonst
kannst du nicht beurteilen, ob ein Sync etwas kaputt gemacht hat.

```bash
kubectl get nodes          # beide Ready?
kubectl get pods -A | grep -v Running   # nur noch Completed/nichts?
```

---

### 0b. Raspberry Pi bootete unter Last neu (gelöst 26.11.2026, 08:25)

Während der Syncs ist der Pi (Control Plane + ArgoCD) dreimal komplett neu gebootet
(07:56, 08:06, 08:12). RAM/CPU/Temperatur/SD-Karte waren laut Prometheus unauffällig.
**Ursache:** Der Pi 4 hing an einem **1-A-Handyladegerät** (benötigt bis 3 A). Bei Lastspitzen
(ArgoCD-Sync) brach die Spannung ein → Hardware-Reset ohne Log. `vcgencmd get_throttled`
zeigte danach `0x0`, weil die Flags bei jedem Boot gelöscht werden.
**Fix:** Netzteil gegen eines mit 3 A getauscht.

Empfehlung zur Absicherung (auf dem Pi):

```bash
sudo mkdir -p /var/log/journal && sudo systemctl restart systemd-journald   # Logs überleben Reboots
vcgencmd get_throttled   # ab und zu prüfen, muss 0x0 bleiben
```

---

## 1. 🔴 Änderungen prüfen und committen

Der Ordner `infrastrucure/` wurde mit `mv` (nicht `git mv`) umbenannt. Damit Git die
Umbenennung erkennt, alles inkl. gelöschter Dateien stagen:

```bash
git status
git diff                    # Review
git add -A
git status                  # infrastrucure/* sollte jetzt als "renamed" erscheinen
git commit -m "chore: cleanup manifests and fix ingress entrypoints"
```

**Noch nicht pushen** – erst Schritt 2 und 3.

---

## 2. 🔴 Grafana-Secret anlegen (vor dem Push / Sync von `monitoring`)

Grafana referenziert jetzt `grafana-secrets`. Existiert es nicht, startet der Pod nach dem
Sync **nicht** (`CreateContainerConfigError`).

```bash
kubectl create secret generic grafana-secrets -n monitoring \
  --from-literal=admin-password="$(openssl rand -base64 24)" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n monitoring get secret grafana-secrets   # Kontrolle
```

**Wichtig:** Grafana nutzt diese Variable nur beim allerersten Start. Dein aktuelles
Login-Passwort ändert sich dadurch **nicht**. Falls es noch `changeme` ist, ändere es
(nachdem der Homeserver wieder läuft):

```bash
PW=$(kubectl -n monitoring get secret grafana-secrets -o jsonpath='{.data.admin-password}' | base64 -d)
kubectl -n monitoring exec deploy/grafana -- grafana cli admin reset-admin-password "$PW"
```

oder in der UI unter *Profile → Change password*. Passwort im Passwort-Manager ablegen.

---

## 3. 🔴 Verwaiste Ressourcen löschen (vor dem Sync von `librechat` / `ollama`)

### 3a. Alte IngressRoutes für `chat.janikhenz.ch`

Diese existieren nur im Cluster (nicht im Git) und kollidieren mit der korrigierten
LibreChat-Route:

```bash
# Erst ansehen:
kubectl -n jarvis get ingressroute openwebui-ingressroute librechat-ingressroute-secure -o yaml

# Dann löschen:
kubectl -n jarvis delete ingressroute openwebui-ingressroute
kubectl -n jarvis delete ingressroute librechat-ingressroute-secure
```

- `openwebui-ingressroute` – Überbleibsel der gelöschten App „openwebui“, zeigt auf einen
  Service, den es nicht mehr gibt, und fängt aktuell `chat.janikhenz.ch` auf Port 80 ab.
- `librechat-ingressroute-secure` – manuell angelegtes Duplikat mit `certResolver: letsencrypt`.

### 3b. Verirrtes Nextcloud-Deployment im Namespace `default`

Wurde vor 19 Tagen per `kubectl apply` ohne Namespace angelegt, hängt seitdem auf `Pending`
(die PVC gibt es in `default` nicht). Das echte Nextcloud liegt in `nextcloud`.

```bash
# Kontrolle: nur Deployment + ReplicaSet + 1 Pending-Pod, kein Service/PVC
kubectl -n default get all | grep nextcloud

kubectl -n default delete deployment nextcloud
```

⚠️ Unbedingt `-n default` angeben – **nicht** das Deployment im Namespace `nextcloud` löschen!

---

## 4. 🔴 Cloudflare-Tunnel-Konfiguration prüfen

Für `chat.janikhenz.ch` und `ollama.janikhenz.ch` muss der Tunnel – wie bei allen anderen
Hosts – auf **Traefik Port 80** zeigen (`http://…:80`), nicht auf 443/https.

Zusätzlich: **Ollama hat keine eigene Authentifizierung.** Wenn `ollama.janikhenz.ch`
öffentlich erreichbar ist, kann jeder deine GPU nutzen. Stelle sicher, dass in Cloudflare
Zero Trust eine **Access-Policy** davor liegt (oder entferne den öffentlichen Hostnamen,
falls nur LibreChat intern auf Ollama zugreift – das läuft über `ollama-service` im Cluster
und braucht keine IngressRoute).

---

## 5. 🟠 Pushen und Apps syncen

```bash
git push
```

Was dann automatisch passiert:
- `root-app` (automated) aktualisiert die Application-Objekte (entfernte `syncPolicy`)
  und legt die neue App **`infrastructure`** an (erscheint als eigene Kachel, OutOfSync).
- Die einzelnen Apps haben **kein** automated Sync → sie werden OutOfSync und warten auf dich.

### ⚠️ Achtung bei auf 0 skalierten Apps

Diese Deployments sind live auf **0 Replicas** (vermutlich über dein Dashboard), im Git steht `replicas: 1`:

| App | Deployments mit 0 Replicas |
|---|---|
| home-assistant | home-assistant |
| librechat | librechat, librechat-meilisearch, librechat-mongodb |
| ollama | ollama |
| piper | piper |
| whisper | whisper |
| nextcloud | nextcloud |
| pwd-manager | vaultwarden |

Ein **voller Sync** dieser Apps setzt sie wieder auf 1 Replica (das war schon vorher so,
deshalb stehen sie bereits auf OutOfSync). Wenn sie aus bleiben sollen:
im Sync-Dialog nur die gewünschten Ressourcen anhaken (z. B. nur die IngressRoute),
oder danach wieder über das Dashboard herunterskalieren.

### Empfohlene Sync-Reihenfolge und erwartete Diffs

| App | Erwarteter Diff | Hinweis |
|---|---|---|
| `infrastructure` | Annotation `Delete=false,Prune=false` an den Namespaces; DaemonSet ohne `updateStrategy` (no-op) | **Zuerst „App Diff“ ansehen.** Sync **ohne** „Prune“. Beim ersten Mal stehen **alle ~60 Objekte** auf OutOfSync, weil ArgoCD sie noch nie verwaltet hat (fehlende Tracking-Annotation) – das ist erwartet. Im Diff dürfen bei PVs/PVCs aber **keine `spec`-Änderungen** auftauchen (geprüft per `kubectl diff -R -f infrastructure` am 26.11.: einzige echte Änderung sind die 8 Namespace-Annotationen). |
| `monitoring` | Grafana-Env (Secret), busybox-Tag, RBAC, dcgm | Schritt 2 muss erledigt sein |
| `dashboard` | neue ClusterRole/Binding `…-manager`, Namespace | Sync **mit Prune**, damit `dashboard-deployments-reader` gelöscht wird. Danach Scale/Restart im Dashboard testen. |
| `librechat` | IngressRoute `web`, Init-Container | Schritt 3a erledigt? |
| `ollama` | IngressRoute `web` | Schritt 4 erledigt? |
| `plex` | TZ, Namespace | Pod-Neustart |
| `jellyfin`, `home-assistant`, `nextcloud`, `pwd-manager` | nur `namespace:` explizit | sollte nach Sync „Synced“ ohne Pod-Neustart sein (bis auf Replica-Thema oben) |
| `jellyseerr` | Env entfernt | danach prüfen: *Settings → Jellyfin* noch verbunden? |
| `pterodactyl` | Init-Script, Wings securityContext, MariaDB-Probes | danach Panel-Login + Konsole eines Servers testen |
| `nextcloud` | MariaDB-Probes | `kubectl -n nextcloud get pods` → mariadb `1/1 Ready` |
| `qbittorrent`, `chromadb` | busybox-Tag / no-op | |

### Kontrollen nach dem Sync

```bash
kubectl get pods -A | grep -v -E "Running|Completed"
kubectl -n monitoring get pods
kubectl -n gaming get pods
kubectl -n nextcloud describe pod -l app=nextcloud-mariadb | grep -A3 -E "Liveness|Readiness"
curl -sI https://chat.janikhenz.ch | head -1      # sobald LibreChat läuft
```

---

## 6. 🟢 Root-App neu anwenden (optional)

`bootstrap/root-app.yaml` wird nicht von ArgoCD gesynct. Die Änderung (Default
`recurse: false` entfernt) hat keine Wirkung – nur der Vollständigkeit halber:

```bash
kubectl apply -f bootstrap/root-app.yaml
```

---

## 7. 🟢 Namespace `fitness`

Aus `infrastructure/namespaces.yaml` entfernt, existiert aber noch im Cluster (leer).
- Fitness-App ist noch geplant (README-TODO) → einfach stehen lassen bzw. wieder in die
  YAML aufnehmen, sobald du sie baust.
- Sonst: `kubectl get all -n fitness` (leer?) → `kubectl delete namespace fitness`

---

## 8. 🟢 qBittorrent: Torrent-Port prüfen

qBittorrent lauscht auf **6881** und teilt Peers diesen Port mit; von aussen erreichbar ist
er aber über NodePort **30008**. Eingehende Verbindungen funktionieren nur, wenn eines gilt:

- **A)** Der Router leitet extern **6881 → 192.168.1.9:30008** weiter → passt, nichts tun.
- **B)** Der Router leitet **30008 → 30008** weiter → in qBittorrent *Tools → Options →
  Connection → Listening Port* auf **30008** stellen, und in
  `qbittorrent-deployment.yaml` + `qbittorrent-torrent-service.yaml` Port/TargetPort
  6881 → 30008 ändern.
- **C)** Gar keine Weiterleitung → nur ausgehende Verbindungen (funktioniert, aber
  weniger Peers).

Prüfen: qBittorrent-Statusleiste unten – grünes Symbol = eingehend erreichbar.

---

## 9. 🟢 `:latest`-Images pinnen

Nicht automatisch umgesetzt (Downgrade-Risiko, Homeserver war offline). Aktuell laufende
Digests (Stand 26.11.2026, aus `kubectl get pods`):

| App | Image | Digest (gekürzt) |
|---|---|---|
| chromadb | `chromadb/chroma:latest` | `sha256:1e0b73a1…` |
| flaresolverr | `ghcr.io/flaresolverr/flaresolverr:latest` | `sha256:c80ae007…` |
| jellyfin | `jellyfin/jellyfin:latest` | `sha256:fea863d0…` |
| jellyseerr | `ghcr.io/seerr-team/seerr:latest` | `sha256:aadee014…` |
| plex | `plexinc/pms-docker:latest` | `sha256:6d778d41…` |
| prowlarr | `linuxserver/prowlarr:latest` | `sha256:2806c9b7…` |
| qbittorrent | `linuxserver/qbittorrent:latest` | `sha256:1fa2f969…` |
| radarr | `linuxserver/radarr:latest` | `sha256:044788f5…` |
| sonarr | `linuxserver/sonarr:latest` | `sha256:339814bb…` |
| grafana | `grafana/grafana:latest` | `sha256:81556409…` |
| prometheus | `prom/prometheus:latest` | `sha256:e0498764…` |
| node-exporter | `prom/node-exporter:latest` | `sha256:7296504d…` (amd64) / `1b4e4438…` (arm64) |
| syncthing | `syncthing/syncthing:latest` | `sha256:2b71da7c…` |
| dashboard | `ghcr.io/janikhenz/dashboard2:latest` | eigenes Image – `latest` + `Always` ist hier ok |

Nicht ermittelbar, weil auf 0 skaliert: home-assistant, ollama, librechat, piper, whisper, vaultwarden.

**Vorgehen pro App** (wenn der Homeserver läuft):
1. Laufende Version herausfinden, z. B. in der App-UI (*About/System*) oder
   `kubectl -n media exec deploy/sonarr -- cat /app/sonarr/package_info` bzw. Image-Labels.
2. Genau diese Version als Tag eintragen (z. B. `linuxserver/sonarr:4.0.x`), **nie älter**.
3. Updates danach bewusst per Tag-Erhöhung (optional automatisiert mit Renovate).

---

## 10. 🟢 NodePort → ClusterIP

Nicht umgesetzt. Bekannte Nutzer von NodePorts:
- Dashboard: `http://192.168.1.9:30090` (Prometheus) als Fallback.
- Pterodactyl Wings: spricht das Panel über `http://192.168.1.9:30020` an (Wings-`config.yml`,
  `remote`). Beim Sync am 26.11. sichtbar: Wings startete vor dem Panel → 2× „connection refused“
  → Neustart, danach ok. **NodePort 30020 muss bleiben** (oder `remote` in der Wings-Config
  auf die Panel-Domain umstellen).
- Torrent (30008) und Syncthing-Sync (30200/30227) **müssen** NodePort bleiben.

Wenn du die cloudflared-Config prüfst (Schritt 4) und alle Hosts auf Traefik zeigen, kannst
du alle übrigen Services (ausser den oben genannten) auf `type: ClusterIP` umstellen und die
Zeile `nodePort:` entfernen. Dann sind die Apps im LAN nicht mehr direkt ohne Traefik/Cloudflare
erreichbar – das ist der Sicherheitsgewinn. Danach README-Port-Tabelle anpassen.

---

## 11. 🟢 ApplicationSet – Antwort auf deine Frage

**Ja, die Darstellung in ArgoCD bleibt gleich.** Ein ApplicationSet ist nur ein Generator:
Es erzeugt ganz normale `Application`-Objekte. Jede App bleibt eine eigene Kachel mit
Name, Status, Pfad, Namespace, Sync-Button usw. – exakt wie auf deinem Screenshot.

Unterschiede:
- Im Baum der `root-app` siehst du statt 21 Applications **ein** ApplicationSet-Objekt.
- Die Felder der Kacheln (Name, Pfad, Namespace, Sync-Wave, `ignoreDifferences`) werden
  aus einer Liste in einer Datei generiert.
- Einzelne Apps im UI zu bearbeiten (z. B. Sync-Policy ändern) wird vom ApplicationSet
  wieder überschrieben – Änderungen nur noch im Git.

Warum ich es noch nicht umgesetzt habe – die **Migration** ist der heikle Teil:
- Die bestehenden Applications müssen vom ApplicationSet übernommen werden. Wenn die
  `apps/*.yaml` gelöscht werden, bevor das ApplicationSet die Apps übernommen hat, prunt die
  `root-app` die Applications. (Ohne `resources-finalizer` werden dabei keine Workloads
  gelöscht, aber die Apps verschwinden kurz.)
- Sauberes Vorgehen wäre: ApplicationSet mit `preserveResourcesOnDeletion: true` hinzufügen,
  prüfen, dass es alle 21 Apps übernommen hat, erst dann die alten Dateien löschen.

Gewinn: ca. 400 Zeilen → ca. 80 Zeilen, neue App = 4 Zeilen statt eine neue Datei.
Wenn du es willst, bereite ich es als separaten Schritt vor – mit genau diesem Ablauf.

---

## 12. 🟢 README-Kleinigkeiten (nicht angepasst)

Beim Durchsehen aufgefallen, aber nicht Teil dieses Cleanups:
- Abschnitt *Sync-Policy*: „Alle ArgoCD Applications haben `automated.prune`“ stimmt nicht –
  nur die `root-app` hat automated Sync.
- Pterodactyl-Tabelle nennt `panel:v1.11.7`, im Manifest steht `v1.12.4`.
- `syncthing-storage.yaml` und `apps/syncthing.yaml` fehlen in der Verzeichnisstruktur,
  ebenso die neue `apps/infrastructure.yaml`.
