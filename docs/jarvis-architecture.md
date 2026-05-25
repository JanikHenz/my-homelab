# Jarvis Architektur und Betrieb

Diese Datei beschreibt das Zielbild fuer `jarvis`, die Betriebsregeln fuer einen stabilen K3s-Cluster und den praktischen Setup von Continue.dev gegen den Ollama-Service im Cluster.

## 1) Zielbild

Jarvis laeuft als eigener Stack im Namespace `jarvis`. **Ollama** nutzt die NVIDIA GPU auf dem Homeserver. **Whisper**, **Piper** und **ChromaDB** laufen auf CPU.

- **Gehirn (LLM):** `ollama-deployment` + `ollama-service` auf Port `11434`, `runtimeClassName: nvidia`, `nvidia.com/gpu: 1`
- **Voice I/O:** `whisper-deployment` (`10300`) und `piper-deployment` (`10200`) auf CPU (Wyoming-Protokoll)
- **Memory:** `chromadb` StatefulSet + `chromadb-service` (`8000`) + PVC `chromadb-pvc` (5 Gi)
- **Modelle:** PVC `ollama-config-pvc` (50 Gi) unter `/mnt/data/ollama/config`
- **Orchestrierung:** ArgoCD App-of-Apps via `bootstrap/root-app.yaml` und `apps/*.yaml`
- **Isolation:** Eigener Namespace `jarvis`, getrennt vom `media`-Stack

### GPU-Teilen mit Jellyfin

Jellyfin im Namespace `media` fordert ebenfalls `nvidia.com/gpu: 1` auf demselben Node (`homeserver`). Beide Pods teilen sich **eine physische GPU**. Gleichzeitiger Volllast (Transcoding + grosses LLM) kann zu Timeouts oder OOM fuehren. In der Praxis reicht die GPU meist fuer eines der beiden Workloads zur Zeit.

| Workload | Namespace | GPU | Node |
| -------- | --------- | --- | ---- |
| Ollama   | `jarvis`  | ja  | `homeserver` |
| Jellyfin | `media`   | ja  | `homeserver` |
| Whisper  | `jarvis`  | nein | `homeserver` |
| Piper    | `jarvis`  | nein | `homeserver` |
| ChromaDB | `jarvis`  | nein | `homeserver` |

### Erreichbarkeit

| Zugang | URL / Adresse |
| ------ | ------------- |
| Intern (Cluster) | `http://ollama-service.jarvis.svc.cluster.local:11434` |
| NodePort (Heimnetz) | `http://homeserver:30013` |
| Traefik (extern) | `https://ollama.janikhenz.ch` |

## 2) Warum es vorher instabil war

In deinem Verlauf gab es drei Risikoquellen gleichzeitig:

1. **Host-Seite geaendert (Treiber/Container Runtime):**
   - `apt purge`/Neuinstallation von Container-Komponenten auf dem Worker-Host kann Runtime-Konfigurationen brechen, waehrend K3s selbst containerd verwaltet.
2. **Doppelte Ollama-Instanz (Host + K8s):**
   - Lokales Ollama auf dem Host konkurriert mit dem K8s-Ollama-Pod um CPU/RAM/GPU und fuehrt zu unnoetiger Last.
3. **Firmware/Bios-Ebene:**
   - Da nach BIOS-Reset wieder Stabilitaet da war, war die Hauptursache sehr wahrscheinlich hostseitig (nicht nur YAML).

Wichtig: Ein `NotReady`-Node mit `NodeStatusUnknown` ist oft ein Host-/Kubelet-Problem, nicht direkt ein ArgoCD-Problem.

## 3) Aktuelle Betriebsregeln (Do / Dont)

### Do

- Ollama **nur** als K8s-Workload betreiben (nicht zusaetzlich auf dem Host).
- GPU-Workloads (Ollama, Jellyfin) mit `resources.requests/limits` und `runtimeClassName: nvidia` betreiben.
- Voice- und Memory-Workloads (Whisper, Piper, ChromaDB) auf CPU mit Limits betreiben.
- Vor grossen Ollama-Laeufen pruefen, ob Jellyfin gerade transcodiert (GPU frei halten).
- Jede App mit `resources.requests/limits` betreiben.
- ArgoCD-Apps erst dann anlegen/aendern, wenn der Zielpfad in Git bereits gepusht ist.
- Sync-Waves fuer gestaffelten Start nutzen.

