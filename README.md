# My Homelab

Eine selbst gehostete Kubernetes-Infrastruktur auf einem **2-Node-Cluster** (Raspberry Pi als Control Plane + Homeserver als Worker Node) mit GitOps-Deployment via ArgoCD, Cloudflare Zero Trust für externen Zugriff, NVIDIA GPU-Unterstützung sowie zwei Applikations-Stacks: **Media** und **Fitness**.

---

## Inhaltsverzeichnis

- [Netzwerk-Topologie](#netzwerk-topologie)
- [Hardware & Cluster](#hardware--cluster)
- [GitOps-Architektur](#gitops-architektur)
- [Namespaces & Stacks](#namespaces--stacks)
- [Media Stack](#media-stack)
- [Fitness Stack (wger)](#fitness-stack-wger)
- [Storage-Übersicht](#storage-übersicht)
- [NVIDIA GPU](#nvidia-gpu)
- [Port-Übersicht](#port-übersicht)
- [Verzeichnisstruktur](#verzeichnisstruktur)

---

## Netzwerk-Topologie

Beide Nodes sind direkt am Router im Heimnetz angeschlossen. Der **Raspberry Pi** fungiert als Kubernetes Control Plane und hostet ArgoCD sowie den `cloudflared`-Tunnel für externen Zugriff via **Cloudflare Zero Trust**. Der **Homeserver** ist der einzige Worker Node und führt alle Workloads aus.

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
        CFD["cloudflared"]
    end

    subgraph SERVER["Homeserver (Worker Node)"]
        KW["kubelet"]
        GPU["NVIDIA GPU\n(Time-Slicing 2×)"]
        DISK["/mnt/data/"]

        subgraph SYS["kube-system"]
            NDP["nvidia-device-plugin"]
        end
        subgraph MEDIA_NS["namespace: media"]
            MEDIA["Media Stack"]
        end
        subgraph FITNESS_NS["namespace: fitness"]
            FITNESS["Fitness Stack"]
        end
    end

    CP <-->|"Cluster API"| KW
    ARGO -->|"deploy"| MEDIA_NS
    ARGO -->|"deploy"| FITNESS_NS
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
        MS["media-stack/\njellyfin, plex, radarr\nsonarr, prowlarr\nqbittorrent, jellyseerr\nflaresolverr"]
        FS["fitness/wger/\nweb, nginx, db\ncache, celery"]
    end

    subgraph CLUSTER["homelab Cluster"]
        NS_MEDIA["namespace: media"]
        NS_FITNESS["namespace: fitness"]
    end

    DEV -->|git push| GH
    GH -->|sync| ROOT
    ROOT -->|creates| APPS
    APPS -->|points to| MANIFESTS
    MS -->|deploys to| NS_MEDIA
    FS -->|deploys to| NS_FITNESS
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

    subgraph FRONTEND["Frontend (Zugriff)"]
        JS["Jellyseerr\nNodePort :30005\nRequest Management"]
        JF["Jellyfin\nNodePort :30008\n GPU\nMedia Server"]
        PL["Plex\nNodePort :30009\n GPU\nMedia Server"]
    end

    subgraph AUTOMATION["Automation (*arr)"]
        RD["Radarr\nNodePort :30078\nFilme"]
        SN["Sonarr\nNodePort :30089\nSerien"]
        PR["Prowlarr\nNodePort :30696\nIndexer Manager"]
    end

    subgraph DOWNLOAD["Download"]
        QB["qBittorrent\nNodePort :30180\nTorrent Client"]
        FS["FlareSolverr\nNodePort :30191\nCloudflare Bypass"]
    end

    subgraph STORAGE["Shared Storage"]
        GMP["global-media-pvc\n500Gi  /mnt/data/media"]
    end

    USER -->|"Medien anfragen"| JS
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

| Service      | Image                                      | Port  | NodePort | GPU |
| ------------ | ------------------------------------------ | ----- | -------- | --- |
| Jellyfin     | `jellyfin/jellyfin:latest`                 | 8096  | 30001    | true |
| Plex         | `plexinc/pms-docker:latest`                | 32400 | 30002    | true |
| Jellyseerr   | `ghcr.io/seerr-team/seerr:latest`          | 5055  | 30003    |     |
| Radarr       | `linuxserver/radarr:latest`                | 7878  | 30004    |     |
| Sonarr       | `linuxserver/sonarr:latest`                | 8989  | 30005    |     |
| Prowlarr     | `linuxserver/prowlarr:latest`              | 9696  | 30006    |     |
| qBittorrent  | `linuxserver/qbittorrent:latest`           | 8080  | 30007    |     |
| FlareSolverr | `ghcr.io/flaresolverr/flaresolverr:latest` | 8191  | 30009    |     |

---

## Fitness Stack (wger)

wger ist eine selbst gehostete Fitness-Tracking-Anwendung. Der Stack besteht aus einem Django-Backend, PostgreSQL-Datenbank, Redis-Cache und Celery für asynchrone Tasks.

### Interne Architektur

```mermaid
flowchart TD
    USER["User / Browser"]

    subgraph FITNESS["namespace: fitness"]
        WN["wger-nginx\nnginx:stable-alpine\nNodePort :30010\nReverse Proxy"]

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

    USER -->|":30081"| WN
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

| Service            | Image                 | Port | Service-Typ | NodePort |
| ------------------ | --------------------- | ---- | ----------- | -------- |
| wger-nginx         | `nginx:stable-alpine` | 80   | NodePort    | 30081    |
| wger-web           | `wger/server:latest`  | 8000 | ClusterIP   | —        |
| wger-db            | `postgres:15-alpine`  | 5432 | ClusterIP   | —        |
| wger-cache         | `redis:7-alpine`      | 6379 | ClusterIP   | —        |
| wger-celery-worker | `wger/server:latest`  | —    | —           | —        |
| wger-celery-beat   | `wger/server:latest`  | —    | —           | —        |

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

## Port-Übersicht

| Service             | Namespace | Container-Port | NodePort  | URL (Beispiel)                |
| ------------------- | --------- | -------------- | --------- | ----------------------------- |
| Jellyfin            | media     | 8096           | **30001** | `http://homeserver:30001`     |
| Plex                | media     | 32400          | **30002** | `http://homeserver:30002/web` |
| Jellyseerr          | media     | 5055           | **30003** | `http://homeserver:30003`     |
| Radarr              | media     | 7878           | **30004** | `http://homeserver:30004`     |
| Sonarr              | media     | 8989           | **30005** | `http://homeserver:30005`     |
| Prowlarr            | media     | 9696           | **30006** | `http://homeserver:30006`     |
| qBittorrent WebUI   | media     | 8080           | **30007** | `http://homeserver:30007`     |
| qBittorrent Torrent | media     | 6881 TCP/UDP   | **30008** | —                             |
| FlareSolverr        | media     | 8191           | **30009** | `http://homeserver:30009`     |
| wger (nginx)        | fitness   | 80             | **30010** | `http://homeserver:30010`     |

---

## Verzeichnisstruktur

```
my-homelab/
├── bootstrap/
│   └── root-app.yaml          # ArgoCD App of Apps
│
├── apps/                      # ArgoCD Application-Definitionen
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
    ├── media-stack/
    │   ├── jellyfin/          # Deployment + Service
    │   ├── plex/
    │   ├── jellyseerr/
    │   ├── radarr/
    │   ├── sonarr/
    │   ├── prowlarr/
    │   ├── qbittorrent/
    │   └── flaresolverr/
    └── fitness/
        └── wger/              # 6 Deployments + Services + ConfigMap
```
