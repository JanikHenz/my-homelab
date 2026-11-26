# Best-Practice-Umbau – 26.11.2026

Dritter Durchgang nach [`CHANGELOG-cleanup-…`](CHANGELOG-cleanup-2026-11-26.md) und
[`CHANGELOG-refactor-…`](CHANGELOG-refactor-2026-11-26.md).
**Nichts committet oder gepusht.** Am Cluster habe ich nur gelesen – einzige Ausnahme
(auf deine Anweisung, schon vorher): Auto-Sync der `root-app` ausgeschaltet.

Manuelle Schritte: [`MANUAL-STEPS-bestpractice-2026-11-26.md`](MANUAL-STEPS-bestpractice-2026-11-26.md).

## Übersicht

| # | Umgesetzt | Datei(en) |
|---|---|---|
| 1 | AppProjects `infrastructure`, `platform`, `apps` | neu `apps/projects.yaml`, `apps/applicationset.yaml`, `apps/infrastructure.yaml` |
| 2 | Auto-Sync (prune + selfHeal) für alle 21 Apps | `apps/applicationset.yaml` |
| 3 | 11 Services NodePort → ClusterIP, Kommentare bei den übrigen | 19 Dateien in `manifests/` |
| 4 | ArgoCD verwaltet sich selbst | neu `apps/argocd.yaml`, gelöscht `docs/argocd-helm-values-snippet.yaml` |
| 5 | README: Sync-Policy, AppProjects, Ports, Struktur | `README.md` |
| – | **Nicht umgesetzt:** dynamischer Storage | siehe unten |

---

## Vorab geprüfte Fakten (alle nur lesend)

| Frage | Ergebnis | Folge |
|---|---|---|
| Wohin zeigt der Cloudflare-Tunnel? | `janikhenz.ch` + `*.janikhenz.ch → http://192.168.1.10:80` (Traefik), gelesen über die lokale cloudflared-Config-Schnittstelle | Der Tunnel nutzt **keinen** NodePort |
| Wie skaliert/startet das Dashboard Apps? | nur `POST /api/k8s/scale` (replicas), kein Restart-Patch | kein Konflikt mit selfHeal, da `replicas` ignoriert wird |
| Woher holt das Dashboard Prometheus? | primär `prometheus-service.monitoring.svc.cluster.local:9090`, NodePort 30090 nur Fallback | NodePort 30090 entbehrlich |
| Home Assistant → KI-Dienste | Ollama `http://192.168.1.9:30013`, Wyoming `:30014` (Whisper), `:30015` (Piper) | diese NodePorts bleiben |
| Radarr → qBittorrent | `192.168.1.9:30007` (Sonarr nutzt intern `qbittorrent-service:8080`) | 30007 bleibt vorerst |
| Wings → Panel | `http://192.168.1.9:30020` | bleibt |
| Sonarr/Radarr/Prowlarr/Jellyseerr untereinander | alle über interne Service-Namen | – |
| ArgoCD-Installation | Helm-Chart `argo-cd 9.4.7` (App v3.3.2), Werte: `global.nodeSelector`, NodePort 30800/30443; zusätzlich per `kubectl patch`: `url`, `server.insecure` | Werte für Selbstverwaltung = Helm-Werte + Patches |
| Ressourcen pro App | nur `dashboard` und `monitoring` legen clusterweite Objekte an (ClusterRole/Binding) | Projekt-Zuschnitt |

## 1. AppProjects

| Projekt | Apps | clusterweit erlaubt | Ziel-Namespaces |
|---|---|---|---|
| `infrastructure` | infrastructure | Namespace, PersistentVolume, RuntimeClass | alle |
| `platform` | argocd, argocd-ingress, dashboard, monitoring | ClusterRole, ClusterRoleBinding, CRD | argocd, monitoring, default |
| `apps` | alle übrigen 17 | **nichts** | media, jarvis, home-assistant, nextcloud, vaultwarden, gaming, syncthing |

- Erlaubte Quellen: nur dein Repo (bei `platform` zusätzlich das argo-helm-Repo).
- Sync-Wave `-1`: Die Projekte entstehen im selben root-app-Sync vor den Apps.
- Vorher geprüft: Jede App liegt mit allen Ressourcen innerhalb ihrer Projektregeln.
- `root-app` bleibt im Projekt `default` (muss AppProjects/Applications anlegen).

