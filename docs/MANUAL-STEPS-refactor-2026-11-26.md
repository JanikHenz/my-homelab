# Manuelle Schritte – Refactoring 26.11.2026

Begleitdokument zu [`CHANGELOG-refactor-2026-11-26.md`](CHANGELOG-refactor-2026-11-26.md).
**Bitte in genau dieser Reihenfolge.** Der heikle Teil ist die Übernahme der 21 bestehenden
Applications durch das ApplicationSet (Schritte 2–6).

> Im schlimmsten Fall gehen **keine Daten** verloren: Alle Daten liegen als hostPath unter
> `/mnt/data` (Retain), Namespaces/Secrets sind gegen Löschen geschützt, und keine Application
> hat einen Finalizer (Löschen einer Application löscht keine Workloads).

---

## 1. Änderungen prüfen und committen (noch nicht pushen)

```bash
git status
git diff
git add -A
git commit -m "refactor: applicationset, helm chart for infrastructure, remove defaults"
```

## 2. Auto-Sync der root-app vorübergehend ausschalten

> ✅ **Erledigt durch Claude am 26.11.2026 auf deine Anweisung** (`kubectl patch`, siehe unten).
> Vorher: `{"automated":{"prune":true,"selfHeal":true}}` – nachher: leer. root-app war
> danach weiterhin *Synced/Healthy*. Solange Auto-Sync aus ist, übernimmt die root-app
> Änderungen in `apps/` nur bei manuellem Sync → Schritt 6 nicht vergessen.

**Warum:** Der Commit löscht die 21 Dateien in `apps/`. Mit Auto-Sync + Prune würde die
root-app die 21 Applications sofort löschen – bevor das ApplicationSet sie übernommen hat.
(Workloads blieben laufen, aber Kacheln und Sync-Historie wären weg.)

```bash
kubectl -n argocd patch application root-app --type merge -p '{"spec":{"syncPolicy":null}}'
kubectl -n argocd get application root-app -o jsonpath='{.spec.syncPolicy}'; echo   # leer = aus
```

(Alternativ im UI: root-app → *Details* → *Disable Auto-Sync*.)

## 3. Pushen und root-app ohne Prune syncen

```bash
git push
```

Im UI bei `root-app` auf **Refresh**, dann **App Diff** ansehen. Erwartet:
- neu: `ApplicationSet homelab-apps`
- 21 Applications als „requires pruning“ markiert (gelbes Papierkorb-Symbol)
- `infrastructure`: nur die entfernte Sync-Wave-Annotation

Dann **Sync** – Häkchen **„Prune“ AUS**.

## 4. Prüfen, ob das ApplicationSet die Apps übernommen hat

Nach ~30 Sekunden:

```bash
kubectl -n argocd get applicationset homelab-apps -o jsonpath='{range .status.conditions[*]}{.type}={.status} {.message}{"\n"}{end}'

kubectl -n argocd get applications -o custom-columns='NAME:.metadata.name,OWNER:.metadata.ownerReferences[0].name,ROOT-TRACKING:.metadata.annotations.argocd\.argoproj\.io/tracking-id'
```

**Erwartet:** Bei allen 21 App-Applications steht `OWNER = homelab-apps` und
`ROOT-TRACKING` ist leer (`<none>`). `infrastructure` und `root-app` haben keinen Owner.

**Falls bei einer App kein Owner steht** (ApplicationSet hat sie nicht übernommen):
Die alte Application **ohne Kaskade** löschen – das ApplicationSet legt sie sofort neu an,
die laufenden Pods bleiben unberührt (kein Finalizer):

```bash
kubectl -n argocd get application <name> -o jsonpath='{.metadata.finalizers}'; echo   # muss leer sein!
kubectl -n argocd delete application <name>
```

## 5. root-app prüfen

Im UI `root-app` → **Refresh**. Erwartet: **Synced**, keine Applications mehr als
„requires pruning“.

⚠️ Stehen noch Applications auf „requires pruning“: **Auto-Sync NICHT wieder einschalten**
und mir Bescheid geben.

## 6. Auto-Sync der root-app wieder einschalten

```bash
kubectl apply -f bootstrap/root-app.yaml
kubectl -n argocd get application root-app -o jsonpath='{.spec.syncPolicy}'; echo   # automated prune/selfHeal
```

## 7. `infrastructure` prüfen (Helm-Render)

ArgoCD rendert jetzt das Helm-Chart. Bei `infrastructure` auf **Refresh**:

- **Synced** → Chart erzeugt exakt dieselben Objekte wie vorher. Fertig, nichts syncen.
- **OutOfSync** → **App Diff** ansehen. Es dürfen nur kosmetische Unterschiede sein. Bei
  PVs/PVCs darf sich **nichts** an `spec` ändern. Im Zweifel: nicht syncen, mir den Diff schicken.
- **Unknown / ComparisonError** → Render-Fehler im Chart. Nichts passiert im Cluster
  (kein Auto-Sync). Fehlermeldung an mich.

Immer: **Sync nur ohne Prune.**

## 8. Apps syncen (einzeln)

Die meisten Apps werden OutOfSync angezeigt, weil Felder entfernt wurden (`targetPort`,
`protocol`, `replicas`). Ein Sync ist dort inhaltlich eine Nullrunde.

| App | Echte Änderung | Hinweis |
|---|---|---|
| `monitoring` | node-exporter ohne Annotationen, Prometheus ohne Lifecycle-Flag | Neustart von Prometheus + node-exporter. Danach Grafana-Dashboard öffnen: Werte sollten gleich bleiben, Summen (z. B. Strom) halbieren sich auf den echten Wert. |
| alle anderen | keine | `replicas` wird jetzt ignoriert → Sync startet gestoppte Apps nicht mehr |

Kontrolle nach den Syncs:

```bash
kubectl get applications -n argocd
kubectl get pods -A | grep -v -E "Running|Completed"
```

## 9. Optional: Apps wieder herunterskalieren

Beim letzten Sync sind alle zuvor gestoppten Apps wieder gestartet (home-assistant,
librechat, ollama, piper, whisper, nextcloud, vaultwarden). Wenn sie aus sein sollen:
über das Dashboard auf 0 skalieren. Ab jetzt bleiben sie auch nach einem Sync aus.

## Ab jetzt: Neue App hinzufügen

1. Manifeste unter `manifests/<app>/` anlegen (mit `namespace:` in jedem Objekt).
2. Neuer Namespace? → `infrastructure/values.yaml` → `namespaces:`; Speicher? → `volumes:`.
   Dann `infrastructure` von Hand syncen (ohne Prune).
3. Eine Zeile in `apps/applicationset.yaml` unter `elements:` ergänzen.
4. Commit + Push → Kachel erscheint automatisch, dann von Hand syncen.
