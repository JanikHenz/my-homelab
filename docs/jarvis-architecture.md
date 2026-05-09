# Jarvis Architektur und Betrieb

Diese Datei beschreibt das Zielbild fuer `jarvis`, die Betriebsregeln fuer einen stabilen K3s-Cluster und den praktischen Setup von Continue.dev gegen den Ollama-Service im Cluster.

## 1) Zielbild

Jarvis laeuft als eigener Stack im Namespace `jarvis` und laeuft vollstaendig auf CPU.

- **Gehirn (LLM):** `ollama-deployment` + `ollama-service` auf Port `11434`
- **Voice I/O:** `whisper-service` (`10300`) und `piper-service` (`10200`) auf CPU
- **Memory:** `chromadb` StatefulSet + `chromadb-service` (`8000`) + PVC
- **Orchestrierung:** ArgoCD App-of-Apps via `bootstrap/root-app.yaml` und `apps/*.yaml`
- **Isolation:** Eigener Namespace `jarvis` getrennt vom `media`-Stack

## 2) Warum es vorher instabil war

In deinem Verlauf gab es drei Risikoquellen gleichzeitig:

1. **Host-Seite geaendert (Treiber/Container Runtime):**
   - `apt purge`/Neuinstallation von Container-Komponenten auf dem Worker-Host kann Runtime-Konfigurationen brechen, waehrend K3s selbst containerd verwaltet.
2. **Doppelte Ollama-Instanz (Host + K8s):**
   - Lokales Ollama auf dem Host konkurriert mit dem K8s-Ollama-Pod um CPU/RAM und fuehrt zu unnötiger Last.
3. **Firmware/Bios-Ebene:**
   - Da nach BIOS-Reset wieder Stabilitaet da war, war die Hauptursache sehr wahrscheinlich hostseitig (nicht nur YAML).

Wichtig: Ein `NotReady`-Node mit `NodeStatusUnknown` ist oft ein Host-/Kubelet-Problem, nicht direkt ein ArgoCD-Problem.

## 3) Aktuelle Betriebsregeln (Do / Dont)

### Do

- Ollama **nur** als K8s-Workload betreiben.
- Jarvis-Workloads (Ollama, Voice, Memory) auf CPU betreiben.
- Jede App mit `resources.requests/limits` betreiben.
- ArgoCD-Apps erst dann anlegen/aendern, wenn der Zielpfad in Git bereits gepusht ist.
- Sync-Waves fuer gestaffelten Start nutzen.

### Dont

- Kein paralleles Host-Ollama neben K8s-Ollama.
- Kein unkoordiniertes `apt purge containerd/docker` auf K3s-Worker.
- Keine grossen Stack-Rollouts ohne Wellen/Limitierung.

## 4) Jarvis Services (intern)

- Ollama API: `http://ollama-service.jarvis.svc.cluster.local:11434`
- Whisper (Wyoming STT): `whisper-service.jarvis.svc.cluster.local:10300`
- Piper (Wyoming TTS): `piper-service.jarvis.svc.cluster.local:10200`
- ChromaDB API: `http://chromadb-service.jarvis.svc.cluster.local:8000`

## 5) Continue.dev Setup (VS Code)

Du hast zwei gute Varianten:

### Variante A: Schnell lokal via Port-Forward (empfohlen fuer Start)

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

### Variante B: Direkt gegen Cluster-DNS (nur wenn dein Editor im Cluster-Netz ist)

- Endpoint: `http://ollama-service.jarvis.svc.cluster.local:11434`

Das funktioniert typischerweise nur fuer Workloads im Cluster oder wenn dein Netz/Resolver so konfiguriert ist, dass `.svc.cluster.local` erreichbar ist.

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

## 6) Health-Checks nach Aenderungen

Nach jeder groesseren Aenderung:

```bash
kubectl get nodes
kubectl get pods -A
kubectl -n jarvis get pods,svc,pvc
kubectl -n kube-system get pods | rg nvidia
kubectl describe node homeserver | rg -n "Ready|Pressure|NodeStatusUnknown|Kubelet"
```

## 7) Recovery Kurz-Runbook (wenn Homeserver wieder instabil wird)

1. Zuerst Cluster stabil halten:
   - Problematische Apps in ArgoCD pausieren (oder Scale auf 0), damit der Node nicht sofort voll laeuft.
2. Host validieren:
   - BIOS/Power/Temperatur/RAM pruefen.
3. Nur eine Ollama-Instanz:
   - Sicherstellen, dass lokal kein Host-Ollama laeuft.
4. K3s Worker sauber hochfahren:
   - Node `Ready` abwarten, dann Jarvis-Workloads schrittweise aktivieren.

