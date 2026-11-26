# Manuelle Schritte – Best-Practice-Umbau 26.11.2026

Begleitdokument zu [`CHANGELOG-bestpractice-2026-11-26.md`](CHANGELOG-bestpractice-2026-11-26.md).

**Ausgangslage:** Der Auto-Sync der `root-app` ist noch **aus** (seit dem Refactoring).
Schritt 6 aus `MANUAL-STEPS-refactor` ist hier Schritt 2. Schritt 8 aus dem Refactoring
(`monitoring` syncen) passiert jetzt automatisch.

---

## 1. Committen und pushen

```bash
git status && git diff
git add -A
git commit -m "feat: appprojects, auto-sync, clusterip services, self-managed argocd"
git push
```

Solange der Auto-Sync der root-app aus ist, passiert dadurch noch **nichts** im Cluster.

## 2. Auto-Sync der root-app wieder einschalten

```bash
kubectl apply -f bootstrap/root-app.yaml
kubectl -n argocd get application root-app -o jsonpath='{.spec.syncPolicy}'; echo
```

Ab jetzt läuft alles automatisch, innerhalb von ~3 Minuten:
1. Die AppProjects `infrastructure`, `platform` und `apps` werden angelegt.
2. Das ApplicationSet ordnet die Apps ihren Projekten zu und schaltet Auto-Sync ein.
3. Alle Apps syncen sich selbst:
   - `monitoring`: Prometheus und node-exporter starten neu.
   - 11 Services verlieren ihren NodePort.
4. Neue Kachel `argocd` (OutOfSync, **kein** Auto-Sync). Siehe Schritt 4.

## 3. Kontrolle

```bash
kubectl -n argocd get appprojects
kubectl -n argocd get applications -o custom-columns='NAME:.metadata.name,PROJECT:.spec.project,SYNC:.status.sync.status,HEALTH:.status.health.status,AUTO:.spec.syncPolicy.automated'
kubectl get svc -A | grep NodePort        # nur noch die 10 gewollten (plus traefik/argocd-server)
```

Erwartet: Alle Apps sind `Synced/Healthy`. `argocd` steht auf OutOfSync, `infrastructure` auf Synced.
**Fehlermeldung „not permitted in project“** → mir den Text schicken. Dabei wird nichts gelöscht,
nur der Sync dieser App schlägt fehl.

Funktionstest: `https://janikhenz.ch` (Dashboard), Jellyfin per TV, Home Assistant → Sprachassistent
(Whisper/Piper/Ollama), Radarr → Download starten.

## 4. ArgoCD selbst übernehmen (manuell, mit Bedacht)

Bei der Kachel `argocd` zuerst **App Diff** ansehen. Wie bei `infrastructure` stehen zunächst
fast alle Objekte auf OutOfSync (fehlende Tracking-Markierung). Echte Änderungen sollten nur sein:
- `Service argocd-server`: NodePort → ClusterIP
- eventuell Labels/Annotations

**Nicht syncen und mir den Diff schicken**, falls sich an Deployments/StatefulSets
(Images, Args, nodeSelector), an `argocd-cm` oder an `argocd-cmd-params-cm` etwas Inhaltliches ändert.

Wenn der Diff passt: **Sync ohne Prune**. Danach prüfen:
- `https://argocd.janikhenz.ch` erreichbar und Login funktioniert
- `kubectl -n argocd get pods`: alle Running

Ab dann gilt: **kein `helm upgrade` mehr.** Upgrades laufen über `targetRevision` in `apps/argocd.yaml`.

### Notfall: ArgoCD ist nach dem Sync kaputt

Von einem Rechner mit `helm` und kubeconfig (z. B. dem Pi) den alten Zustand wiederherstellen:

```bash
helm repo add argo https://argoproj.github.io/argo-helm && helm repo update
cat > /tmp/argocd-values.yaml <<'EOF'
global:
  domain: argocd.janikhenz.ch
  nodeSelector: { kubernetes.io/hostname: raspberrypi }
configs:
  params: { server.insecure: true }
server:
  service: { type: NodePort, nodePortHttp: 30800, nodePortHttps: 30443 }
EOF
helm upgrade argocd argo/argo-cd --version 9.4.7 -n argocd -f /tmp/argocd-values.yaml
```

Die UI ist dann auch direkt über `http://192.168.1.10:30800` erreichbar.

## 5. Radarr auf internen qBittorrent umstellen, danach NodePort 30007 entfernen

1. Radarr → *Settings → Download Clients → qBittorrent*:
   Host `qbittorrent-service`, Port `8080`, dann **Test** und **Save**. So ist es bei Sonarr schon eingestellt.
2. Einen Test-Download starten.
3. In `manifests/media-stack/qbittorrent/qbittorrent-service.yaml` die vier Kommentarzeilen sowie
   `type: NodePort` und `nodePort: 30007` löschen, dann committen und pushen.
   Durch den Auto-Sync wird das automatisch angewendet. (Oder sag mir Bescheid, dann bereite ich es vor.)

## Gut zu wissen ab jetzt

| Situation | Was passiert |
|---|---|
| Push einer Änderung an einer App | wird automatisch angewendet (~3 Min.) |
| `kubectl edit` an einer App | wird von ArgoCD zurückgesetzt (selfHeal) – Änderungen nur noch über Git |
| App im Dashboard skalieren | bleibt so (replicas ignoriert) |
| Datei einer App aus Git löschen | Objekt wird im Cluster gelöscht (prune) |
| App-Eintrag aus ApplicationSet löschen | Kachel verschwindet, Workloads bleiben laufen (kein Finalizer) |
| Änderungen an `infrastructure/` oder `apps/argocd.yaml` | **nur** nach manuellem Sync |
| Neue App mit neuem Namespace | Namespace in `infrastructure/values.yaml` **und** in `apps/projects.yaml` (Projekt `apps`) eintragen |