## 2. Auto-Sync für Apps

In der ApplicationSet-Vorlage: `automated: { prune: true, selfHeal: true }`.
- **Push = Deployment.** Manuelle Änderungen im Cluster werden zurückgesetzt (selfHeal).
- **prune:** Wird eine Datei aus Git gelöscht, löscht ArgoCD das Objekt. Daten sind sicher:
  PVCs/PVs gehören zu `infrastructure` (manuell, ohne Prune), Namespaces sind geschützt.
- `replicas` bleibt ignoriert → Dashboard-Skalierung wird **nicht** zurückgesetzt.
- `infrastructure` und `argocd` bleiben bewusst manuell.

## 3. NodePort → ClusterIP

**Umgestellt (11):** nginx-dashboard (30080), jellyseerr (30003), radarr (30004),
sonarr (30005), prowlarr (30006), vaultwarden (30011), nextcloud (30012), librechat (30016),
syncthing-GUI (30021), prometheus (30090), grafana (30091). Zusätzlich argocd-server
(30800/30443) über `apps/argocd.yaml`.

Umsetzung: `type: NodePort` und `nodePort:` entfernt (ClusterIP ist Standard). Jede
Änderung automatisch gegen das Original geprüft. `kubectl diff`: Die Cluster-IP bleibt
gleich, es entfällt nur der Port auf den Nodes.

**Bleiben NodePort (mit Begründung als Kommentar im Service):**

| Service | Port | Wer braucht ihn |
|---|---|---|
| jellyfin | 30001 | TV-Apps im LAN |
| plex | 30002 | TV-Apps im LAN |
| home-assistant | 30009 | Companion-App im LAN |
| ollama / whisper / piper | 30013 / 30014 / 30015 | Home-Assistant-Integrationen |
| pterodactyl-panel | 30020 | Wings (hostNetwork) |
| qbittorrent (WebUI) | 30007 | Radarr – **TODO**, siehe Manual Steps |
| qbittorrent-torrent | 30008 | Torrent-Peers |
| syncthing-sync | 30200 / 30227 | Geräte-Sync |

## 4. ArgoCD verwaltet sich selbst

`apps/argocd.yaml`: Application `argocd` (Projekt `platform`), Quelle Helm-Chart
`argo-cd` **9.4.7** (= installierte Version), `releaseName: argocd`.

Werte = bisherige Helm-Werte + die beiden manuellen Patches:

```yaml
global:
  domain: argocd.janikhenz.ch        # ergibt url: https://argocd.janikhenz.ch (war per Patch gesetzt)
  nodeSelector: { kubernetes.io/hostname: raspberrypi }
configs:
  params:
    server.insecure: true            # war per Patch gesetzt
server:
  service:
    type: ClusterIP                  # einzige gewollte Änderung (vorher NodePort 30800/30443)
```

- **Kein Auto-Sync.** Beim Push passiert an ArgoCD nichts – du prüfst zuerst den Diff.
- `ServerSideApply=true`: ArgoCDs CRDs sind für client-seitiges Apply zu gross.
- Der Wert `server.insecure` auf oberster Ebene aus den alten Helm-Werten entfällt (im Chart
  9.x wirkungslos; die wirksame Einstellung ist `configs.params`).
- `docs/argocd-helm-values-snippet.yaml` gelöscht: Es empfahl `helm upgrade` – ab jetzt
  laufen Upgrades über `targetRevision` in Git. Die Notfall-Werte stehen in den Manual Steps.

## Nicht umgesetzt: dynamischer Storage

`local-path` (k3s) legt Volumes unter `/var/lib/rancher/k3s/storage/pvc-<id>` auf der
Systemplatte an. Auf dem Homeserver sind dort nur noch ~22 % frei, die Ordnernamen sind
zufällig (schlecht fürs Backup), und bestehende Daten müssten migriert werden.
Die festen hostPath-Volumes unter `/mnt/data` mit `Retain` sind fürs Homelab die bessere Wahl.

## Validierung

- Alle YAML-Dateien gültig.
- `kubectl apply --dry-run=server` für `apps/` (AppProjects, ApplicationSet, Applications)
  und `manifests/`: keine Fehler.
- `kubectl diff`: Bei den Services ändern sich nur `type` und `nodePort`.