### Dont

- Kein paralleles Host-Ollama neben K8s-Ollama.
- Kein unkoordiniertes `apt purge containerd/docker` auf K3s-Worker.
- Keine grossen Stack-Rollouts ohne Wellen/Limitierung.
- Nicht gleichzeitig GPU-lastiges Jellyfin-Transcoding und grosses Ollama-Modell erwarten, ohne Ressourcen zu pruefen.

## 4) Jarvis Services (intern)

- Ollama API: `http://ollama-service.jarvis.svc.cluster.local:11434`
- Whisper (Wyoming STT): `whisper-service.jarvis.svc.cluster.local:10300`
- Piper (Wyoming TTS): `piper-service.jarvis.svc.cluster.local:10200`
- ChromaDB API: `http://chromadb-service.jarvis.svc.cluster.local:8000`

## 5) Continue.dev Setup (VS Code)

Du hast drei gute Varianten:

### Variante A: Port-Forward (empfohlen fuer lokale Entwicklung)

1. Port-Forward starten:

```bash
kubectl -n jarvis port-forward svc/ollama-service 11434:11434
```

2. In Continue als Ollama-Endpoint `http://localhost:11434` eintragen.
3. Testen:

```bash
curl http://localhost:11434/api/tags
```

Wenn Modelle angezeigt werden, ist Continue korrekt verbunden.

### Variante B: NodePort im Heimnetz

- Endpoint: `http://homeserver:30013` (oder die IP des Worker-Nodes)
- Kein Port-Forward noetig, solange du im LAN bist.

### Variante C: Cluster-DNS (nur wenn der Editor im Cluster-Netz ist)

- Endpoint: `http://ollama-service.jarvis.svc.cluster.local:11434`

Das funktioniert typischerweise nur fuer Workloads im Cluster oder wenn dein Netz/Resolver `.svc.cluster.local` aufloest.

### Beispiel fuer Continue Konfiguration

Pfad (je nach Continue-Version): `~/.continue/config.json`

```json
{
  "models": [
    {
      "title": "Jarvis Qwen 3B",
      "provider": "ollama",
      "model": "qwen2.5-coder:3b",
      "apiBase": "http://localhost:11434"
    }
  ],
  "tabAutocompleteModel": {
    "title": "Jarvis Qwen 3B",
    "provider": "ollama",
    "model": "qwen2.5-coder:3b",
    "apiBase": "http://localhost:11434"
  }
}
```

Bei Variante B `apiBase` auf `http://homeserver:30013` setzen.

## 6) Health-Checks nach Aenderungen

Nach jeder groesseren Aenderung:

```bash
kubectl get nodes
kubectl get pods -A
kubectl -n jarvis get pods,svc,pvc
kubectl -n kube-system get pods | rg nvidia
kubectl describe node homeserver | rg -n "Ready|Pressure|NodeStatusUnknown|Kubelet"
```

GPU und Ollama gezielt pruefen:

```bash
kubectl -n jarvis describe pod -l app=ollama | rg -i "gpu|nvidia|oom|failed"
kubectl -n media describe pod -l app=jellyfin | rg -i "gpu|nvidia|oom|failed"
kubectl -n monitoring get pods -l app=dcgm-exporter
```

## 7) Recovery Kurz-Runbook (wenn Homeserver wieder instabil wird)

1. Zuerst Cluster stabil halten:
   - Problematische Apps in ArgoCD pausieren (oder Scale auf 0), damit der Node nicht sofort voll laeuft.
   - Bei GPU-Konflikt zuerst Jellyfin **oder** Ollama auf 0 skalieren.
2. Host validieren:
   - BIOS/Power/Temperatur/RAM pruefen.
   - NVIDIA-Treiber und Device Plugin (`kube-system`) pruefen.
3. Nur eine Ollama-Instanz:
   - Sicherstellen, dass lokal kein Host-Ollama laeuft.
4. K3s Worker sauber hochfahren:
   - Node `Ready` abwarten, dann zuerst Ollama, danach optional Jellyfin wieder aktivieren.
