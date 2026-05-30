# Pterodactyl Setup Guide

Diese Anleitung beschreibt die Erstkonfiguration von Pterodactyl nach dem Deployment.

## Voraussetzungen

- Kubernetes Cluster läuft
- ArgoCD hat Pterodactyl deployed
- Docker ist auf dem Homeserver installiert (für Wings)

## Schritt 1: Secrets anpassen

Vor dem ersten Deployment müssen die Secrets generiert werden:

```bash
# Generiere Passwörter
openssl rand -base64 32  # root-password für MariaDB
openssl rand -base64 32  # password für MariaDB
openssl rand -base64 32  # app-key (ohne base64: Präfix)
```

Bearbeite `pterodactyl-secrets.yaml` und trage die Werte ein:

```yaml
stringData:
  mariadb-root-password: "GENERIERTES_PASSWORT_1"
  mariadb-password: "GENERIERTES_PASSWORT_2"
  app-key: "base64:GENERIERTER_KEY_3"
  admin-password: "dein-admin-passwort"
```

Wende die Secrets an:

```bash
kubectl apply -f manifests/gaming/pterodactyl/pterodactyl-secrets.yaml
```

## Schritt 2: Verzeichnisse erstellen

Auf dem Homeserver müssen die Verzeichnisse für die Persistent Volumes erstellt werden:

```bash
# Auf dem Homeserver ausführen
sudo mkdir -p /mnt/data/pterodactyl/panel/config
sudo mkdir -p /mnt/data/pterodactyl/panel/database
sudo mkdir -p /mnt/data/pterodactyl/wings/config
sudo mkdir -p /mnt/data/pterodactyl/servers

# Berechtigungen setzen
sudo chown -R 1000:1000 /mnt/data/pterodactyl/
```

## Schritt 3: Erstkonfiguration Panel

### 3.1 Auf das Panel zugreifen

- Öffne `https://pterodactyl.janikhenz.ch`
- Oder lokal: `http://homeserver:30020`

### 3.2 Admin-Account erstellen

Beim ersten Zugriff wird ein Setup-Bildschirm angezeigt:

1. Gib die Admin-Daten ein:
   - Username: `admin`
   - Email: `admin@janikhenz.ch`
   - Password: (aus dem Secret)

2. Fülle die Firmeninformationen aus (kann später geändert werden)

3. Warte auf die Initialisierung

## Schritt 4: Wings konfigurieren

### 4.1 Node im Panel erstellen

1. Gehe zu **Admin → Nodes → Create New**
2. Konfiguriere die Node:
   ```
   Name: homeserver
   Description: Homeserver Kubernetes Node
   Location: Home
   FQDN: homeserver
   Communication: HTTP (für internes Netz)
   Behind Proxy: Yes (wegen Cloudflare/Treafik)
   ```
3. Speichere die Node

### 4.2 Konfiguration generieren

1. Klicke auf die erstellte Node
2. Gehe zum Tab **Configuration**
3. Kopiere die Konfiguration

### 4.3 Config auf das PVC kopieren

Erstelle die config.yml auf dem Wings-PVC:

```bash
# Erstelle die Config-Datei lokal
cat > /tmp/config.yml << 'EOF'
# Füge hier die generierte Konfiguration aus dem Panel ein
EOF

# Kopiere in das Pod-Verzeichnis
kubectl cp /tmp/config.yml gaming/pterodactyl-wings-pod-name:/etc/pterodactyl/config.yml
```

Alternativ über den Node direkt:

```bash
# Direkt auf dem Homeserver
sudo nano /mnt/data/pterodactyl/wings/config/config.yml
# Füge die Konfiguration ein
```

### 4.4 Wings neustarten

```bash
kubectl rollout restart deployment pterodactyl-wings -n gaming
```

## Schritt 5: Verifizierung

### Prüfe die Logs

```bash
# Panel Logs
kubectl logs -n gaming deployment/pterodactyl-panel

# Wings Logs
kubectl logs -n gaming deployment/pterodactyl-wings

# MariaDB Logs
kubectl logs -n gaming deployment/pterodactyl-mariadb
```

### Prüfe die Verbindung

1. Im Panel: Gehe zu **Admin → Nodes**
2. Die Node sollte als **Healthy** angezeigt werden
3. Heartbeat sollte aktuell sein

## Schritt 6: Ersten Game Server erstellen

1. Gehe zu **Servers → Create New**
2. Wähle ein Nest (z. B. Minecraft, CS:GO)
3. Konfiguriere:
   - Name: `mein-minecraft-server`
   - Owner: dein Admin-Account
   - Node: `homeserver`
   - Memory: `4096` (4 GB)
   - Disk: `10000` (10 GB)
   - CPU: `100` (100%)
4. Erstelle den Server

## Troubleshooting

### Wings zeigt "Offline"

1. Prüfe die Logs:
   ```bash
   kubectl logs -n gaming deployment/pterodactyl-wings
   ```

2. Überprüfe die config.yml:
   - Token muss mit dem Panel übereinstimmen
   - API-URL muss erreichbar sein

3. Prüfe Docker auf dem Host:
   ```bash
   sudo docker ps
   ```

### Panel zeigt 500 Fehler

1. Prüfe die Datenbank-Verbindung:
   ```bash
   kubectl logs -n gaming deployment/pterodactyl-panel | grep -i error
   ```

2. Prüfe die Secrets:
   ```bash
   kubectl get secret pterodactyl-secrets -n gaming -o yaml
   ```

3. MariaDB prüfen:
   ```bash
   kubectl exec -it -n gaming deployment/pterodactyl-mariadb -- mysql -u pterodactyl -p
   # Passwort aus Secret eingeben
   SHOW DATABASES;
   ```

### Docker-Socket nicht erreichbar

Wings benötigt Zugriff auf den Docker-Socket:

```bash
# Prüfe ob Docker läuft
sudo systemctl status docker

# Prüfe Socket-Berechtigungen
ls -la /var/run/docker.sock
```

## Sicherheitshinweise

- Ändere das Admin-Passwort nach dem ersten Login
- Aktiviere 2FA im Panel für den Admin-Account
- Überprüfe regelmässig die Logs auf ungewöhnliche Aktivitäten
- Nutze nur verifizierte Egg-Templates aus dem Pterodactyl-Repository

## Nützliche Befehle

```bash
# Alle Pterodactyl Pods anzeigen
kubectl get pods -n gaming

# Panel durchstarten
kubectl rollout restart deployment pterodactyl-panel -n gaming

# Wings durchstarten
kubectl rollout restart deployment pterodactyl-wings -n gaming

# In den MariaDB Container
kubectl exec -it -n gaming deployment/pterodactyl-mariadb -- mysql -u root -p

# Storage prüfen
kubectl get pvc -n gaming
```
