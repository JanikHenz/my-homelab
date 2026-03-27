# My Homelab

Eine selbst gehostete Kubernetes-Infrastruktur auf einem **2-Node-Cluster** (Raspberry Pi als Control Plane + Homeserver als Worker Node) mit GitOps-Deployment via ArgoCD, Cloudflare Zero Trust + **Traefik Ingress** für externen Zugriff, NVIDIA GPU-Unterstützung sowie drei Applikations-Stacks: **Media**, **Fitness** und **Dashboard**.

---

## Inhaltsverzeichnis

- [Screenshots](#screenshots)
- [Netzwerk-Topologie](#netzwerk-topologie)
- [Hardware & Cluster](#hardware--cluster)
- [GitOps-Architektur](#gitops-architektur)
- [Namespaces & Stacks](#namespaces--stacks)
- [Media Stack](#media-stack)
- [Fitness Stack (wger)](#fitness-stack-wger)
- [Dashboard](#dashboard)
- [Storage-Übersicht](#storage-übersicht)
- [NVIDIA GPU](#nvidia-gpu)
- [Port-Übersicht](#port-übersicht)
- [Verzeichnisstruktur](#verzeichnisstruktur)

---

## Screenshots

### ArgoCD — GitOps Dashboard

| ArgoCD Übersicht                                   | Repository Sync                            |
| -------------------------------------------------- | ------------------------------------------ |
| ![ArgoCD Dashboard](docs/img/argocd_dashboard.png) | ![ArgoCD Repos](docs/img/argocd_repos.png) |

### Kubernetes Cluster

| Pods                                             | Deployments                                                   |
| ------------------------------------------------ | ------------------------------------------------------------- |
| ![Kubernetes Pods](docs/img/kubernetes_pods.png) | ![Kubernetes Deployments](docs/img/kubernetes_deployment.png) |

| Services                                            | Persistent Volumes                |
| --------------------------------------------------- | --------------------------------- |
| ![Kubernetes Services](docs/img/kubernetes_svc.png) | ![PV](docs/img/kubernetes_pv.png) |

| PersistentVolumeClaims               |
| ------------------------------------ |
| ![PVCs](docs/img/kubernetes_pvc.png) |

### Cloudflare Zero Trust

| Access Dashboard                                     |
| ---------------------------------------------------- |
| ![Cloudflare Access](docs/img/cloudflare_access.png) |

### Apps

| Dashboard                                 | Jellyfin Media                           | Plex Media                       |
| ----------------------------------------- | ---------------------------------------- | -------------------------------- |
| ![Dashboard](docs/img/dashboard_apps.png) | ![Jellyfin](docs/img/jellyfin_media.png) | ![Plex](docs/img/pelx_media.png) |

---

## Netzwerk-Topologie

Beide Nodes sind direkt am Router im Heimnetz angeschlossen. Der **Raspberry Pi** fungiert als Kubernetes Control Plane und hostet ArgoCD sowie den `cloudflared`-Tunnel für externen Zugriff via **Cloudflare Zero Trust**. Traffic von außen geht durch den Cloudflare Tunnel auf **Traefik** (Port 80), der dann anhand des Host-Headers per `IngressRoute` an den jeweiligen ClusterIP-Service weiterleitet. Der **Homeserver** ist der einzige Worker Node und führt alle Workloads aus.

```mermaid
graph TD
    INET(["Internet"])
    CF["Cloudflare\nZero Trust"]

    subgraph HOME["Heimnetz"]
        ROUTER["Router"]

        subgraph RASPY["Raspberry Pi\n(Control Plane)"]
            K8S_CP["Kubernetes\nControl Plane\n(kube-apiserver, etcd, ...)"]
            ARGO["ArgoCD"]
            CFD["cloudflared\n(Tunnel)"]
            TRAEFIK["Traefik\n(Ingress Controller)\nPort 80"]
        end

        subgraph SERVER["Homeserver\n(Worker Node)"]
            K8S_W["Kubernetes\nWorker (kubelet)"]
            GPU["NVIDIA GPU"]
            DISK["/mnt/data/"]

            subgraph NS_MEDIA["namespace: media"]
                MEDIA_APPS["Jellyfin · Plex · Jellyseerr\nRadarr · Sonarr · Prowlarr\nqBittorrent · FlareSolverr"]
            end
            subgraph NS_FITNESS["namespace: fitness"]
                FITNESS_APPS["wger (nginx · web · db · cache · celery)"]
            end
        end
    end

    GH["GitHub\nJanikHenz/my-homelab"]

    INET <-->|"Cloudflare Tunnel"| CF
    CF <-->|"outbound tunnel"| CFD
    CFD -->|"HTTP Port 80"| TRAEFIK
    TRAEFIK -->|"IngressRoute → ClusterIP"| NS_MEDIA
    TRAEFIK -->|"IngressRoute → ClusterIP"| NS_FITNESS
    CFD --- ARGO
    ROUTER --- RASPY
    ROUTER --- SERVER
    K8S_CP <-->|"Cluster API"| K8S_W
    ARGO -->|"sync manifests"| NS_MEDIA
    ARGO -->|"sync manifests"| NS_FITNESS
    GH -->|"pull"| ARGO
    GPU --> NS_MEDIA
    DISK --> NS_MEDIA
    DISK --> NS_FITNESS
```

---

## Hardware & Cluster

### Raspberry Pi – Control Plane

| Eigenschaft | Wert                            |
| ----------- | ------------------------------- |
| Rolle       | Kubernetes Control Plane        |
| Software    | Kubernetes, ArgoCD, cloudflared |

### Homeserver – Worker Node

| Eigenschaft | Wert                   |
| ----------- | ---------------------- |
| Hostname    | `homeserver`           |
| Rolle       | Kubernetes Worker Node |

```mermaid
graph LR
    subgraph RASPY["Raspberry Pi (Control Plane)"]
        CP["kube-apiserver\netcd\ncontroller-manager\nscheduler"]
        ARGO["ArgoCD"]
        CFD["cloudflared\n(Tunnel)"]
        TRAEFIK["Traefik\n(Ingress Controller)\nPort 80"]
    end

    subgraph SERVER["Homeserver (Worker Node)"]
        KW["kubelet"]
        GPU["NVIDIA GPU\n(Time-Slicing 2×)"]
        DISK["/mnt/data/"]

        subgraph SYS["kube-system"]
            NDP["nvidia-device-plugin"]
        end
        subgraph MEDIA_NS["namespace: media"]
            MEDIA["Media Stack\n(ClusterIP Services)"]
        end
        subgraph FITNESS_NS["namespace: fitness"]
            FITNESS["Fitness Stack\n(ClusterIP Services)"]
        end
        subgraph DEFAULT_NS["namespace: default"]
            DASH["Dashboard\n(ClusterIP Service)"]
        end
    end

    CFD -->|"HTTP Port 80"| TRAEFIK
    CP <-->|"Cluster API"| KW
    ARGO -->|"deploy"| MEDIA_NS
    ARGO -->|"deploy"| FITNESS_NS
    ARGO -->|"deploy"| DEFAULT_NS
    TRAEFIK -->|"IngressRoute"| MEDIA_NS
    TRAEFIK -->|"IngressRoute"| FITNESS_NS
    TRAEFIK -->|"IngressRoute"| DEFAULT_NS
    GPU --> NDP
    NDP --> MEDIA
    DISK --> MEDIA
    DISK --> FITNESS
```

---

## GitOps-Architektur

Das Deployment folgt dem **App of Apps**-Pattern. ArgoCD überwacht das GitHub-Repository und synchronisiert automatisch alle Änderungen in den Cluster.

```mermaid
flowchart LR
    DEV["Developer\nPush to GitHub"]
    GH["GitHub\nJanikHenz/my-homelab"]
    ROOT["root-app\nbootstrap/root-app.yaml\nwatches: apps/"]
    APPS["apps/\n*.yaml (ArgoCD Applications)"]

    subgraph MANIFESTS["manifests/"]
        MS["media-stack/\nDeployment + ClusterIP\n+ IngressRoute pro App"]
        FS["fitness/wger/\nDeployment + ClusterIP\n+ IngressRoute"]
        DS["dashboard/\nDeployment + ClusterIP\n+ IngressRoute"]
    end

    subgraph CLUSTER["homelab Cluster"]
        NS_MEDIA["namespace: media"]
        NS_FITNESS["namespace: fitness"]
        NS_DEFAULT["namespace: default"]
        TRAEFIK["Traefik\nIngressRoute\n(liest alle Namespaces)"]
    end

    DEV -->|git push| GH
    GH -->|sync| ROOT
    ROOT -->|creates| APPS
    APPS -->|points to| MANIFESTS
    MS -->|deploys to| NS_MEDIA
    FS -->|deploys to| NS_FITNESS
    DS -->|deploys to| NS_DEFAULT
    NS_MEDIA -->|IngressRoute| TRAEFIK
    NS_FITNESS -->|IngressRoute| TRAEFIK
    NS_DEFAULT -->|IngressRoute| TRAEFIK
```

### Sync-Policy

Alle ArgoCD Applications haben:

- **`automated.prune: true`** – verwaiste Ressourcen werden gelöscht
- **`automated.selfHeal: true`** – manuelle Änderungen am Cluster werden revertiert (nur root-app)

---

## Media Stack

Der Media Stack automatisiert das gesamte Medien-Management: von der Suche über den Download bis zur Wiedergabe.

### Datenfluss

```mermaid
flowchart TD
    USER["User / Browser"]
    TRAEFIK["Traefik\nIngressRoute\n(via Cloudflare Tunnel)"]

    subgraph FRONTEND["Frontend (Zugriff)"]
        JS["Jellyseerr\njellyseerr.janikhenz.ch\nRequest Management"]
        JF["Jellyfin\njellyfin.janikhenz.ch\n GPU\nMedia Server"]
        PL["Plex\nplex.janikhenz.ch\n GPU\nMedia Server"]
    end

    subgraph AUTOMATION["Automation (*arr)"]
        RD["Radarr\nradarr.janikhenz.ch\nFilme"]
        SN["Sonarr\nsonarr.janikhenz.ch\nSerien"]
        PR["Prowlarr\nprowlarr.janikhenz.ch\nIndexer Manager"]
    end

    subgraph DOWNLOAD["Download"]
        QB["qBittorrent\nqbt.janikhenz.ch\nTorrent Client"]
        FS["FlareSolverr\n(ClusterIP intern)\nCloudflare Bypass"]
    end

    subgraph STORAGE["Shared Storage"]
        GMP["global-media-pvc\n500Gi  /mnt/data/media"]
    end

    USER -->|"HTTPS"| TRAEFIK
    TRAEFIK -->|"jellyseerr.janikhenz.ch"| JS
    TRAEFIK -->|"jellyfin.janikhenz.ch"| JF
    TRAEFIK -->|"plex.janikhenz.ch"| PL
    TRAEFIK -->|"radarr.janikhenz.ch"| RD
    TRAEFIK -->|"sonarr.janikhenz.ch"| SN
    TRAEFIK -->|"prowlarr.janikhenz.ch"| PR
    TRAEFIK -->|"qbt.janikhenz.ch"| QB

    JS -->|"Serien anfragen :8989"| SN
    JS -->|"Filme anfragen :7878"| RD
    JS -->|"Verbunden mit :8096"| JF

    PR -->|"Indexer sync"| RD
    PR -->|"Indexer sync"| SN
    PR -->|"Cloudflare Bypass :8191"| FS

    RD -->|"Download job :8080"| QB
    SN -->|"Download job :8080"| QB

    QB -->|"schreibt"| GMP
    RD -->|"liest/verschiebt"| GMP
    SN -->|"liest/verschiebt"| GMP
    JF -->|"streamt von"| GMP
    PL -->|"streamt von"| GMP

    USER -->|"Stream"| JF
    USER -->|"Stream"| PL
```

### Services & Images

| Service      | Image                                      | Port  | Service-Typ | Subdomain (Traefik)           | GPU  |
| ------------ | ------------------------------------------ | ----- | ----------- | ----------------------------- | ---- |
| Jellyfin     | `jellyfin/jellyfin:latest`                 | 8096  | ClusterIP   | `jellyfin.janikhenz.ch`       | true |
| Plex         | `plexinc/pms-docker:latest`                | 32400 | ClusterIP   | `plex.janikhenz.ch`           | true |
| Jellyseerr   | `ghcr.io/seerr-team/seerr:latest`          | 5055  | ClusterIP   | `jellyseerr.janikhenz.ch`     |      |
| Radarr       | `linuxserver/radarr:latest`                | 7878  | ClusterIP   | `radarr.janikhenz.ch`         |      |
| Sonarr       | `linuxserver/sonarr:latest`                | 8989  | ClusterIP   | `sonarr.janikhenz.ch`         |      |
| Prowlarr     | `linuxserver/prowlarr:latest`              | 9696  | ClusterIP   | `prowlarr.janikhenz.ch`       |      |
| qBittorrent  | `linuxserver/qbittorrent:latest`           | 8080  | ClusterIP   | `qbt.janikhenz.ch`            |      |
| FlareSolverr | `ghcr.io/flaresolverr/flaresolverr:latest` | 8191  | ClusterIP   | intern (kein öffentl. Zugang) |      |

> **qBittorrent Torrent-Port:** Port 6881 TCP/UDP läuft als separater `NodePort 30008` (`qbittorrent-torrent-service`), da Raw-TCP/UDP-Traffic nicht durch Traefik's HTTP-Layer geroutet werden kann.

---

## Fitness Stack (wger)

wger ist eine selbst gehostete Fitness-Tracking-Anwendung. Der Stack besteht aus einem Django-Backend, PostgreSQL-Datenbank, Redis-Cache und Celery für asynchrone Tasks.

### Interne Architektur

```mermaid
flowchart TD
    USER["User / Browser"]
    TRAEFIK["Traefik\nIngressRoute\nwger.janikhenz.ch"]

    subgraph FITNESS["namespace: fitness"]
        WN["wger-nginx\nnginx:stable-alpine\nClusterIP :80\nReverse Proxy"]

        subgraph BACKEND["Backend"]
            WW["wger-web\nwger/server:latest\nDjango App :8000"]
            WCW["celery-worker\nwger/server:latest\nAsync Tasks"]
            WCB["celery-beat\nwger/server:latest\nCron Scheduler"]
        end

        subgraph DATA["Datenhaltung"]
            WDB["wger-db\npostgres:15-alpine\n:5432"]
            WC["wger-cache\nredis:7-alpine\n:6379\nDB1: Cache\nDB2: Celery Broker"]
        end

        subgraph STORAGE["Shared Storage"]
            WPGPVC["wger-postgres-pvc\n5Gi"]
            WRPVC["wger-redis-pvc\n1Gi"]
            WSPVC["wger-static-pvc\n2Gi RWX"]
            WMPVC["wger-media-pvc\n10Gi RWX"]
        end
    end

    USER -->|"HTTPS"| TRAEFIK
    TRAEFIK -->|"ClusterIP :80"| WN
    WN -->|"proxy_pass :8000"| WW
    WN -->|"/static/ → alias"| WSPVC
    WN -->|"/media/ → alias"| WMPVC

    WW -->|"Django ORM"| WDB
    WW -->|"Cache DB1\nCelery DB2"| WC
    WW -->|"statische Dateien"| WSPVC
    WW -->|"Medien"| WMPVC

    WCW -->|"Celery Broker DB2"| WC
    WCW -->|"liest/schreibt"| WMPVC
    WCW -->|"DB-Zugriff"| WDB
    WCB -->|"Celery Broker DB2"| WC
    WCB -->|"DB-Zugriff"| WDB

    WDB --> WPGPVC
    WC --> WRPVC
```

### Services & Images

| Service            | Image                 | Port | Service-Typ | Subdomain (Traefik) |
| ------------------ | --------------------- | ---- | ----------- | ------------------- |
| wger-nginx         | `nginx:stable-alpine` | 80   | ClusterIP   | `wger.janikhenz.ch` |
| wger-web           | `wger/server:latest`  | 8000 | ClusterIP   | —                   |
| wger-db            | `postgres:15-alpine`  | 5432 | ClusterIP   | —                   |
| wger-cache         | `redis:7-alpine`      | 6379 | ClusterIP   | —                   |
| wger-celery-worker | `wger/server:latest`  | —    | —           | —                   |
| wger-celery-beat   | `wger/server:latest`  | —    | —           | —                   |

---

## Dashboard

Eine selbst gehostete Web-Oberfläche auf dem **Raspberry Pi**, die als zentrales Homelab-Dashboard dient. Die Seite besteht aus reinem HTML/CSS/JS und wird über ein nginx-Image bereitgestellt, das automatisch via GitHub Actions gebaut und via ArgoCD deployed wird.

### Deployment-Flow

```mermaid
flowchart LR
    DEV["Developer\nPush to GitHub"]
    GH_DASH["GitHub\nJanikHenz/dashboard"]
    GH_ACT["GitHub Actions\ndocker-publish.yml"]
    GHCR["ghcr.io/janikhenz/dashboard:latest"]
    GH_HOME["GitHub\nJanikHenz/my-homelab"]
    ARGO["ArgoCD\napps/dashboard.yaml"]
    POD["nginx Pod\nRaspberry Pi\nClusterIP :80"]
    TRAEFIK["Traefik\nIngressRoute\njanikhenz.ch"]

    DEV -->|git push| GH_DASH
    GH_DASH -->|trigger| GH_ACT
    GH_ACT -->|build & push image| GHCR
    ARGO -->|pull image| GHCR
    GH_HOME -->|sync| ARGO
    ARGO -->|deploy| POD
    TRAEFIK -->|"Host(janikhenz.ch)"| POD
```

### Details

| Eigenschaft | Wert                                                          |
| ----------- | ------------------------------------------------------------- |
| Image       | `ghcr.io/janikhenz/dashboard:latest`                          |
| Node        | `raspberrypi`                                                 |
| Service-Typ | `ClusterIP`                                                   |
| URL         | `https://janikhenz.ch`                                        |
| Source Repo | [JanikHenz/dashboard](https://github.com/JanikHenz/dashboard) |

---

## Storage-Übersicht

| PVC                      | Größe  | Access Mode | Pfad auf Host                  | Konsumenten                          |
| ------------------------ | ------ | ----------- | ------------------------------ | ------------------------------------ |
| `jellyfin-config-pvc`    | 10 Gi  | RWO         | `/mnt/data/jellyfin/config`    | Jellyfin                             |
| `plex-config-pvc`        | 10 Gi  | RWO         | `/mnt/data/plex/config`        | Plex                                 |
| `radarr-config-pvc`      | 1 Gi   | RWO         | `/mnt/data/radarr/config`      | Radarr                               |
| `sonarr-config-pvc`      | 1 Gi   | RWO         | `/mnt/data/sonarr/config`      | Sonarr                               |
| `qbittorrent-config-pvc` | 1 Gi   | RWO         | `/mnt/data/qbittorrent/config` | qBittorrent                          |
| `prowlarr-config-pvc`    | 1 Gi   | RWO         | `/mnt/data/prowlarr/config`    | Prowlarr                             |
| `jellyseerr-config-pvc`  | 5 Gi   | RWO         | `/mnt/data/jellyseerr/config`  | Jellyseerr                           |
| `global-media-pvc`       | 500 Gi | **RWX**     | `/mnt/data/media`              | Jellyfin, Plex, Radarr, Sonarr, qBit |
| `wger-postgres-pvc`      | 5 Gi   | RWO         | `/mnt/data/wger/postgres`      | wger-db                              |
| `wger-redis-pvc`         | 1 Gi   | RWO         | `/mnt/data/wger/redis`         | wger-cache                           |
| `wger-static-pvc`        | 2 Gi   | **RWX**     | `/mnt/data/wger/static`        | wger-web, wger-nginx                 |
| `wger-media-pvc`         | 10 Gi  | **RWX**     | `/mnt/data/wger/media`         | wger-web, wger-nginx, celery-worker  |

---

## NVIDIA GPU

Die GPU wird über den **NVIDIA Device Plugin** bereitgestellt und via **Time-Slicing** auf 2 virtuelle Slots aufgeteilt. Sowohl Jellyfin als auch Plex können gleichzeitig Hardware-Transcoding nutzen.

```mermaid
flowchart TD
    subgraph KUBE_SYSTEM["kube-system"]
        CM["ConfigMap\nnvidia-plugin-configs\ntimeSlicing replicas: 2"]
        RC["RuntimeClass\nnvidia"]
        DS["DaemonSet\nnvidia-device-plugin\nnvcr.io/nvidia/k8s-device-plugin:v0.18.0\nnodeSelector: homeserver"]
        DS -->|"--config-file"| CM
        DS -->|"runtimeClassName"| RC
    end

    subgraph NODE["Node: homeserver"]
        GPU_HW["Physische NVIDIA GPU"]
        SLOT1["Virtueller Slot 1"]
        SLOT2["Virtueller Slot 2"]
        GPU_HW --> SLOT1
        GPU_HW --> SLOT2
    end

    subgraph MEDIA["namespace: media"]
        JF["Jellyfin\nnvidia.com/gpu: 1\nruntimeClassName: nvidia"]
        PL["Plex\nnvidia.com/gpu: 1\nruntimeClassName: nvidia"]
    end

    DS --> GPU_HW
    SLOT1 --> JF
    SLOT2 --> PL
```

**Konfiguration (nvidia-plugin-configs):**

- `migStrategy: none`
- `deviceListStrategy: envvar`
- `deviceIDStrategy: uuid`
- `timeSlicing.replicas: 2`

---

## Port-Übersicht & Routing

### Öffentlicher Zugang via Traefik IngressRoute

| Service           | Namespace | Container-Port | Service-Typ | Subdomain                         |
| ----------------- | --------- | -------------- | ----------- | --------------------------------- |
| Dashboard (nginx) | default   | 80             | ClusterIP   | `https://janikhenz.ch`            |
| Jellyfin          | media     | 8096           | ClusterIP   | `https://jellyfin.janikhenz.ch`   |
| Plex              | media     | 32400          | ClusterIP   | `https://plex.janikhenz.ch`       |
| Jellyseerr        | media     | 5055           | ClusterIP   | `https://jellyseerr.janikhenz.ch` |
| Radarr            | media     | 7878           | ClusterIP   | `https://radarr.janikhenz.ch`     |
| Sonarr            | media     | 8989           | ClusterIP   | `https://sonarr.janikhenz.ch`     |
| Prowlarr          | media     | 9696           | ClusterIP   | `https://prowlarr.janikhenz.ch`   |
| qBittorrent WebUI | media     | 8080           | ClusterIP   | `https://qbt.janikhenz.ch`        |
| wger (nginx)      | fitness   | 80             | ClusterIP   | `https://wger.janikhenz.ch`       |

### NodePort (nur Torrent-Protokoll — nicht HTTP-routebar)

| Service                     | Namespace | Port         | NodePort  | Zweck                     |
| --------------------------- | --------- | ------------ | --------- | ------------------------- |
| qbittorrent-torrent-service | media     | 6881 TCP/UDP | **30008** | Torrent-Peers (kein HTTP) |

### Interne ClusterIP (kein öffentlicher Zugang)

| Service            | Namespace | Port | Konsumenten      |
| ------------------ | --------- | ---- | ---------------- |
| FlareSolverr       | media     | 8191 | Prowlarr         |
| wger-web-service   | fitness   | 8000 | wger-nginx       |
| wger-db-service    | fitness   | 5432 | wger-web, celery |
| wger-cache-service | fitness   | 6379 | wger-web, celery |

---

## Verzeichnisstruktur

```
my-homelab/
├── bootstrap/
│   └── root-app.yaml          # ArgoCD App of Apps
│
├── apps/                      # ArgoCD Application-Definitionen
│   ├── dashboard.yaml
│   ├── jellyfin.yaml
│   ├── plex.yaml
│   ├── jellyseerr.yaml
│   ├── radarr.yaml
│   ├── sonarr.yaml
│   ├── prowlarr.yaml
│   ├── qbittorrent.yaml
│   ├── flaresolverr.yaml
│   └── wger.yaml
│
├── infrastrucure/             # Cluster-weite Ressourcen
│   ├── namespaces.yaml        # NS: media, fitness
│   ├── media-storage.yaml     # PV/PVC für Media Stack
│   ├── wger-storage.yaml      # PV/PVC für Fitness Stack
│   ├── daemonset.yaml         # NVIDIA Device Plugin DaemonSet
│   ├── nvidia-plugin-config.yaml # Time-Slicing ConfigMap
│   └── nvidia-runtimeclass.yaml  # RuntimeClass: nvidia
│
└── manifests/                 # Kubernetes Manifeste pro App
    ├── dashboard/
    │   ├── nginx-dashboard-deployment.yaml
    │   ├── nginx-dashboard-service.yaml   # ClusterIP
    │   └── nginx-dashboard-ingressroute.yaml  # janikhenz.ch
    ├── media-stack/
    │   ├── jellyfin/          # Deployment + ClusterIP + IngressRoute
    │   ├── plex/
    │   ├── jellyseerr/
    │   ├── radarr/
    │   ├── sonarr/
    │   ├── prowlarr/
    │   ├── qbittorrent/       # ClusterIP (WebUI) + NodePort (torrent 6881) + IngressRoute
    │   └── flaresolverr/      # ClusterIP only (intern)
    └── fitness/
        └── wger/              # 6 Deployments + Services + ConfigMap + IngressRoute
```
